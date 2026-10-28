import { matchWon, type Match, type MmrEntry } from './domain';
import { modeName } from './history';
import { killParticipation, deathParticipation } from './match-stats';
import { pointMatch } from './mmr-chart';
import { matchPosition } from './roles';
import type { MatchRating } from './rating-history';

export const historySorts = [
  'date',
  'hero',
  'mode',
  'duration',
  'kills',
  'deaths',
  'assists',
  'kda',
  'kp',
  'dp',
  'last_hits',
  'net_worth',
  'gold_per_min',
  'xp_per_min',
  'hero_damage',
  'tower_damage',
  'hero_healing',
  'imp',
  'position',
  'mmr',
] as const;
export type HistorySort = (typeof historySorts)[number];
export type SortDirection = 'asc' | 'desc';

/** Missing values stay last in either direction; ties retain newest-first history. */
export function sortProfileHistory(
  matches: Match[],
  key: HistorySort,
  direction: SortDirection,
  heroName: (id: number) => string,
  ratings: Map<number, MatchRating>,
): Match[] {
  const value = (m: Match): string | number | undefined => {
    switch (key) {
      case 'date':
        return m.start_time + m.duration;
      case 'hero':
        return heroName(m.hero_id);
      case 'mode':
        return modeName(m);
      case 'position':
        return matchPosition(m) || undefined;
      case 'mmr':
        return ratings.get(m.match_id)?.mmr;
      case 'kp':
        return killParticipation(m);
      case 'dp':
        return deathParticipation(m);
      case 'kda':
        return m.kills != null && m.deaths != null && m.assists != null
          ? (m.kills + m.assists) / Math.max(1, m.deaths)
          : undefined;
      default:
        return m[key] ?? undefined;
    }
  };
  return [...matches].sort((a, b) => {
    const x = value(a),
      y = value(b);
    const unknown = (v: string | number | undefined) =>
      v === undefined || (typeof v === 'number' && !Number.isFinite(v));
    if (unknown(x) !== unknown(y)) return unknown(x) ? 1 : -1;
    const compared = unknown(x)
      ? 0
      : typeof x === 'string' && typeof y === 'string'
        ? x.localeCompare(y)
        : Number(x) - Number(y);
    return compared * (direction === 'asc' ? 1 : -1) || b.start_time - a.start_time || b.match_id - a.match_id;
  });
}

/** Only measurements actually associated with a selected match enter a filtered chart. */
export function selectedRatingEntries(
  entries: MmrEntry[],
  matches: Match[],
  ratings: Map<number, MatchRating>,
  allMatches = matches,
) {
  const selected = new Set(matches.map((match) => match.match_id));
  return entries.filter((entry) => {
    const match = pointMatch(
      { value: entry.value, at: Date.parse(entry.createdAt) / 1000, source: entry.source },
      allMatches,
      ratings,
    );
    return match && selected.has(match.match_id);
  });
}

export function roleHistory(matches: Match[], position: number, ratings: Map<number, MatchRating>) {
  const rows = matches.filter((match) => matchPosition(match) === position);
  const played = rows.filter((match) => matchWon(match) !== null);
  const measured = rows.flatMap((match) => ratings.get(match.match_id) ?? []);
  const heroes = new Map<number, { hero: number; games: number; wins: number }>();
  for (const match of played) {
    const hero = heroes.get(match.hero_id) ?? { hero: match.hero_id, games: 0, wins: 0 };
    hero.games++;
    hero.wins += Number(matchWon(match));
    heroes.set(match.hero_id, hero);
  }
  const best = [...heroes.values()]
    .filter((hero) => hero.games >= 3)
    .sort((a, b) => b.wins / b.games - a.wins / a.games || b.games - a.games || a.hero - b.hero)[0];
  return {
    games: rows.length,
    played: played.length,
    wins: played.filter(matchWon).length,
    measured: measured.length,
    delta: measured.reduce((sum, value) => sum + value.delta, 0),
    best,
  };
}

/** The three most played heroes of a position: games, known results and measured MMR change. */
export function roleHeroes(matches: Match[], position: number, ratings: Map<number, MatchRating>) {
  const heroes = new Map<
    number,
    { hero: number; games: number; wins: number; losses: number; measured: number; delta: number }
  >();
  for (const match of matches) {
    if (matchPosition(match) !== position) continue;
    const hero = heroes.get(match.hero_id) ?? {
      hero: match.hero_id,
      games: 0,
      wins: 0,
      losses: 0,
      measured: 0,
      delta: 0,
    };
    hero.games++;
    const won = matchWon(match);
    if (won !== null) hero[won ? 'wins' : 'losses']++;
    const rating = ratings.get(match.match_id);
    if (rating) {
      hero.measured++;
      hero.delta += rating.delta;
    }
    heroes.set(match.hero_id, hero);
  }
  return [...heroes.values()].sort((a, b) => b.games - a.games || a.hero - b.hero).slice(0, 3);
}
