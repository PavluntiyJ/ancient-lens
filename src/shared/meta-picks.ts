import type { Hero } from './domain';
import { MAIN_POSITION_SHARE, type DraftData } from './draft';
import type { Position } from './roles';

/** A banned hero keeps its place in the ranking and is shown struck through. */
export type MetaPick = { hero: Hero; winRate: number; games: number; wins: number; banned: boolean };

/** Pick suggestions use the same main positions. Below the share, the few players who take the
 * hero there are specialists, and their win rate is not the hero's meta strength (Crystal
 * Maiden mid at 1% of her games, for example). */
export const META_MAIN_POSITION_SHARE = MAIN_POSITION_SHARE;
// Position win rates spread with τ² ≈ 8.6 pp² across rows with ≥5,000 games (STRATZ, 23 Oct 2026),
// so k = 2500/τ² ≈ 290 games. Ranking uses the shrunk rate; the raw rate is shown.
const META_SHRINKAGE = 290;

const valid = (row: DraftData['positions'][number]) =>
  /^POSITION_[1-5]$/.test(row.position) &&
  Number.isSafeInteger(row.matchCount) &&
  row.matchCount > 0 &&
  Number.isSafeInteger(row.winCount) &&
  row.winCount >= 0 &&
  row.winCount <= row.matchCount;

export function metaPicks(
  heroes: Hero[],
  data: DraftData | undefined,
  confirmed: number[],
  bans: number[] = [],
): Record<Position, MetaPick[]> {
  const result: Record<Position, (MetaPick & { rank: number })[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const picked = new Set(confirmed),
    banned = new Set(bans);
  const rows = (data?.positions ?? []).filter(valid);
  const totals = new Map<number, number>();
  for (const row of rows) totals.set(row.heroId, (totals.get(row.heroId) ?? 0) + row.matchCount);
  for (const row of rows) {
    if (row.matchCount < 200 || row.matchCount / totals.get(row.heroId)! < META_MAIN_POSITION_SHARE) continue;
    const hero = heroes.find((hero) => hero.id === row.heroId);
    if (!hero || picked.has(hero.id)) continue;
    const winRate = (row.winCount / row.matchCount) * 100;
    result[Number(row.position.slice(-1)) as Position].push({
      hero,
      winRate,
      games: row.matchCount,
      wins: row.winCount,
      banned: banned.has(hero.id),
      rank: 50 + ((winRate - 50) * row.matchCount) / (row.matchCount + META_SHRINKAGE),
    });
  }
  const picks = {} as Record<Position, MetaPick[]>;
  for (const position of [1, 2, 3, 4, 5] as const)
    picks[position] = result[position]
      .sort((a, b) => b.rank - a.rank || a.hero.id - b.hero.id)
      .slice(0, 6)
      .map(({ rank: _, ...pick }) => pick);
  return picks;
}
