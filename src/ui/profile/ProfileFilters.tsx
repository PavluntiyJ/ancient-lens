import { Info, X } from 'lucide-react';
import type { Hero, Match } from '../../shared/domain';
import { durationRanges, timesOfDay, weekdayNames, type Patch } from '../../shared/history';
import { roleHeroes, roleHistory } from '../../shared/profile-history';
import type { MatchRating } from '../../shared/rating-history';
import { rankedRoles, type Position } from '../../shared/roles';
import { profileWinRateTone } from '../../shared/stat-bands';
import { Portrait } from '../MatchScreen';
import { ProfileMenu } from '../ProfileMenu';
import { RoleIcon } from '../Roles';
import { tip, TipCard } from '../Tooltip';
import type { ProfileView } from './profile-view';

type Change = (change: Partial<ProfileView>) => void;
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('en-US')}`;
const roleName = (position: Position | 0) => rankedRoles.find((role) => role.id === position)?.name ?? '';

function WinRate({ wins, games }: { wins: number; games: number }) {
  if (!games) return <span className="muted">—</span>;
  return <span className={`wr-${profileWinRateTone(wins, games)}`}>{Math.round((wins / games) * 100)}%</span>;
}

const games = (count: number) => (count === 1 ? '1 game' : `${count} games`);
const signedClass = (value: number) => (value > 0 ? 'green' : value < 0 ? 'error-text' : 'muted');

/**
 * Five toggle cards: the MMR change (or win rate without measurements), labelled; the record in
 * words; the three most played heroes with their number of games. Every number has a card.
 */
export function PositionCards({
  matches,
  ratings,
  view,
  change,
  heroes,
  measured,
}: {
  /** The selection without the position filter. */
  matches: Match[];
  ratings: Map<number, MatchRating>;
  view: ProfileView;
  change: Change;
  heroes: Hero[];
  measured: boolean;
}) {
  return (
    <div className="profile-positions" aria-label="Matches by position">
      {rankedRoles.map((role) => {
        const summary = roleHistory(matches, role.id, ratings);
        const losses = summary.played - summary.wins;
        const mmr = measured && summary.measured > 0;
        const record = `${summary.wins}W ${losses}L · ${games(summary.games)}`;
        return (
          <button
            key={role.id}
            className="profile-position"
            aria-pressed={view.position === role.id}
            aria-label={`Filter ${role.name}`}
            data-empty={summary.games ? undefined : ''}
            onClick={() => change({ position: view.position === role.id ? 0 : role.id })}
          >
            <RoleIcon position={role.id} />
            <span className="profile-position-name">{role.name}</span>
            {!summary.games ? (
              <strong className="profile-position-head">
                <span className="muted">—</span>
              </strong>
            ) : (
              <strong
                className="profile-position-head"
                {...tip(
                  <TipCard
                    title={role.name}
                    value={
                      mmr ? (
                        <span className={signedClass(summary.delta)}>{signed(summary.delta)} MMR</span>
                      ) : (
                        <WinRate wins={summary.wins} games={summary.played} />
                      )
                    }
                  >
                    <p className="tip-verdict">
                      {mmr
                        ? `MMR change over ranked matches on ${role.name} in the selected period · ${record}`
                        : `Win rate on ${role.name} in the selected period · ${record}${measured ? '' : ' · MMR appears once Dota 2 reports it'}`}
                    </p>
                  </TipCard>,
                )}
              >
                {mmr ? (
                  <span className={signedClass(summary.delta)}>{signed(summary.delta)}</span>
                ) : (
                  <WinRate wins={summary.wins} games={summary.played} />
                )}
                <small>{mmr ? 'MMR' : 'win rate'}</small>
              </strong>
            )}
            <small className="profile-position-sub">
              {!summary.games ? (
                'no games'
              ) : (
                <>
                  <b className="green">{summary.wins}W</b> <b className="error-text">{losses}L</b> ·{' '}
                  {mmr && (
                    <>
                      <WinRate wins={summary.wins} games={summary.played} /> ·{' '}
                    </>
                  )}
                  {games(summary.games)}
                </>
              )}
            </small>
            {summary.games > 0 && (
              <span className="profile-position-heroes">
                {roleHeroes(matches, role.id, ratings).map((row) => {
                  const hero = heroes.find((entry) => entry.id === row.hero);
                  const name = hero?.localized_name ?? `Hero #${row.hero}`;
                  return (
                    <span
                      key={row.hero}
                      className="profile-position-hero"
                      {...tip(
                        <TipCard title={name} value={games(row.games)}>
                          <p className="tip-verdict">
                            On {role.name}: <span className="green">{row.wins}W</span>{' '}
                            <span className="error-text">{row.losses}L</span> ·{' '}
                            <WinRate wins={row.wins} games={row.wins + row.losses} />
                            {measured && row.measured > 0 && (
                              <>
                                {' '}
                                · <span className={signedClass(row.delta)}>{signed(row.delta)}</span> MMR
                              </>
                            )}
                          </p>
                        </TipCard>,
                      )}
                    >
                      <Portrait hero={hero} />
                      <b>{row.games}</b>
                    </span>
                  );
                })}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Modes, duration, start time, weekday and patch: the filters used less often. */
export function MoreFilters({ view, change, patches }: { view: ProfileView; change: Change; patches: Patch[] }) {
  return (
    <>
      <label title="Standard matchmaking: All Pick, Captains Mode and Random Draft. Ranked and Turbo are separate.">
        Modes
        <select
          aria-label="Profile modes"
          value={view.modes}
          onChange={(e) => change({ modes: e.target.value === 'all' ? 'all' : 'match' })}
        >
          <option value="match">Standard matchmaking</option>
          <option value="all">All modes</option>
        </select>
      </label>
      <label>
        Duration
        <select
          aria-label="Profile duration"
          value={view.duration}
          onChange={(e) => change({ duration: e.target.value as ProfileView['duration'] })}
        >
          <option value="all">Any duration</option>
          {Object.entries(durationRanges).map(([id, range]) => (
            <option key={id} value={id}>
              {range.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Start (local)
        <select
          aria-label="Profile time of day"
          value={view.timeOfDay}
          onChange={(e) => change({ timeOfDay: e.target.value as ProfileView['timeOfDay'] })}
        >
          <option value="all">Any time</option>
          {Object.entries(timesOfDay).map(([id, time]) => (
            <option key={id} value={id}>
              {time.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Day
        <select
          aria-label="Profile day of week"
          value={String(view.weekday)}
          onChange={(e) =>
            change({
              weekday: ['all', 'weekdays', 'weekend'].includes(e.target.value)
                ? (e.target.value as 'all' | 'weekdays' | 'weekend')
                : Number(e.target.value),
            })
          }
        >
          <option value="all">Any day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekend">Weekend</option>
          {[1, 2, 3, 4, 5, 6, 0].map((day) => (
            <option key={day} value={day}>
              {weekdayNames[day]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Patch
        <select aria-label="Profile patch" value={view.patch} onChange={(e) => change({ patch: e.target.value })}>
          <option value="all">All patches</option>
          {patches.map((patch) => (
            <option key={patch.name} value={patch.name}>
              {patch.name}
            </option>
          ))}
          <option value="unknown">Patch unknown</option>
        </select>
      </label>
    </>
  );
}

/** What the colours mean, behind the ⓘ button. */
export function ColourLegend() {
  const imp = ['≤ −41', '−40…−26', '−25…−11', '−10…+10', '+11…+25', '+26…+40', '≥ +41'];
  return (
    <div className="profile-legend">
      <p>Statistics: compared with the average of the hero on that position in the match bracket (STRATZ).</p>
      <div className="profile-legend-scale">
        {['Terrible', 'Bad', 'Below', 'Typical', 'Above', 'Good', 'Exceptional'].map((label, band) => (
          <span key={label} className={band === 3 ? '' : `stat-band-${band}`}>
            {label}
          </span>
        ))}
      </div>
      <p>Deaths are at best white. No position or average: no colour.</p>
      <p>IMP (STRATZ, 0 = average game):</p>
      <div className="profile-legend-scale">
        {imp.map((label, tier) => (
          <span key={label} className={`imp imp-${tier}`}>
            {label}
          </span>
        ))}
      </div>
      <p>
        Win rate: <span className="wr-good">above 52%</span>, <span className="wr-bad">below 48%</span>, grey under 10
        games. MMR change: + green, − red.
      </p>
    </div>
  );
}

/** One sticky row: period, hero, result, ranked and Turbo, More, active chips, count, Columns, legend. */
export function FilterBar({
  view,
  change,
  heroes,
  heroIds,
  patches,
  shown,
  loaded,
  withoutPosition,
  turboDefault = false,
}: {
  view: ProfileView;
  change: Change;
  heroes: Hero[];
  /** Heroes of the loaded matches, for the hero select. */
  heroIds: number[];
  patches: Patch[];
  shown: number;
  loaded: number;
  withoutPosition: number;
  /** Turbo as set in Settings: only a change from it is an active filter. */
  turboDefault?: boolean;
}) {
  const heroName = (id: number) => heroes.find((hero) => hero.id === id)?.localized_name ?? `Hero #${id}`;
  const chips: { label: string; clear: Partial<ProfileView> }[] = [
    ...(view.position ? [{ label: roleName(view.position), clear: { position: 0 as const } }] : []),
    ...(view.hero ? [{ label: heroName(view.hero), clear: { hero: 0 } }] : []),
    ...(view.result !== 'all'
      ? [{ label: view.result === 'win' ? 'Wins' : 'Losses', clear: { result: 'all' as const } }]
      : []),
    ...(view.includeTurbo !== turboDefault
      ? [{ label: view.includeTurbo ? 'Turbo included' : 'Turbo excluded', clear: { includeTurbo: turboDefault } }]
      : []),
    ...(view.modes === 'all' ? [{ label: 'All modes', clear: { modes: 'match' as const } }] : []),
    ...(view.duration !== 'all'
      ? [{ label: durationRanges[view.duration].label, clear: { duration: 'all' as const } }]
      : []),
    ...(view.timeOfDay !== 'all'
      ? [{ label: `${timesOfDay[view.timeOfDay].label}, local start`, clear: { timeOfDay: 'all' as const } }]
      : []),
    ...(view.weekday !== 'all'
      ? [
          {
            label:
              view.weekday === 'weekdays'
                ? 'Weekdays'
                : view.weekday === 'weekend'
                  ? 'Weekend'
                  : weekdayNames[view.weekday]!,
            clear: { weekday: 'all' as const },
          },
        ]
      : []),
    ...(view.patch !== 'all'
      ? [{ label: view.patch === 'unknown' ? 'Patch unknown' : `Patch ${view.patch}`, clear: { patch: 'all' } }]
      : []),
  ];
  const segment = <T extends string | number>(value: T, current: T, label: string, set: () => void) => (
    <button key={String(value)} aria-pressed={value === current} onClick={set}>
      {label}
    </button>
  );
  return (
    <div className="profile-bar">
      <span className="profile-segments" role="group" aria-label="Period">
        {([7, 30, 90, 0] as const).map((days) =>
          segment(days, view.days, days ? `${days}d` : 'All', () => change({ days })),
        )}
      </span>
      <select
        className="profile-control"
        aria-label="Profile hero"
        value={view.hero}
        onChange={(e) => change({ hero: Number(e.target.value) })}
      >
        <option value={0}>All heroes</option>
        {[...heroIds]
          .sort((a, b) => heroName(a).localeCompare(heroName(b)))
          .map((id) => (
            <option key={id} value={id}>
              {heroName(id)}
            </option>
          ))}
      </select>
      <span className="profile-segments" role="group" aria-label="Result">
        {segment('all', view.result, 'All', () => change({ result: 'all' }))}
        {segment('win', view.result, 'Wins', () => change({ result: 'win' }))}
        {segment('loss', view.result, 'Losses', () => change({ result: 'loss' }))}
      </span>
      <button
        className="profile-control profile-toggle"
        aria-pressed={view.rankedOnly}
        onClick={() => change({ rankedOnly: !view.rankedOnly })}
      >
        Ranked
      </button>
      <button
        className="profile-control profile-toggle profile-wide"
        aria-pressed={view.includeTurbo}
        onClick={() => change({ includeTurbo: !view.includeTurbo })}
      >
        Turbo
      </button>
      <ProfileMenu label="More" caret>
        <MoreFilters view={view} change={change} patches={patches} />
      </ProfileMenu>
      {chips.length > 0 && (
        <span className="profile-chips" aria-label="Active filters">
          {chips.map((chip) => (
            <span key={chip.label} className="filter-chip">
              {chip.label}
              <button
                className="icon-button"
                aria-label={`Clear filter: ${chip.label}`}
                onClick={() => change(chip.clear)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </span>
      )}
      <span className="profile-count">
        {shown} of {loaded} loaded{withoutPosition ? ` · ${withoutPosition} without position` : ''}
      </span>
      <span className="profile-wide">
        <ProfileMenu label="Columns" caret>
          {(
            [
              ['lhdn', 'LH / DN'],
              ['xpm', 'XPM'],
              ['damage', 'Damage'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={view.columns[key]}
                onChange={(e) => change({ columns: { ...view.columns, [key]: e.target.checked } })}
              />
              {label}
            </label>
          ))}
        </ProfileMenu>
      </span>
      <button className="profile-control profile-info" aria-label="Colours" {...tip(<ColourLegend />)}>
        <Info size={15} />
      </button>
    </div>
  );
}
