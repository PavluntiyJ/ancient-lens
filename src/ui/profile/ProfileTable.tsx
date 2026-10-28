import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import {
  formatDecimal,
  formatDuration,
  matchWon,
  type Hero,
  type HeroAverageRow,
  type Match,
} from '../../shared/domain';
import { modeName } from '../../shared/history';
import { matchRanking } from '../../shared/match-rank';
import { formatImp, impTier, impTiers } from '../../shared/performance';
import type { HistorySort } from '../../shared/profile-history';
import type { RankBracket } from '../../shared/rank-bracket';
import type { MatchRating } from '../../shared/rating-history';
import { matchPosition, rankedRoles } from '../../shared/roles';
import { expectedValue, matchBracket, ownValue, statBand, type StatKey } from '../../shared/stat-bands';
import { Portrait } from '../MatchScreen';
import { RoleIcon } from '../Roles';
import { RankList, StatCard } from '../Tips';
import { tip, TipCard } from '../Tooltip';
import type { ProfileView } from './profile-view';

type Averages = (heroId: number, bracket: RankBracket) => HeroAverageRow[] | undefined;

const compact = (value: number) =>
  Math.abs(value) >= 1000 ? `${formatDecimal(value / 1000)}k` : String(Math.round(value));
const shown = (key: StatKey, value: number) =>
  key === 'kp' ? `${Math.round(value)}%` : key === 'hero_damage' ? compact(value) : String(Math.round(value));
const averageText = (key: StatKey, value: number) =>
  key === 'kp'
    ? `${Math.round(value)}%`
    : key === 'hero_damage'
      ? compact(value)
      : value < 20
        ? formatDecimal(value)
        : String(Math.round(value));
const statLabels: Record<StatKey, string> = {
  kills: 'Kills',
  deaths: 'Deaths',
  assists: 'Assists',
  kp: 'Kill participation',
  last_hits: 'Last hits',
  gold_per_min: 'GPM',
  xp_per_min: 'XPM',
  hero_damage: 'Hero damage',
};
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function ago(seconds: number, now = Date.now()) {
  const hours = (seconds * 1000 - now) / 3600000;
  return Math.abs(hours) < 20
    ? relative.format(Math.round(hours), 'hour')
    : relative.format(Math.round(hours / 24), 'day');
}
const when = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** One statistic coloured against the bracket average, with its card; "—" when unknown. */
function StatValue({
  match,
  statKey,
  averages,
  heroes,
}: {
  match: Match;
  statKey: StatKey;
  averages: Averages;
  heroes: Hero[];
}) {
  const value = ownValue(match, statKey);
  if (value === undefined) return <span className="muted">—</span>;
  const bracket = matchBracket(match);
  const expected = bracket ? expectedValue(averages(match.hero_id, bracket) ?? [], match, statKey) : undefined;
  const band = expected === undefined ? null : statBand(value, expected, statKey);
  const heroOf = (id: number | undefined) => heroes.find((hero) => hero.id === id);
  const card = (
    <StatCard
      label={statLabels[statKey]}
      value={shown(statKey, value)}
      band={band}
      average={expected === undefined ? undefined : averageText(statKey, expected)}
      heroName={heroOf(match.hero_id)?.localized_name ?? `Hero #${match.hero_id}`}
      position={matchPosition(match)}
      ranking={matchRanking(match, statKey)}
      format={(v) => shown(statKey, v)}
      heroOf={heroOf}
    />
  );
  return (
    <span className={band === null || band === 3 ? undefined : `stat-band-${band}`} {...tip(card)}>
      {shown(statKey, value)}
    </span>
  );
}

const columns: {
  key: string;
  label: string;
  sort?: HistorySort;
  show?(view: ProfileView, measured: boolean): boolean;
}[] = [
  { key: 'date', label: 'Result', sort: 'date' },
  { key: 'hero', label: 'Hero', sort: 'hero' },
  { key: 'mode', label: 'Mode', sort: 'mode', show: (view) => view.modes === 'all' },
  { key: 'duration', label: 'Time', sort: 'duration' },
  { key: 'kda', label: 'K / D / A', sort: 'kda' },
  { key: 'kp', label: 'KP', sort: 'kp' },
  { key: 'last_hits', label: 'LH / DN', sort: 'last_hits', show: (view) => view.columns.lhdn },
  { key: 'gold_per_min', label: 'GPM', sort: 'gold_per_min' },
  { key: 'xp_per_min', label: 'XPM', sort: 'xp_per_min', show: (view) => view.columns.xpm },
  { key: 'hero_damage', label: 'Damage', sort: 'hero_damage', show: (view) => view.columns.damage },
  { key: 'imp', label: 'IMP', sort: 'imp' },
  { key: 'mmr', label: 'MMR', sort: 'mmr', show: (_, measured) => measured },
];

/**
 * The selected matches in one list (the page scrolls; header and filter bar stick). Numbers are
 * coloured against the STRATZ average of the hero on its position in the match bracket.
 */
export function ProfileTable({
  rows,
  heroes,
  ratings,
  view,
  change,
  measured,
  selected,
  onSelect,
  averages,
  footer,
}: {
  rows: Match[];
  heroes: Hero[];
  ratings: Map<number, MatchRating>;
  view: ProfileView;
  change(change: Partial<ProfileView>): void;
  /** The account has MMR measurements: show the MMR column. */
  measured: boolean;
  selected?: number;
  onSelect(match: Match): void;
  averages: Averages;
  /** "Load older matches" after the last row. */
  footer?: ReactNode;
}) {
  const visible = columns.filter((column) => column.show?.(view, measured) ?? true);
  const heroOf = (id: number | undefined) => heroes.find((hero) => hero.id === id);
  const heroName = (id: number) => heroOf(id)?.localized_name ?? `Hero #${id}`;
  const cell = (match: Match, key: string): ReactNode => {
    const won = matchWon(match);
    const rating = ratings.get(match.match_id);
    const position = matchPosition(match);
    switch (key) {
      case 'date':
        return (
          <>
            <span className={won === null ? 'muted' : won ? 'green' : 'error-text'}>
              {won === null ? '—' : won ? 'Win' : 'Loss'}
            </span>
            <small title={when(match.start_time + match.duration)}>{ago(match.start_time + match.duration)}</small>
          </>
        );
      case 'hero': {
        const same = rows.filter((row) => row.hero_id === match.hero_id);
        const known = same.filter((row) => matchWon(row) !== null);
        const wins = known.filter((row) => matchWon(row)).length;
        const imps = same.flatMap((row) => (typeof row.imp === 'number' ? [row.imp] : []));
        return (
          <span
            className="profile-hero"
            {...tip(
              <TipCard
                title={heroName(match.hero_id)}
                value={
                  position
                    ? `${rankedRoles.find((role) => role.id === position)?.name}${
                        matchPosition({ position: match.position, role: match.role }) ? '' : ' · from the queue'
                      }`
                    : 'position unknown'
                }
                note="Click the row for match details · click the hero in the Heroes panel to filter"
              >
                <p className="tip-verdict">
                  In the selected matches: <b>{same.length === 1 ? '1 game' : `${same.length} games`}</b> ·{' '}
                  <span className="green">{wins}W</span> <span className="error-text">{known.length - wins}L</span> ·
                  avg IMP{' '}
                  {imps.length ? (
                    <span className={`imp imp-${impTier(imps.reduce((sum, imp) => sum + imp, 0) / imps.length)}`}>
                      {formatImp(imps.reduce((sum, imp) => sum + imp, 0) / imps.length)}
                    </span>
                  ) : (
                    '—'
                  )}
                </p>
              </TipCard>,
            )}
          >
            <Portrait hero={heroOf(match.hero_id)} />
            <span className="profile-hero-name">{heroName(match.hero_id)}</span>
            {position ? <RoleIcon position={position} /> : <span className="muted">?</span>}
          </span>
        );
      }
      case 'mode':
        return modeName(match);
      case 'duration':
        return (
          <span
            {...tip(
              <TipCard title="Duration" value={formatDuration(match.duration)}>
                <p className="tip-verdict">
                  Longer than{' '}
                  {Math.round((rows.filter((row) => row.duration < match.duration).length / rows.length) * 100)}% of the
                  listed matches · ended {when(match.start_time + match.duration)}
                </p>
              </TipCard>,
            )}
          >
            {formatDuration(match.duration)}
          </span>
        );
      case 'kda':
        return (
          <>
            <StatValue match={match} statKey="kills" averages={averages} heroes={heroes} />
            <span className="profile-sep"> / </span>
            <StatValue match={match} statKey="deaths" averages={averages} heroes={heroes} />
            <span className="profile-sep"> / </span>
            <StatValue match={match} statKey="assists" averages={averages} heroes={heroes} />
          </>
        );
      case 'last_hits':
        return (
          <>
            <StatValue match={match} statKey="last_hits" averages={averages} heroes={heroes} />
            <small> / {typeof match.denies === 'number' ? match.denies : '—'}</small>
          </>
        );
      case 'kp':
      case 'gold_per_min':
      case 'xp_per_min':
      case 'hero_damage':
        return <StatValue match={match} statKey={key} averages={averages} heroes={heroes} />;
      case 'imp': {
        if (typeof match.imp !== 'number') return <span className="muted">—</span>;
        const tier = impTier(match.imp)!;
        const ranking = matchRanking(match, 'imp');
        return (
          <span
            className={`imp imp-${tier}`}
            {...tip(
              <TipCard title="IMP" value={<span className={`imp imp-${tier}`}>{formatImp(match.imp)}</span>}>
                <p className="tip-verdict">
                  <b className={`imp imp-${tier}`}>{impTiers[tier]!.label}</b> · 0 = average game
                </p>
                {ranking && <RankList ranking={ranking} format={formatImp} heroOf={heroOf} />}
              </TipCard>,
            )}
          >
            {formatImp(match.imp)}
          </span>
        );
      }
      case 'mmr':
        return rating ? (
          <span
            {...tip(
              <TipCard title="MMR after the match" value={rating.mmr.toLocaleString('en-US')}>
                <p className="tip-verdict">
                  <span className={rating.delta > 0 ? 'green' : rating.delta < 0 ? 'error-text' : 'muted'}>
                    {rating.delta > 0 ? '+' : rating.delta < 0 ? '−' : ''}
                    {Math.abs(rating.delta)}
                  </span>{' '}
                  from {(rating.mmr - rating.delta).toLocaleString('en-US')} · measured in Dota 2 after the match
                </p>
              </TipCard>,
            )}
          >
            {rating.mmr.toLocaleString('en-US')}{' '}
            <small className="profile-mmr-change">
              (
              <span className={rating.delta > 0 ? 'green' : rating.delta < 0 ? 'error-text' : 'muted'}>
                {`${rating.delta > 0 ? '+' : rating.delta < 0 ? '−' : ''}${Math.abs(rating.delta)}`}
              </span>
              )
            </small>
          </span>
        ) : (
          <span className="muted">—</span>
        );
    }
    return null;
  };
  return (
    <>
      <table className="profile-table">
        <thead>
          <tr>
            {visible.map((column) => (
              <th
                key={column.key}
                data-column={column.key}
                aria-sort={
                  column.sort && view.sort === column.sort
                    ? view.direction === 'asc'
                      ? 'ascending'
                      : 'descending'
                    : undefined
                }
              >
                {column.sort ? (
                  <button
                    onClick={() =>
                      change({
                        sort: column.sort,
                        direction: view.sort === column.sort && view.direction === 'desc' ? 'asc' : 'desc',
                      })
                    }
                  >
                    {column.label}
                    {view.sort === column.sort &&
                      (view.direction === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((match) => {
            const won = matchWon(match);
            return (
              <tr
                key={match.match_id}
                data-match-id={match.match_id}
                className={[won === null ? 'unknown' : won ? 'win' : 'loss', selected === match.match_id && 'selected']
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(match)}
              >
                {visible.map((column) => (
                  <td key={column.key} data-column={column.key}>
                    {cell(match, column.key)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="muted">No matches in the loaded history match these filters.</p>}
      {footer}
    </>
  );
}
