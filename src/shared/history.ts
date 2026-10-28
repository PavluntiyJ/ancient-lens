import { formatDecimal, matchWon, type Match, type PlayerHistory } from './domain';
import { isRanked } from './rating-history';
import { matchPosition, type Position } from './roles';

/** A game patch and the day it was released (OpenDota constants). */
export type Patch = { name: string; date: string };
export type DurationRange = 'short' | 'medium' | 'long';
export type TimeOfDay = 'night' | 'morning' | 'afternoon' | 'evening';
/** JavaScript weekday (0 Sunday … 6 Saturday) or a group of days. */
export type Weekday = number | 'weekdays' | 'weekend';
export type HistoryFilter = {
  days: number;
  hero: number;
  result: 'all' | 'win' | 'loss';
  includeTurbo: boolean;
  rankedOnly?: boolean;
  modes?: 'match' | 'all';
  /** 0 or absent: every position. */
  position?: Position | 0;
  duration?: DurationRange | 'all';
  /** Local time of the match start. */
  timeOfDay?: TimeOfDay | 'all';
  weekday?: Weekday | 'all';
  /** A patch name, or matches outside the patch table. */
  patch?: string | 'unknown' | 'all';
  patches?: Patch[];
};

/** Under 25 minutes, 25 to 40, from 40. */
export const durationRanges: Record<DurationRange, { label: string; test(seconds: number): boolean }> = {
  short: { label: 'Under 25 min', test: (seconds) => seconds < 1500 },
  medium: { label: '25–40 min', test: (seconds) => seconds >= 1500 && seconds < 2400 },
  long: { label: '40 min and longer', test: (seconds) => seconds >= 2400 },
};
/** Local start hours: night 0–6, morning 6–12, afternoon 12–18, evening 18–24. */
export const timesOfDay: Record<TimeOfDay, { label: string; from: number }> = {
  night: { label: 'Night (0–6)', from: 0 },
  morning: { label: 'Morning (6–12)', from: 6 },
  afternoon: { label: 'Afternoon (12–18)', from: 12 },
  evening: { label: 'Evening (18–24)', from: 18 },
};
export const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function timeOfDay(match: Match): TimeOfDay {
  const hour = new Date(match.start_time * 1000).getHours();
  return hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}
function onWeekday(match: Match, weekday: Weekday) {
  const day = new Date(match.start_time * 1000).getDay();
  if (weekday === 'weekend') return day === 0 || day === 6;
  if (weekday === 'weekdays') return day > 0 && day < 6;
  return day === weekday;
}
/** The patch a match was played on: the latest one released before its start. Undefined
 * before the first patch of the table or without a table. */
export function patchOf(match: Pick<Match, 'start_time'>, patches: Patch[] | undefined): string | undefined {
  let found: { name: string; at: number } | undefined;
  for (const patch of patches ?? []) {
    const at = Date.parse(patch.date) / 1000;
    if (Number.isFinite(at) && at <= match.start_time && (!found || at > found.at)) found = { name: patch.name, at };
  }
  return found?.name;
}

export function filterHistory(matches: Match[], filter: HistoryFilter, now = Date.now()): Match[] {
  return matches.filter((match) => {
    const ended = (match.start_time + match.duration) * 1000;
    return (
      (!filter.position || matchPosition(match) === filter.position) &&
      (!filter.duration || filter.duration === 'all' || durationRanges[filter.duration].test(match.duration)) &&
      (!filter.timeOfDay || filter.timeOfDay === 'all' || timeOfDay(match) === filter.timeOfDay) &&
      (filter.weekday === undefined || filter.weekday === 'all' || onWeekday(match, filter.weekday)) &&
      (!filter.patch || filter.patch === 'all' || (patchOf(match, filter.patches) ?? 'unknown') === filter.patch) &&
      (!filter.days || ended >= now - filter.days * 86400000) &&
      (!filter.hero || match.hero_id === filter.hero) &&
      (!filter.rankedOnly ||
        isRanked(match) ||
        // Nor a lobby: a just recorded match stays until its match data tells otherwise.
        (match.local_only && match.lobby_type === undefined)) &&
      (filter.includeTurbo || match.game_mode !== 23) &&
      (filter.modes === 'all' ||
        // GSI reports no game mode: a match only the journal has counts as a matchmaking game.
        (match.local_only && match.game_mode === undefined) ||
        ([2, 3, 22, ...(filter.includeTurbo ? [23] : [])].includes(match.game_mode ?? -1) &&
          [0, 1, 2, 7, 9].includes(match.lobby_type ?? -1))) &&
      (filter.result === 'all' || matchWon(match) === (filter.result === 'win'))
    );
  });
}

export function averageKda(matches: Match[]): string {
  const values = matches.filter((match) =>
    [match.kills, match.deaths, match.assists].every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0,
    ),
  );
  if (!values.length) return '—';
  return (['kills', 'deaths', 'assists'] as const)
    .map((field) => formatDecimal(values.reduce((sum, match) => sum + match[field]!, 0) / values.length))
    .join(' / ');
}

/** The run of equal results ending with the latest match: the result filter is ignored, and
 * an unknown outcome ends the run. */
export function streakRun(
  matches: Match[],
  filter: HistoryFilter,
  now = Date.now(),
): { count: number; won: boolean } | undefined {
  const history = filterHistory(matches, { ...filter, result: 'all' }, now).sort(
    (a, b) => b.start_time - a.start_time || b.match_id - a.match_id,
  );
  const latest = history[0];
  const won = latest ? matchWon(latest) : null;
  if (won === null) return undefined;
  let count = 0;
  for (const match of history) {
    if (matchWon(match) !== won) break;
    count++;
  }
  return { count, won };
}
export function currentStreak(matches: Match[], filter: HistoryFilter, now = Date.now()): string {
  const run = streakRun(matches, filter, now);
  if (!run) return '—';
  const result = run.won ? (run.count === 1 ? 'win' : 'wins') : run.count === 1 ? 'loss' : 'losses';
  return `${run.count} ${result} in a row`;
}

/** Whether the loaded history can be called complete: more pages, a recent-only sample,
 * a failed request or a warning all make it partial. */
export function historyCoverage(
  data: Pick<PlayerHistory, 'hasMore' | 'limited' | 'historyUnavailable' | 'warning'>,
): 'complete' | 'recent' | 'incomplete' {
  if (data.hasMore || data.historyUnavailable || data.warning) return 'incomplete';
  return data.limited ? 'recent' : 'complete';
}

const modes: Record<number, string> = {
  1: 'All Pick',
  2: 'Captains Mode',
  3: 'Random Draft',
  4: 'Single Draft',
  5: 'All Random',
  16: 'Captains Draft',
  18: 'Ability Draft',
  22: 'All Pick',
  23: 'Turbo',
};
export function modeName(match: Match) {
  // A journal match with a rating change is ranked, but GSI never names its mode.
  if (match.game_mode === undefined) return isRanked(match) ? 'Ranked' : '—';
  const name = modes[match.game_mode] ?? `Mode ${match.game_mode}`;
  return isRanked(match) ? `R. ${name}` : name;
}
