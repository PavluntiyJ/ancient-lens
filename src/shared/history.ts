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
/** The game mode's name; undefined when the source did not name it (negative: unmapped). */
export function gameModeName(match: Pick<Match, 'game_mode'>): string | undefined {
  if (match.game_mode === undefined || match.game_mode < 0) return undefined;
  return modes[match.game_mode] ?? `Mode ${match.game_mode}`;
}
export function modeName(match: Match) {
  const name = gameModeName(match);
  // A journal match with a rating change is ranked, but GSI never names its mode.
  if (name === undefined) return isRanked(match) ? 'Ranked' : '—';
  return isRanked(match) ? `R. ${name}` : name;
}

/** Valve lobby types (the numbering OpenDota uses; STRATZ names are mapped to it). Lobby type
 * 1 is a practice or custom lobby, not a tournament: tournament lobbies are 2. */
const lobbies: Record<number, { name: string; detail: string }> = {
  0: { name: 'Unranked', detail: 'Unranked matchmaking' },
  1: { name: 'Lobby', detail: 'Practice or custom lobby' },
  2: { name: 'Tournament', detail: 'Tournament lobby' },
  4: { name: 'Bots', detail: 'Co-op against bots' },
  7: { name: 'Ranked', detail: 'Ranked matchmaking' },
  8: { name: '1v1 Mid', detail: '1v1 mid matchmaking' },
  9: { name: 'Battle Cup', detail: 'Battle Cup' },
  12: { name: 'Event', detail: 'Event game' },
};
/** The lobby a match was played in; undefined when the source did not say. */
export function lobbyName(match: Pick<Match, 'lobby_type'>): { name: string; detail: string } | undefined {
  if (match.lobby_type === undefined || match.lobby_type < 0) return undefined;
  return lobbies[match.lobby_type] ?? { name: 'Other', detail: `Lobby type ${match.lobby_type}` };
}
/** Players of the own team who queued together, the player included (1 is solo); undefined
 * when the provider recorded no party. */
export function partySize(match: Pick<Match, 'party_size'>): number | undefined {
  const size = match.party_size;
  return typeof size === 'number' && Number.isInteger(size) && size >= 1 && size <= 5 ? size : undefined;
}
/** Sort key of the game type: lobby, then mode, then party size; undefined when all are unknown. */
export function gameTypeKey(match: Match): string | undefined {
  const parts = [lobbyName(match)?.name, gameModeName(match), partySize(match)];
  return parts.every((part) => part === undefined) ? undefined : parts.map((part) => part ?? '~').join(' ');
}
