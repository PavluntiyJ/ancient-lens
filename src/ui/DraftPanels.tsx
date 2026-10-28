import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  draftLanes,
  laneSuggestions,
  matchupAdvantage,
  MATCHUP_EVEN,
  draftDataNote,
  matchupTint,
  sumAdvantage,
  type DraftData,
  type Position,
  type PositionSuggestion,
} from '../shared/draft';
import { formatDecimal, type Hero } from '../shared/domain';
import { rankedRoles } from '../shared/roles';
import { RoleIcon, RoleLabel, LaneIcon } from './Roles';
import { Portrait } from './MatchScreen';
import { LaneTip, MatchupTip, SuggestionTip } from './Tips';
import type { LaneHero, LaneSummary } from '../shared/lane-summary';
import { tip } from './Tooltip';
import { useShortcuts } from './shortcut-context';
import { matchesShortcut, normalizeShortcut } from '../shared/shortcuts';
import type { VisibleDraftSlot } from '../shared/live-draft';

function SuggestionPage({
  name,
  positions,
  rows,
  weight,
  busy,
  picked,
  filtered,
}: {
  name: string;
  positions: readonly Position[];
  rows: PositionSuggestion[];
  weight: number;
  busy: boolean;
  picked: boolean;
  /** Set when the minimum win rate hid every candidate. */
  filtered?: string;
}) {
  const [page, setPage] = useState(0);
  const signature = rows.map((row) => row.hero.id).join(',');
  useEffect(() => setPage(0), [signature]);
  const pages = Math.max(1, Math.ceil(rows.length / 6));
  const current = Math.min(page, pages - 1);
  return (
    <section className="suggestion-category" aria-label={name}>
      <h3>
        {positions.length === 1 ? (
          <RoleLabel position={positions[0]} />
        ) : (
          <span className="role-label">
            <RoleIcon position={name === 'Core' ? 1 : 5} />
            {name}
          </span>
        )}
        <span className="suggestion-page" aria-live="polite">
          {current + 1} / {pages}
        </span>
      </h3>
      <div className="suggestion-row">
        <button
          className="page-arrow icon-button"
          aria-label={`Previous ${name} heroes`}
          disabled={current === 0}
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <div className="suggestion-grid">
          {rows.slice(current * 6, current * 6 + 6).map((row) => {
            const label = `${row.hero.localized_name} · Advantage ${row.score > 0 ? '+' : ''}${formatDecimal(row.score, 2)} · opponents ${formatDecimal(row.counter, 2)} · allies ${formatDecimal(row.synergy, 2)} (weight ${weight}%) · position win rate ${formatDecimal(row.base)}% · ${row.coverage}/${row.expected} pairs · ${row.games.toLocaleString('en-US')} matches in position`;
            return (
              <div
                key={row.hero.id}
                className="suggestion-tile"
                data-hero-id={row.hero.id}
                {...tip(<SuggestionTip row={row} weight={weight} />)}
                aria-label={label}
                tabIndex={0}
              >
                <Portrait hero={row.hero} />
                <b className={row.score < 0 ? 'negative' : ''}>{formatDecimal(row.score, 2)}</b>
              </div>
            );
          })}
          {!rows.length && (
            <p className="suggestion-empty">
              {busy ? 'Loading…' : filtered ? filtered : picked ? 'No data' : 'Waiting for picks'}
            </p>
          )}
        </div>
        <button
          className="page-arrow icon-button"
          aria-label={`Next ${name} heroes`}
          disabled={current + 1 >= pages}
          onClick={() => setPage(current + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </section>
  );
}

/** True when a global shortcut must not fire: a modal is open or the user is typing. */
export function shortcutBlocked(event: KeyboardEvent) {
  return (
    document.body.hasAttribute('data-shortcut-recording') ||
    !!document.querySelector('dialog[open]') ||
    (event.target instanceof Element &&
      !!event.target.closest('input, select, textarea, [contenteditable="true"], [role="textbox"]'))
  );
}

/** Lane filter shared by every suggestion page; the stored keys cycle it (MatchScreen). */
export function LaneSelect({ lane, setLane }: { lane: number; setLane(index: number): void }) {
  const shortcuts = useShortcuts();
  const label = (combo: string) =>
    (normalizeShortcut(combo) ?? combo).replace('ArrowUp', '↑').replace('ArrowDown', '↓');
  return (
    <select
      className="lane-select"
      aria-label="Recommendation lane"
      title={`Recommendation lane · ${label(shortcuts.lanePrevious)} / ${label(shortcuts.laneNext)}`}
      aria-keyshortcuts={`${shortcuts.lanePrevious} ${shortcuts.laneNext}`}
      value={lane}
      onChange={(event) => setLane(Number(event.target.value))}
    >
      {draftLanes.map((item, index) => (
        <option key={item.id} value={index}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

/** Pick suggestions of one side for the shared lane: Core/Support groups with their own pages. */
export function DraftSuggestions({
  rows,
  lane: laneIndex,
  context,
  weight,
  busy,
  error,
  available,
  picked,
  hovered = 0,
  partial,
  minWinRate,
}: {
  rows?: Record<Position, PositionSuggestion[]>;
  lane: number;
  context: string;
  weight: number;
  busy: boolean;
  error: string;
  available?: boolean;
  picked: number;
  hovered?: number;
  partial: boolean;
  /** Optional strict minimum position win rate (Settings). */
  minWinRate?: number;
}) {
  const lane = draftLanes[laneIndex] ?? draftLanes[0];
  const group = (positions: readonly Position[]) => {
    const shown = laneSuggestions(rows, positions, minWinRate);
    const hidden = !shown.length && laneSuggestions(rows, positions).length > 0;
    return { rows: shown, filtered: hidden ? `No hero above ${minWinRate}% win rate` : undefined };
  };
  return (
    <div className="draft-carousel" aria-label="Pick recommendations">
      {partial && (picked > 0 || hovered > 0) && (
        <span className="draft-scope" title="Confirmed picks only; hovered heroes are tracked separately">
          Known picks: {picked}/10
        </span>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {available === false && <p className="rail-empty">Connect STRATZ for position recommendations</p>}
      <div className="lane-heading" aria-live="polite" title={lane.title}>
        <LaneIcon lane={lane.id} />
        {lane.name}
      </div>
      <div className="lane-categories" key={`${context}-${lane.id}`}>
        <SuggestionPage
          name={lane.core.length === 1 ? rankedRoles.find((role) => role.id === lane.core[0])!.name : 'Core'}
          positions={lane.core}
          {...group(lane.core)}
          weight={weight}
          busy={busy}
          picked={picked + hovered > 0}
        />
        {lane.support.length > 0 && (
          <SuggestionPage
            name={lane.support.length === 1 ? rankedRoles.find((role) => role.id === lane.support[0])!.name : 'Support'}
            positions={lane.support}
            {...group(lane.support)}
            weight={weight}
            busy={busy}
            picked={picked + hovered > 0}
          />
        )}
      </div>
    </div>
  );
}

/** `name` labels the dot and the panel; `title` may add colour (team names). */
export type AnalysisPage = {
  id: string;
  name: string;
  title: ReactNode;
  lane?: boolean;
  busy?: boolean;
  body: ReactNode;
};

/**
 * One of the two analysis panels under the roster. Outer arrows and dots change the
 * page category and wrap around; each panel keeps its own page.
 * The lane is shared and shown in the header of suggestion pages.
 */
export function AnalysisCarousel({
  label,
  pages,
  initial,
  panel,
  active,
  lane,
  setLane,
}: {
  label: string;
  pages: AnalysisPage[];
  initial: number;
  /** The third panel of a wide window has no shortcut of its own. */
  panel?: 'left' | 'right';
  active: boolean;
  lane: number;
  setLane(index: number): void;
}) {
  const shortcuts = useShortcuts();
  const previous = panel === 'left' ? shortcuts.leftPrevious : panel === 'right' ? shortcuts.rightPrevious : undefined;
  const next = panel === 'left' ? shortcuts.leftNext : panel === 'right' ? shortcuts.rightNext : undefined;
  // Until the user navigates, follow the initial position (own side once it is known);
  // afterwards remember the page by id so a changed page list keeps the category.
  const [selected, setSelected] = useState<string>();
  const found = pages.findIndex((page) => page.id === selected);
  const index = found < 0 ? Math.min(initial, pages.length - 1) : found;
  const move = (delta: number) => setSelected(pages[(index + delta + pages.length) % pages.length]?.id);
  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    if (!active || !previous || !next) return;
    const keydown = (event: KeyboardEvent) => {
      const direction = matchesShortcut(event, next) ? 1 : matchesShortcut(event, previous) ? -1 : 0;
      if (!direction || shortcutBlocked(event)) return;
      event.preventDefault();
      moveRef.current(direction);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [active, previous, next]);
  const page = pages[index];
  if (!page) return null;
  return (
    <section className="analysis-panel" aria-label={label} data-page={page.id}>
      <h2>
        <span className="analysis-title">{page.title}</span>
        {page.lane && <LaneSelect lane={lane} setLane={setLane} />}
        {page.busy && (
          <span className="carousel-loading" role="status">
            …
          </span>
        )}
      </h2>
      <div className="analysis-body">
        <button
          className="lane-arrow icon-button"
          aria-label={`${label}: previous panel`}
          title={previous ? `Previous panel · ${previous}` : 'Previous panel'}
          aria-keyshortcuts={previous}
          onClick={() => move(-1)}
        >
          <ChevronLeft size={22} />
        </button>
        <div className="analysis-content" key={page.id}>
          {page.body}
        </div>
        <button
          className="lane-arrow icon-button"
          aria-label={`${label}: next panel`}
          title={next ? `Next panel · ${next}` : 'Next panel'}
          aria-keyshortcuts={next}
          onClick={() => move(1)}
        >
          <ChevronRight size={22} />
        </button>
      </div>
      <div className="lane-dots" aria-label={`${label}: panels`}>
        {pages.map((item, position) => (
          <button
            key={item.id}
            aria-label={`${label}: ${item.name}`}
            aria-pressed={position === index}
            onClick={() => setSelected(item.id)}
          >
            <span />
          </button>
        ))}
      </div>
    </section>
  );
}

export function HeroMatchups({
  data,
  radiant,
  dire,
  heroes,
}: {
  data?: DraftData;
  radiant: VisibleDraftSlot[];
  dire: VisibleDraftSlot[];
  heroes: Hero[];
}) {
  const hero = (id: number) => heroes.find((item) => item.id === id);
  const heroId = (slot: VisibleDraftSlot | undefined) => slot?.pick ?? (slot?.hoverBanned ? undefined : slot?.hover);
  const hovered = (slot: VisibleDraftSlot | undefined) =>
    slot?.pick === undefined && slot?.hover !== undefined && !slot.hoverBanned;
  const name = (slot: VisibleDraftSlot | undefined) => {
    const id = heroId(slot);
    return id === undefined ? 'Empty slot' : (hero(id)?.localized_name ?? `#${id}`);
  };
  const rows = Array.from({ length: 5 }, (_, index) => radiant.find((slot) => slot.teamSlot === index));
  const columns = Array.from({ length: 5 }, (_, index) => dire.find((slot) => slot.teamSlot === index));
  const cells = rows.map((row) =>
    columns.map((column) => {
      const r = heroId(row),
        d = heroId(column);
      return r === undefined || d === undefined ? undefined : matchupAdvantage(data, r, d);
    }),
  );
  // Same boundary as the grey tint, so the label never names a winner the colour hides.
  const description = (value: number | undefined) => {
    if (value === undefined) return 'Not enough data';
    const side = `${value > 0 ? 'Radiant' : 'Dire'} +${formatDecimal(Math.abs(value), 2)} percentage points`;
    return Math.abs(value) < 0.005 ? 'Even' : Math.abs(value) < MATCHUP_EVEN ? `Even · ${side}` : side;
  };
  const signed = (value: number) => {
    const text = formatDecimal(Math.abs(value));
    return text === '0' ? '0' : `${value < 0 ? '−' : '+'}${text}`;
  };
  // Axis totals read from the hero's own side: + means this hero's pairs favour its team.
  const axis = (slot: VisibleDraftSlot | undefined, team: 'radiant' | 'dire', values: (number | undefined)[]) => {
    const id = heroId(slot),
      radiantSum = sumAdvantage(values),
      own = radiantSum === undefined ? undefined : team === 'radiant' ? radiantSum : -radiantSum,
      favours =
        radiantSum === undefined || Math.abs(radiantSum) < 0.05 ? 'neutral' : radiantSum > 0 ? 'radiant' : 'dire';
    return (
      <span
        className={`matrix-axis${hovered(slot) ? ' draft-hover' : ''}${id === undefined ? ' matrix-empty' : ''}`}
        data-hero-id={id}
        title={`${name(slot)} · ${team === 'radiant' ? 'Radiant' : 'Dire'}${hovered(slot) ? ' · hovered' : ''}`}
      >
        {id === undefined ? (
          <span className="matchup-unknown">—</span>
        ) : (
          <>
            <Portrait hero={hero(id)} />
            <span
              className={`matchup-average ${favours}`}
              title={`Sum over ${values.filter((value) => value !== undefined).length} known pairs: ${description(radiantSum)}`}
            >
              {own === undefined ? '—' : signed(own)}
            </span>
          </>
        )}
      </span>
    );
  };
  const total = sumAdvantage(cells.flat());
  const leader = total === undefined || Math.abs(total) < 0.05 ? 'neutral' : total > 0 ? 'radiant' : 'dire';
  const known = cells.flat().filter((value) => value !== undefined).length;
  return (
    <div
      className="matrix-panel"
      title={`Each cell shows the hero who wins the pair, tinted green for Radiant and red for Dire; the stronger the advantage, the richer the colour, and near-even pairs stay grey. Dashes have no data. Totals are sums of percentage points, not win probability. Data: ${draftDataNote(data)}.`}
    >
      <div className="table-scroll">
        <table
          className="matchup-matrix advantage-matrix"
          aria-label="Hero advantage: Radiant in rows, Dire in columns"
        >
          <colgroup>
            {Array.from({ length: 6 }, (_, index) => (
              <col key={index} style={{ width: '16.6667%' }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th>
                <span
                  className={`matrix-total ${leader}`}
                  title={`Draft advantage over ${known} known pairs: ${description(total)}. Radiant in rows, Dire in columns.`}
                >
                  <small>
                    {leader === 'radiant'
                      ? 'Radiant'
                      : leader === 'dire'
                        ? 'Dire'
                        : total === undefined
                          ? 'Draft'
                          : 'Even'}
                  </small>
                  <b>{total === undefined || leader === 'neutral' ? '—' : `+${formatDecimal(Math.abs(total))}`}</b>
                </span>
              </th>
              {columns.map((slot, column) => (
                <th key={column} scope="col">
                  {axis(
                    slot,
                    'dire',
                    cells.map((row) => row[column]),
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((slot, row) => (
              <tr key={row}>
                <th scope="row">{axis(slot, 'radiant', cells[row] ?? [])}</th>
                {columns.map((enemy, column) => {
                  const value = cells[row]?.[column];
                  const tint = value === undefined ? undefined : matchupTint(value);
                  const provisional = hovered(slot) || hovered(enemy);
                  const selected = value === undefined ? undefined : value >= 0 ? slot : enemy;
                  const selectedId = heroId(selected);
                  const empty = heroId(slot) === undefined || heroId(enemy) === undefined;
                  const label = `${name(slot)} against ${name(enemy)}${provisional ? ' · tentative: hovered hero' : ''} · ${description(value)}`;
                  return (
                    <td key={column}>
                      <span
                        className={`matchup-cell ${tint?.tone ?? 'unknown'}${empty ? ' matrix-empty' : ''}${provisional ? ' matchup-provisional' : ''}${hovered(selected) ? ' draft-hover' : ''}`}
                        style={tint && ({ '--matchup-tint': tint.rgb } as CSSProperties)}
                        {...tip(
                          <MatchupTip
                            radiant={hero(heroId(slot) ?? -1)}
                            dire={hero(heroId(enemy) ?? -1)}
                            value={value}
                            provisional={provisional}
                            note={draftDataNote(data)}
                          />,
                        )}
                        aria-label={label}
                        tabIndex={0}
                      >
                        {value === undefined || selectedId === undefined ? (
                          <span className="matchup-unknown">—</span>
                        ) : (
                          <Portrait hero={hero(selectedId)} />
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const laneNames = { safe: ['Safe', 'Off'], mid: ['Mid', 'Mid'], off: ['Off', 'Safe'] } as const;
/** Side and size of an advantage given for Radiant; near-even stays neutral. */
function sideOf(value: number | undefined) {
  if (value === undefined) return { side: 'unknown', text: '—' } as const;
  if (Math.abs(value) < 0.05) return { side: 'neutral', text: 'Even' } as const;
  return { side: value > 0 ? 'radiant' : 'dire', text: `+${formatDecimal(Math.abs(value))}` } as const;
}

/** Lane summary: who wins each lane by its heroes' matchup pairs, and draft totals. */
export function LaneSummaryPanel({
  summary,
  heroes,
  weight,
  note,
}: {
  summary: LaneSummary;
  heroes: Hero[];
  weight: number;
  note: string;
}) {
  const hero = (id: number | undefined) => heroes.find((item) => item.id === id);
  const lineup = (team: LaneHero[], side: 'radiant' | 'dire') => (
    <span className={`lane-heroes ${side}`}>
      {team.map((item) => (
        <span
          key={item.position}
          className={`lane-hero${item.guessed ? ' guessed' : ''}${item.hovered ? ' draft-hover' : ''}`}
          title={
            item.heroId === undefined
              ? `No hero at ${rankedRoles.find((role) => role.id === item.position)!.name} yet`
              : `${hero(item.heroId)?.localized_name ?? `#${item.heroId}`} · ${rankedRoles.find((role) => role.id === item.position)!.name}${item.guessed ? ' (likely)' : ''}${item.hovered ? ' · hovered' : ''}`
          }
        >
          {item.heroId === undefined ? (
            <span className="matchup-unknown">—</span>
          ) : (
            <Portrait hero={hero(item.heroId)} />
          )}
          <RoleIcon position={item.position} />
        </span>
      ))}
    </span>
  );
  const total = (label: string, value: number | undefined, detail?: string) => {
    const { side, text } = sideOf(value);
    return (
      <span className={`lane-total ${side}`}>
        <small>{label}</small>
        <b>
          {side === 'radiant' ? 'Radiant ' : side === 'dire' ? 'Dire ' : ''}
          {text}
        </b>
        {detail && <small>{detail}</small>}
      </span>
    );
  };
  return (
    <div className="lane-summary">
      <div className="lane-rows">
        <div className="lane-sides" aria-hidden="true">
          <span className="radiant">Radiant</span>
          <span>Lane</span>
          <span className="dire">Dire</span>
        </div>
        {summary.lanes.map((lane) => {
          const { side, text } = sideOf(lane.advantage);
          return (
            <div key={lane.id} className="lane-row" data-lane={lane.id}>
              {lineup(lane.radiant, 'radiant')}
              <span
                className={`lane-advantage ${side}`}
                tabIndex={0}
                aria-label={`${laneNames[lane.id][0]} against ${laneNames[lane.id][1]}: ${side === 'unknown' ? 'unknown' : side === 'neutral' ? 'even' : `${side} ${text}`}`}
                {...tip(<LaneTip lane={lane} heroes={heroes} note={note} />)}
              >
                <span className="lane-name">
                  <i className="radiant">{laneNames[lane.id][0]}</i> · <i className="dire">{laneNames[lane.id][1]}</i>
                </span>
                <b>{text}</b>
                <small>
                  {side === 'radiant' ? 'Radiant' : side === 'dire' ? 'Dire' : side === 'neutral' ? '' : 'unknown'}
                </small>
              </span>
              {lineup(lane.dire, 'dire')}
            </div>
          );
        })}
      </div>
      <div
        className="lane-totals"
        title={`Sums of percentage points for Radiant or Dire, not win probability. Data: ${note}.`}
      >
        {total('Counter', summary.counter)}
        {total('Synergy', summary.synergy, `counts ${weight}%`)}
        {total('Total', summary.total)}
      </div>
    </div>
  );
}
