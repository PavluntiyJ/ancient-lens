import { describe, expect, it } from 'vitest';
import { metaPicks } from '../src/shared/meta-picks';
import type { DraftData, PositionStat } from '../src/shared/draft';
import type { Hero } from '../src/shared/domain';

const heroes: Hero[] = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  localized_name: `Hero ${i + 1}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: [],
}));
const row = (heroId: number, matchCount = 200, winCount = 120, position = 'POSITION_1'): PositionStat => ({
  heroId,
  matchCount,
  winCount,
  position,
  week: 1,
});
const data = (positions: PositionStat[]): DraftData => ({ source: 'STRATZ', fetchedAt: '', positions, matchups: [] });
describe('meta picks', () => {
  it('sorts by win rate separately for all five positions, takes six eligible heroes', () => {
    const positions = [1, 2, 3, 4, 5].flatMap((p) => heroes.map((h) => row(h.id, 200, 100 + h.id, `POSITION_${p}`)));
    const result = metaPicks(heroes, data(positions), [12], [11]);
    for (const picks of Object.values(result)) {
      // A picked hero is gone; a banned one keeps its place, marked.
      expect(picks.map((p) => p.hero.id)).toEqual([11, 10, 9, 8, 7, 6]);
      expect(picks.map((p) => p.banned)).toEqual([true, false, false, false, false, false]);
      expect(picks[1].winRate).toBeCloseTo(55);
    }
    // A small sample with a higher raw rate ranks below a large one once shrunk.
    expect(metaPicks(heroes, data([row(1, 1000, 700), row(2, 200, 150)]), [])[1].map((p) => p.hero.id)).toEqual([1, 2]);
  });
  it('ignores positions a hero rarely plays, however high their win rate', () => {
    const result = metaPicks(
      heroes,
      data([
        row(1, 9000, 4500),
        row(1, 300, 200, 'POSITION_2'),
        row(2, 800, 440, 'POSITION_2'),
        row(2, 200, 110, 'POSITION_3'),
      ]),
      [],
    );
    expect(result[2].map((p) => p.hero.id)).toEqual([2]);
    // Exactly a fifth of the hero's games is still a main position; the raw rate is what is shown.
    expect(result[3].map((p) => p.hero.id)).toEqual([2]);
    expect(result[3][0].winRate).toBeCloseTo(55);
  });
  it('accepts exactly 200 matches, rejects missing and invalid data', () => {
    const result = metaPicks(
      heroes,
      data([
        row(1, 199),
        row(2),
        row(3, 200, 201),
        row(4, 200, -1),
        row(5, NaN),
        row(6, 200, 120, 'POSITION_6'),
        row(999),
      ]),
      [],
    );
    expect(result[1].map((p) => p.hero.id)).toEqual([2]);
    expect(result[2]).toEqual([]);
    expect(Object.values(metaPicks(heroes, undefined, [])).flat()).toEqual([]);
  });
  it('does not exclude hovered heroes and resolves equal rates deterministically', () => {
    expect(metaPicks(heroes, data([row(4), row(2), row(3)]), [3])[1].map((p) => p.hero.id)).toEqual([2, 4]);
  });
});
