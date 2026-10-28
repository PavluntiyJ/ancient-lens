import type { Match } from './domain';

export type PoolTag = 'recent' | 'heavy';
export const poolExplanation: Record<PoolTag, string> = {
  recent: 'Recent spam: all of the last 5 games, or more than 6 of the last 10, on this hero.',
  heavy: 'Heavy spam: at least 60% of the games in this sample (25 or more) on this hero.',
};

/**
 * Narrow hero pool markers: Recent when one hero fills the last
 * five games, otherwise more than six of the last ten (needs ten games); Heavy when the
 * sample has at least 25 games and one hero has 60% of them. Heavy replaces Recent for
 * the same hero.
 */
export function heroPool(matches: Match[], heroes: { hero_id: number; games: number }[]): Map<number, PoolTag> {
  const tags = new Map<number, PoolTag>();
  const recent = [...matches].sort((a, b) => b.start_time - a.start_time || b.match_id - a.match_id);
  const lastFive = recent.slice(0, 5);
  if (lastFive.length === 5 && lastFive.every((match) => match.hero_id === lastFive[0]!.hero_id))
    tags.set(lastFive[0]!.hero_id, 'recent');
  else if (recent.length >= 10) {
    const counts = new Map<number, number>();
    for (const match of recent.slice(0, 10)) counts.set(match.hero_id, (counts.get(match.hero_id) ?? 0) + 1);
    for (const [hero, count] of counts) if (count > 6) tags.set(hero, 'recent');
  }
  const total = heroes.reduce((sum, row) => sum + row.games, 0);
  if (total >= 25)
    for (const row of heroes) if (row.games / total >= 0.6 && row.hero_id > 0) tags.set(row.hero_id, 'heavy');
  return tags;
}
