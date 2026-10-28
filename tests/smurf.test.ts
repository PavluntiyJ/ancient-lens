import { describe, expect, it } from 'vitest';
import { isSmurf, medianMatches } from '../src/shared/smurf';

const player = (games: number, wins = games * 0.56, isPublic = true, accountId = '2') => ({
  accountId,
  isPublic,
  total: { games, wins },
});
describe('smurf heuristic', () => {
  it('uses the upper median, including odd counts', () => {
    expect(medianMatches([])).toBe(0);
    expect(medianMatches([player(100)])).toBe(0);
    expect(medianMatches([player(200), player(100)])).toBe(200);
    expect(medianMatches([player(300), player(100), player(200)])).toBe(300);
    expect(medianMatches([100, 200, 300, 400, 500].map((n) => player(n)))).toBe(400);
    expect(medianMatches([100, 200, 300, 400].map((n) => player(n)))).toBe(300);
    expect(medianMatches([player(100), player(0), player(900, 800, false), { accountId: '3' }, player(200)])).toBe(200);
  });
  it('uses lifetime totals and inclusive thresholds without rounding win rate', () => {
    expect(isSmurf(player(1300, 728), '1', 4000)).toBe(true);
    expect(isSmurf(player(1300, 727), '1', 4000)).toBe(false);
    expect(isSmurf(player(1301, 900), '1', 4000)).toBe(false);
    expect(isSmurf(player(1500, 840), '1', 6000)).toBe(true);
    expect(isSmurf(player(1501, 900), '1', 6000)).toBe(false);
  });
  it('excludes self, private or unknown visibility, missing or invalid totals', () => {
    expect(isSmurf(player(100, 80), '2', 4000)).toBe(false);
    expect(isSmurf(player(100, 80, false), '1', 4000)).toBe(false);
    expect(isSmurf({ accountId: '2', total: { games: 100, wins: 80 } }, '1', 4000)).toBe(false);
    expect(isSmurf({ accountId: '2', isPublic: true }, '1', 4000)).toBe(false);
    for (const median of [0, -1, NaN, Infinity]) expect(isSmurf(player(100, 80), '1', median)).toBe(false);
    for (const [games, wins] of [
      [0, 0],
      [100, 101],
      [100, -1],
      [NaN, 90],
    ])
      expect(isSmurf(player(games, wins), '1', 4000)).toBe(false);
  });
});
