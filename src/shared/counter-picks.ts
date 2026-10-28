import type { Hero } from './domain';
import { pairAdvantage, type DraftData } from './draft';

export type CounterPick = { hero: Hero; advantage: number; multiple: boolean };
export type EnemyCounters = { enemy: Hero; counters: CounterPick[] };

export function counterPicks(
  heroes: Hero[],
  data: DraftData | undefined,
  enemies: number[],
  confirmed: number[],
  bans: number[] = [],
): EnemyCounters[] {
  if (!data) return [];
  const excluded = new Set([...confirmed, ...bans]);
  const rows = [...new Set(enemies)].flatMap((id) => {
    const enemy = heroes.find((hero) => hero.id === id);
    if (!enemy) return [];
    const pairs = data.matchups.find((row) => row.heroId === id)?.vs;
    const counters = heroes
      .filter((hero) => !excluded.has(hero.id))
      .flatMap((hero) => {
        const value = pairAdvantage(pairs?.find((pair) => pair.heroId1 === id && pair.heroId2 === hero.id));
        return value === undefined ? [] : [{ hero, advantage: -value, multiple: false }];
      })
      .sort((a, b) => b.advantage - a.advantage || a.hero.id - b.hero.id)
      .slice(0, 10);
    return [{ enemy, counters }];
  });
  const counts = new Map<number, number>();
  for (const row of rows)
    for (const pick of row.counters) counts.set(pick.hero.id, (counts.get(pick.hero.id) ?? 0) + 1);
  return rows.map((row) => ({
    ...row,
    counters: row.counters.map((pick) => ({ ...pick, multiple: counts.get(pick.hero.id)! >= 2 })),
  }));
}
