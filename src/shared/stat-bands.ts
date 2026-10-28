import type { HeroAverageRow, Match } from './domain';
import { killParticipation } from './match-stats';
import { bracketOfTier, type RankBracket } from './rank-bracket';
import { matchPosition } from './roles';

/** Statistics the profile colours against the bracket average of the hero on its position. */
export type StatKey =
  'kills' | 'deaths' | 'assists' | 'kp' | 'last_hits' | 'gold_per_min' | 'xp_per_min' | 'hero_damage';
export type StatBand = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const statBandLabels = [
  'Terrible',
  'Bad',
  'Below typical',
  'Typical',
  'Above typical',
  'Good',
  'Exceptional',
] as const;

/**
 * Band of a value against its average, as in the agreed mockup (v9): worse below 0.85, 0.65
 * and 0.45 of it, better above 1.15, 1.35 and 1.7. Deaths are worse from 1.25, 1.6 and 2
 * times the average and never better than typical.
 */
export function statBand(value: number, average: number, key: StatKey): StatBand | null {
  if (!Number.isFinite(value) || !Number.isFinite(average) || average <= 0) return null;
  const ratio = value / average;
  if (key === 'deaths') return ratio >= 2 ? 0 : ratio >= 1.6 ? 1 : ratio >= 1.25 ? 2 : 3;
  if (ratio < 0.45) return 0;
  if (ratio < 0.65) return 1;
  if (ratio < 0.85) return 2;
  if (ratio <= 1.15) return 3;
  if (ratio <= 1.35) return 4;
  if (ratio <= 1.7) return 5;
  return 6;
}

/** Statistics counted over the whole game; they grow with its length. */
const counts: Partial<Record<StatKey, keyof HeroAverageRow>> = {
  kills: 'kills',
  deaths: 'deaths',
  assists: 'assists',
  last_hits: 'cs',
  hero_damage: 'heroDamage',
};
/** Rates: independent of the game length. */
const rates: Partial<Record<StatKey, keyof HeroAverageRow>> = { gold_per_min: 'goldPerMinute', kp: 'killContribution' };
/** Games a timeline minute needs before it is compared with. */
const ENOUGH = 50;

const read = (row: HeroAverageRow, key: StatKey): number | undefined => {
  if (key === 'xp_per_min') return row.xp != null && row.time ? row.xp / row.time : undefined;
  const field = counts[key] ?? rates[key];
  const value = field ? row[field] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/** Minutes before the last timeline row whose growth carries a longer game on. */
const TAIL = 5;

/**
 * What the hero has on the match position at the minute the game ended. STRATZ rows are a
 * timeline: cumulative values at each minute (0 to 35) over the games still running then.
 * A longer game continues counted statistics and XP at their growth over the last five
 * minutes of the timeline, since late minutes add more than the average minute.
 */
export function expectedValue(rows: HeroAverageRow[], match: Match, key: StatKey): number | undefined {
  const position = matchPosition(match);
  if (!position) return undefined;
  const own = rows.filter((row) => row.heroId === match.hero_id && row.position === position);
  const minutes = match.duration / 60;
  const timed = own.filter((row) => row.time);
  if (!timed.length) {
    const plain = own.find((row) => row.time == null);
    return plain ? read(plain, key) : undefined;
  }
  const last = timed.reduce((best, row) => (row.time! > best.time! ? row : best));
  const target = Math.min(Math.round(minutes), last.time!);
  const nearest = timed.reduce((best, row) =>
    Math.abs(row.time! - target) < Math.abs(best.time! - target) ? row : best,
  );
  if (nearest.matchCount < ENOUGH) return undefined;
  const value = read(nearest, key);
  const grows = counts[key] ?? (key === 'xp_per_min' ? 'xp' : undefined);
  if (value === undefined || !grows || Math.round(minutes) <= last.time!) return value;
  const end = last[grows];
  const start = timed.find((row) => row.time === last.time! - TAIL)?.[grows];
  // Without the earlier minute, the average minute so far.
  const total =
    typeof end !== 'number'
      ? undefined
      : typeof start === 'number'
        ? end + ((end - start) / TAIL) * (minutes - last.time!)
        : (end * minutes) / last.time!;
  return total === undefined ? undefined : key === 'xp_per_min' ? total / minutes : total;
}

/** The profile's own number for a statistic, as the table shows it. */
export function ownValue(match: Match, key: StatKey): number | undefined {
  const value = key === 'kp' ? killParticipation(match) : match[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** STRATZ bracket of the match from its rank (STRATZ `rank`, about the players' average);
 * until STRATZ has one, the median medal the live match showed. */
export function matchBracket(match: Pick<Match, 'average_rank' | 'medal_rank'>): RankBracket | undefined {
  return bracketOfTier(match.average_rank ?? match.medal_rank);
}

/** Win rate colour: green above 52%, red below 48%, grey under ten games. */
export function profileWinRateTone(wins: number, games: number): 'good' | 'bad' | 'neutral' | 'few' {
  if (games < 10) return 'few';
  const rate = (wins / games) * 100;
  return rate > 52 ? 'good' : rate < 48 ? 'bad' : 'neutral';
}
