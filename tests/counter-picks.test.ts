import { describe, expect, it } from 'vitest';
import { counterPicks } from '../src/shared/counter-picks';
import { pairAdvantage, type DraftData, type HeroPair } from '../src/shared/draft';
import type { Hero } from '../src/shared/domain';

const heroes: Hero[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  localized_name: `Hero ${i + 1}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: [],
}));
const pair = (heroId1: number, heroId2: number, synergy: number | null): HeroPair => ({
  heroId1,
  heroId2,
  synergy,
  matchCount: 2000,
  winCount: 1000,
});
const data = (pairs: HeroPair[]): DraftData => ({
  source: 'STRATZ',
  fetchedAt: '',
  positions: [],
  matchups: [1, 2].map((heroId) => ({ heroId, vs: pairs.filter((p) => p.heroId1 === heroId), with: [] })),
});
describe('counter picks', () => {
  it('inverts only the enemy pair through the shared evaluator and sorts descending', () => {
    const a = pair(1, 3, -6),
      b = pair(1, 4, 2);
    const rows = counterPicks(heroes, data([b, a]), [1], [1]);
    expect(rows[0].counters.map((p) => p.hero.id)).toEqual([3, 4]);
    expect(rows[0].counters.map((p) => p.advantage)).toEqual([-pairAdvantage(a)!, -pairAdvantage(b)!]);
    expect(counterPicks(heroes, data([pair(2, 1, -10)]), [1], [1])[0].counters).toEqual([]);
  });
  it('skips missing/unusable evidence, confirmed picks and bans, but keeps hovers', () => {
    const rows = counterPicks(
      heroes,
      data([pair(1, 2, -5), pair(1, 3, -4), pair(1, 4, -3), pair(1, 5, null)]),
      [1],
      [1, 2],
      [3],
    );
    expect(rows[0].counters.map((p) => p.hero.id)).toEqual([4]);
    expect(counterPicks(heroes, undefined, [1], [])).toEqual([]);
    expect(counterPicks(heroes, data([]), [], [])).toEqual([]);
  });
  it('takes ten eligible heroes and marks repeats across distinct enemy lists', () => {
    const pairs = [1, 2].flatMap((id) => heroes.map((hero) => pair(id, hero.id, -hero.id)));
    const rows = counterPicks(heroes, data(pairs), [1, 1, 2, 999], [1, 2, 20], [19]);
    expect(rows).toHaveLength(2);
    expect(rows[0].counters.map((p) => p.hero.id)).toEqual([18, 17, 16, 15, 14, 13, 12, 11, 10, 9]);
    expect(rows.every((row) => row.counters.every((p) => p.multiple))).toBe(true);
    expect(counterPicks(heroes, data(pairs), [1, 1], [1])[0].counters.every((p) => !p.multiple)).toBe(true);
  });
});
