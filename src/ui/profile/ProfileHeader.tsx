import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import type { LocalState, PlayerHistory } from '../../shared/domain';
import { dayBands, nearestPoint } from '../../shared/mmr-chart';
import { formatImp, impTier } from '../../shared/performance';
import { Avatar, CountryFlag } from '../MatchScreen';
import { OwnRating } from '../OwnRating';
import { PlayerLinks } from '../PlayerLinks';
import { hide as hideTip, show as showTip } from '../Tooltip';

/** One measured match on the chart: MMR after it, its end time and result. */
export type ChartMatch = { id: number; at: number; value: number; win: boolean | null };

const signed = (value: number) =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value)).toLocaleString('en-US')}`;
const sign = (value: number) => (value > 0 ? 'green' : value < 0 ? 'error-text' : 'muted');

/** The period summary: record, win rate, a win/loss bar and three equal cells. */
export function ScoreCard({
  label,
  wins,
  losses,
  mmrChange,
  averageImp,
  streak,
}: {
  label: string;
  wins: number;
  losses: number;
  mmrChange?: number;
  averageImp?: number;
  streak?: string;
}) {
  const games = wins + losses;
  const rate = games ? (wins / games) * 100 : undefined;
  const tier = averageImp === undefined ? null : impTier(averageImp);
  return (
    <section className="profile-score" aria-label="Period summary">
      <div className="profile-score-caption">
        <span>{label}</span>
        <span>{games} matches</span>
      </div>
      <div className="profile-score-record">
        <span className="green">{wins}</span>
        <span className="profile-score-dash">–</span>
        <span className="error-text">{losses}</span>
        <span className={`profile-score-rate ${rate === undefined ? 'muted' : sign(rate - 50)}`}>
          {rate === undefined ? '—' : `${rate.toFixed(1)}%`}
        </span>
      </div>
      <div className="profile-score-bar" aria-hidden="true">
        {games > 0 && (
          <>
            <b style={{ width: `${(wins / games) * 100}%` }} />
            <i style={{ width: `${(losses / games) * 100}%` }} />
          </>
        )}
      </div>
      <dl className="profile-score-cells">
        <div>
          <dt>MMR</dt>
          <dd className={mmrChange === undefined ? 'muted' : sign(mmrChange)}>
            {mmrChange === undefined ? '—' : signed(mmrChange)}
          </dd>
        </div>
        <div>
          <dt>Avg IMP</dt>
          <dd>
            {averageImp === undefined ? (
              <span className="muted">—</span>
            ) : (
              <span className={`imp imp-${tier}`}>{formatImp(averageImp)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd className={!streak ? 'muted' : streak.endsWith('W') ? 'green' : 'error-text'}>{streak ?? '—'}</dd>
        </div>
      </dl>
    </section>
  );
}

const WIDTH = 300;
const HEIGHT = 90;
const AXIS = 14;
/** Rough width of one character of a 10 px day label, for dropping labels that do not fit. */
const LABEL_CHAR = 5.6;

/** A day's label that fits its band: date and count, the date, the day of month, or nothing. */
function dayLabel(label: string, count: number, width: number | undefined) {
  const fits = (text: string) => width === undefined || text.length * LABEL_CHAR + 4 <= width;
  return [count > 1 ? `${label} · ${count}` : label, label, label.split(' ').at(-1)!].find(fits) ?? '';
}

const day = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Title line of the chart: MMR, the dates covered and the number of matches, and a legend. */
function ChartHead({ points }: { points: ChartMatch[] }) {
  return (
    <header className="mmr-chart-head">
      <b>MMR</b>
      {points.length > 0 && (
        <span>
          {day(points[0]!.at)} – {day(points.at(-1)!.at)} · {points.length} {points.length === 1 ? 'match' : 'matches'}
        </span>
      )}
      <span className="mmr-legend">
        <span>
          <i className="up" />
          win
        </span>
        <span>
          <i className="down" />
          loss
        </span>
      </span>
    </header>
  );
}

/**
 * MMR after each measured match, one step per match; days are alternating bands labelled with
 * the date and the number of matches. The y axis fits the range. Fewer than three: no trend,
 * but the chart keeps its place.
 */
export function MmrChart({
  points,
  onPoint,
  describe,
}: {
  points: ChartMatch[];
  onPoint(id: number): void;
  describe?: (id: number) => ReactNode;
}) {
  const [selected, setSelected] = useState<number>();
  const [size, setSize] = useState<{ width: number; height: number }>();
  const ring = useRef<HTMLSpanElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const enough = points.length >= 3;
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [enough]);
  if (!enough)
    return (
      <div className="mmr-chart empty" role="img" aria-label="MMR chart">
        <ChartHead points={points} />
        <small>{points.length ? 'Trend appears from 3 matches with MMR' : 'No MMR readings yet'}</small>
      </div>
    );
  // Drawn in the plot's own pixels, so dots stay round; a fixed box until it is measured.
  const width = size?.width || WIDTH;
  const height = size?.height || HEIGHT;
  const base = height - AXIS;
  const values = points.map((point) => point.value);
  const low = Math.min(...values) - 15;
  const high = Math.max(...values) + 15;
  const step = (width - 16) / (points.length - 1);
  const x = (index: number) => 8 + index * step;
  const y = (value: number) => 4 + ((high - value) / (high - low)) * (base - 6);
  const bands = dayBands(points.map((point) => point.at));
  const pick = (index: number | undefined) => {
    setSelected(index);
    const point = index === undefined ? undefined : points[index];
    if (point && ring.current && describe) showTip(ring.current, describe(point.id));
    else hideTip();
  };
  const fromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    pick(
      nearestPoint(
        points.map((_, index) => x(index)),
        ((event.clientX - box.left) / box.width) * width,
      ),
    );
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = points.length - 1;
    if ((event.key === 'Enter' || event.key === ' ') && selected !== undefined) {
      event.preventDefault();
      onPoint(points[selected]!.id);
      return;
    }
    const next =
      event.key === 'ArrowLeft'
        ? Math.max(0, (selected ?? last + 1) - 1)
        : event.key === 'ArrowRight'
          ? Math.min(last, (selected ?? -1) + 1)
          : undefined;
    if (next === undefined) return;
    event.preventDefault();
    pick(next);
  };
  const coords = points.map((point, index) => `${x(index).toFixed(1)},${y(point.value).toFixed(1)}`);
  const area = `M${x(0)},${base} L${coords.join(' L')} L${x(points.length - 1)},${base} Z`;
  const current = selected === undefined ? undefined : points[selected];
  const edges = (band: { from: number; to: number }): [number, number] => [
    band.from ? x(band.from) - step / 2 : 0,
    band.to < points.length - 1 ? x(band.to) + step / 2 : width,
  ];
  return (
    <div className="mmr-chart">
      <ChartHead points={points} />
      <div
        ref={plot}
        className="mmr-plot"
        role="slider"
        tabIndex={0}
        aria-label={`MMR: ${values[0]} → ${values.at(-1)}, ${points.length} matches`}
        aria-valuemin={0}
        aria-valuemax={points.length - 1}
        aria-valuenow={selected ?? points.length - 1}
        onPointerMove={fromPointer}
        onPointerLeave={() => pick(undefined)}
        onBlur={() => pick(undefined)}
        onKeyDown={key}
        onClick={() => current && onPoint(current.id)}
      >
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {bands.map((band, index) => {
            const [from, to] = edges(band);
            return (
              <g key={band.from} className={`mmr-day${index % 2 ? ' odd' : ''}`}>
                <rect x={from} y={0} width={to - from} height={base} />
              </g>
            );
          })}
          <path className="mmr-area" d={area} />
          <polyline className="mmr-line" points={coords.join(' ')} />
          {points.map((point, index) => (
            <circle
              key={point.id}
              cx={x(index)}
              cy={y(point.value)}
              r={index === selected ? 5 : 3}
              className={`${point.win === null ? 'unknown' : point.win ? 'up' : 'down'}${index === selected ? ' selected' : ''}`}
            />
          ))}
        </svg>
        <div className="mmr-days" aria-hidden="true">
          {bands.map((band) => {
            const [from, to] = edges(band);
            return (
              <span
                key={band.from}
                style={{ left: `${(from / width) * 100}%`, width: `${((to - from) / width) * 100}%` }}
              >
                {dayLabel(band.label, band.count, size && to - from)}
              </span>
            );
          })}
        </div>
        <span
          ref={ring}
          className="mmr-ring"
          hidden={current === undefined}
          style={
            current && selected !== undefined
              ? { left: `${(x(selected) / width) * 100}%`, top: `${(y(current.value) / height) * 100}%` }
              : undefined
          }
        />
      </div>
    </div>
  );
}

/** "updated 4 min ago" for fresh provider data; nothing for a cached copy. */
export function updatedText(data: Pick<PlayerHistory, 'fetchedAt' | 'stale'>, now = Date.now()): string {
  if (data.stale) return '';
  const minutes = Math.max(0, Math.round((now - Date.parse(data.fetchedAt)) / 60000));
  if (minutes < 1) return 'updated just now';
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `updated ${hours} h ago` : `updated ${Math.round(hours / 24)} d ago`;
}

/** Identity, rating, a small MMR chart (in place even without readings) and the period summary. */
export function ProfileHeader({
  local,
  data,
  rank,
  busy,
  onRefresh,
  actions,
  chart,
  score,
}: {
  local: LocalState;
  data: PlayerHistory | null;
  rank: { tier?: number | null; leaderboard?: number | null; source: string };
  busy: boolean;
  onRefresh(): void;
  /** Extra controls beside refresh (change ID). */
  actions?: ReactNode;
  chart: ReactNode;
  score: ReactNode;
}) {
  const name = data?.profile.profile?.personaname || (local.accountId ? `Player ${local.accountId}` : 'My profile');
  return (
    <header className="profile-band">
      <div className="profile-who">
        <Avatar url={data?.profile.profile?.avatarfull} />
        <h2 className="profile-name">
          <CountryFlag code={data?.profile.profile?.loccountrycode} source={data?.source} id={data?.accountId} />
          <span className="profile-name-text">{name}</span>
          {data && updatedText(data) && (
            <small className="profile-updated" title={`Profile and match history from ${data.source}`}>
              {updatedText(data)}
            </small>
          )}
          {local.accountId && (
            <button
              className="icon-button"
              aria-label="Refresh"
              title="Refresh profile"
              disabled={busy}
              onClick={onRefresh}
            >
              <RefreshCw size={13} className={busy ? 'loading-icon' : ''} />
            </button>
          )}
          {actions}
        </h2>
        <OwnRating local={local} rank={rank} />
      </div>
      {chart}
      {score}
    </header>
  );
}
