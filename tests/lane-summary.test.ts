import { expect, it } from 'vitest';
import type { DraftData, HeroPair } from '../src/shared/draft';
import { laneSummary, type LaneHero } from '../src/shared/lane-summary';

// Advantage of hero a over/with b: symmetric tables, so only the sign of each direction matters.
const pair = (heroId1: number, heroId2: number, synergy: number): HeroPair => ({
  heroId1,
  heroId2,
  matchCount: 1_000_000,
  winCount: 500_000,
  synergy,
});
function data(vs: Record<string, number>, together: Record<string, number> = {}): DraftData {
  const ids = [...new Set([...Object.keys(vs), ...Object.keys(together)].flatMap((key) => key.split('-').map(Number)))];
  const value = (table: Record<string, number>, a: number, b: number) =>
    table[`${a}-${b}`] ?? (table[`${b}-${a}`] === undefined ? undefined : -table[`${b}-${a}`]!);
  const withValue = (a: number, b: number) => together[`${a}-${b}`] ?? together[`${b}-${a}`];
  return {
    source: 'STRATZ',
    fetchedAt: '2026-10-24T00:00:00Z',
    positions: [],
    rawPairs: true,
    matchups: ids.map((id) => ({
      heroId: id,
      vs: ids.flatMap((other) => (value(vs, id, other) === undefined ? [] : [pair(id, other, value(vs, id, other)!)])),
      with: ids.flatMap((other) =>
        withValue(id, other) === undefined ? [] : [pair(id, other, withValue(id, other)!)],
      ),
    })),
  };
}
const hero = (heroId: number | undefined, position: 1 | 2 | 3 | 4 | 5, guessed = false): LaneHero => ({
  heroId,
  position,
  guessed,
});

it('pairs the lanes by role: Radiant safe against Dire off, mid against mid, off against safe', () => {
  const radiant = [hero(1, 1), hero(2, 2), hero(3, 3), hero(4, 4), hero(5, 5, true)];
  const dire = [hero(11, 1), hero(12, 2), hero(13, 3), hero(14, 4), hero(15, 5)];
  const summary = laneSummary(radiant, dire, data({ '1-13': 2, '1-14': 1, '5-13': -1, '5-14': 0.5, '2-12': -3 }), 50);
  expect(summary.lanes.map((lane) => lane.id)).toEqual(['safe', 'mid', 'off']);
  expect(summary.lanes[0]!.radiant.map((h) => h.heroId)).toEqual([1, 5]);
  expect(summary.lanes[0]!.dire.map((h) => h.heroId)).toEqual([13, 14]);
  expect(summary.lanes[0]!.advantage).toBeCloseTo(2.5);
  expect(summary.lanes[0]!.pairs).toEqual({ known: 4, expected: 4 });
  expect(summary.lanes[1]!.advantage).toBeCloseTo(-3);
  // The off lane has no pair data at all: unknown, not zero.
  expect(summary.lanes[2]!.advantage).toBeUndefined();
  expect(summary.lanes[0]!.radiant[1]!.guessed).toBe(true);
});

it('shows a lane with a missing hero as unknown and keeps the totals over known pairs', () => {
  const radiant = [hero(1, 1), hero(2, 2), hero(undefined, 3), hero(4, 4), hero(5, 5)];
  const dire = [hero(11, 1), hero(12, 2), hero(13, 3), hero(14, 4), hero(15, 5)];
  const summary = laneSummary(
    radiant,
    dire,
    data({ '4-11': 1, '1-13': 2, '2-12': 1 }, { '1-5': 2, '1-4': 1, '11-15': 4 }),
    50,
  );
  const off = summary.lanes[2]!;
  expect(off.radiant.map((h) => h.heroId)).toEqual([undefined, 4]);
  expect(off.advantage).toBeUndefined();
  // Counter: every known Radiant–Dire pair; synergy: Radiant pairs minus Dire pairs.
  expect(summary.counter).toBeCloseTo(4);
  expect(summary.synergy).toBeCloseTo(3 - 4);
  expect(summary.total).toBeCloseTo(4 + (3 - 4) * 0.5);
});

it('leaves a position nobody holds empty and totals unknown without data', () => {
  const summary = laneSummary([hero(1, 1)], [], data({}), 50);
  expect(summary.lanes[0]!.radiant.map((h) => h.heroId)).toEqual([1, undefined]);
  expect(summary.lanes[1]!.dire).toEqual([{ position: 2, guessed: false }]);
  expect([summary.counter, summary.synergy, summary.total]).toEqual([undefined, undefined, undefined]);
});
