import { expect, it } from 'vitest';
import type { LineupEntry, Match } from '../src/shared/domain';
import { matchRanking } from '../src/shared/match-rank';

const player = (radiant: boolean, values: Partial<LineupEntry> = {}): LineupEntry => ({
  radiant,
  hero_id: 1,
  ...values,
});
const match = (lineup: LineupEntry[]): Match => ({
  match_id: 1,
  hero_id: 1,
  start_time: 0,
  duration: 1800,
  player_slot: 0,
  lineup,
});

it('ranks the ten players best first with shared places for ties and the missing last', () => {
  const lineup = [
    player(true, { own: true, gold_per_min: 500 }),
    player(true, { gold_per_min: 700 }),
    player(true, { gold_per_min: 500 }),
    player(false, {}),
    player(false, { gold_per_min: 300 }),
  ];
  const ranking = matchRanking(match(lineup), 'gold_per_min')!;
  expect(ranking.rows.map((row) => row.value)).toEqual([700, 500, 500, 300, undefined]);
  expect(ranking.rows.map((row) => row.place)).toEqual([1, 2, 2, 4, undefined]);
  expect(ranking.own).toEqual({ place: 2, of: 4 });
  expect(ranking.max).toBe(700);
  // The own row is listed first among equal values.
  expect(ranking.rows[1]!.entry.own).toBe(true);
});

it('sorts deaths and death participation lower first', () => {
  const lineup = [player(true, { own: true, deaths: 7 }), player(false, { deaths: 2 }), player(false, { deaths: 0 })];
  const ranking = matchRanking(match(lineup), 'deaths')!;
  expect(ranking.rows.map((row) => row.value)).toEqual([0, 2, 7]);
  expect(ranking.own).toEqual({ place: 3, of: 3 });
});

it('computes kill and death participation from each team total', () => {
  const team = (radiant: boolean, kills: number[], deaths: number[], assists = 0) =>
    kills.map((k, i) => player(radiant, { kills: k, deaths: deaths[i], assists }));
  const lineup = [
    ...team(true, [10, 5, 5, 0, 0], [1, 1, 1, 1, 6], 2),
    ...team(false, [2, 2, 2, 2, 2], [4, 4, 4, 4, 4]),
  ];
  lineup[0]!.own = true;
  const kp = matchRanking(match(lineup), 'kp')!;
  // Radiant killed 20: (10 + 2) / 20 = 60%; Dire killed 10: (2 + 0) / 10 = 20%.
  expect(kp.rows[0]).toMatchObject({ value: 60, place: 1 });
  expect(kp.rows.filter((row) => !row.entry.radiant).every((row) => row.value === 20)).toBe(true);
  const dp = matchRanking(match(lineup), 'dp')!;
  expect(dp.rows[0]!.value).toBe(10);
  expect(dp.rows.at(-1)!.value).toBe(60);
});

it('leaves participation unknown for a team without all five totals', () => {
  const lineup = [player(true, { own: true, kills: 3, assists: 1 }), player(false, { kills: 1, assists: 1 })];
  const ranking = matchRanking(match(lineup), 'kp')!;
  expect(ranking.rows.every((row) => row.value === undefined)).toBe(true);
  expect(ranking.own).toBeUndefined();
});

it('is undefined for a match without a lineup and keeps negative IMP in range', () => {
  expect(matchRanking({ ...match([]), lineup: undefined }, 'kills')).toBeUndefined();
  const ranking = matchRanking(match([player(true, { own: true, imp: -12 }), player(false, { imp: 20 })]), 'imp')!;
  expect([ranking.min, ranking.max]).toEqual([-12, 20]);
});
