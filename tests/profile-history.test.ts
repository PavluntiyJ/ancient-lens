import { expect, it } from 'vitest';
import type { Match, MmrEntry } from '../src/shared/domain';
import { roleHeroes, roleHistory, selectedRatingEntries, sortProfileHistory } from '../src/shared/profile-history';

const match = (id: number, extra: Partial<Match> = {}): Match => ({
  match_id: id,
  hero_id: id,
  start_time: id * 3600,
  duration: 1800,
  player_slot: 0,
  radiant_win: true,
  lobby_type: 7,
  ...extra,
});

it('sorts the whole loaded sample without moving missing values to the front or changing the input', () => {
  const rows = [
    match(1, { gold_per_min: 400 }),
    match(2, { gold_per_min: null }),
    match(3, { gold_per_min: 600 }),
    match(4, { gold_per_min: 400 }),
  ];
  const sorted = (direction: 'asc' | 'desc') =>
    sortProfileHistory(rows, 'gold_per_min', direction, String, new Map()).map((m) => m.match_id);
  expect(sorted('desc')).toEqual([3, 4, 1, 2]);
  expect(sorted('asc')).toEqual([4, 1, 3, 2]);
  expect(rows.map((m) => m.match_id)).toEqual([1, 2, 3, 4]);
  for (const direction of ['asc', 'desc'] as const) {
    expect(
      sortProfileHistory(
        [match(1), match(2, { position: 'POSITION_1' })],
        'position',
        direction,
        String,
        new Map(),
      ).map((m) => m.match_id),
    ).toEqual([2, 1]);
  }
  expect(
    sortProfileHistory(
      rows,
      'mmr',
      'desc',
      String,
      new Map([
        [1, { mmr: 4000, delta: 25 }],
        [4, { mmr: 3500, delta: -25 }],
      ]),
    ).map((m) => m.match_id),
  ).toEqual([1, 4, 3, 2]);
});

it('keeps manual and unassociated measurements out of a selected-match chart', () => {
  const rows = [match(1), match(2)];
  const entries: MmrEntry[] = rows.map((m, i) => ({
    id: String(i),
    accountId: '1',
    source: 'dota-memory',
    value: 4000 + i * 25,
    createdAt: new Date((m.start_time + m.duration + 60) * 1000).toISOString(),
  }));
  entries.push({ ...entries[0]!, id: 'manual', source: 'manual' });
  const ratings = new Map([
    [1, { mmr: 4000, delta: 25 }],
    [2, { mmr: 4025, delta: 25 }],
  ]);
  expect(selectedRatingEntries(entries, [rows[1]!], ratings).map((e) => e.id)).toEqual(['1']);
  expect(selectedRatingEntries(entries, [], ratings)).toEqual([]);
  // Filtering must not reassign a reading to an older selected match with the same MMR.
  const repeated = new Map([
    [1, { mmr: 4025, delta: 25 }],
    [2, { mmr: 4025, delta: 0 }],
  ]);
  expect(selectedRatingEntries([entries[1]!], [rows[0]!], repeated, rows)).toEqual([]);
});

it('uses known outcomes and measured deltas only, and requires a sample for the best hero', () => {
  const rows = [
    match(1, { position: 'POSITION_1', hero_id: 10 }),
    match(2, { position: 'POSITION_1', hero_id: 10, radiant_win: false }),
    match(3, { position: 'POSITION_1', hero_id: 10 }),
    match(4, { position: 'POSITION_1', hero_id: 20 }),
    match(5, { position: 'POSITION_1', radiant_win: null }),
    match(6, { position: 'POSITION_2' }),
  ];
  expect(
    roleHistory(
      rows,
      1,
      new Map([
        [1, { mmr: 4000, delta: 25 }],
        [3, { mmr: 3975, delta: -25 }],
      ]),
    ),
  ).toEqual({ games: 5, played: 4, wins: 3, measured: 2, delta: 0, best: { hero: 10, games: 3, wins: 2 } });
});

it('lists the three most played heroes of a position with games, results and MMR', () => {
  const rows = [
    match(1, { position: 'POSITION_3', hero_id: 10 }),
    match(2, { position: 'POSITION_3', hero_id: 10, radiant_win: false }),
    match(3, { position: 'POSITION_3', hero_id: 10, radiant_win: null }),
    match(4, { position: 'POSITION_3', hero_id: 20 }),
    match(5, { position: 'POSITION_3', hero_id: 30 }),
    match(6, { position: 'POSITION_3', hero_id: 40 }),
    match(7, { position: 'POSITION_3', hero_id: 40, radiant_win: false }),
    match(8, { position: 'POSITION_2', hero_id: 10 }),
  ];
  const ratings = new Map([
    [1, { mmr: 4025, delta: 25 }],
    [2, { mmr: 4000, delta: -25 }],
    [6, { mmr: 4030, delta: 30 }],
  ]);
  // Most games first, then the lower hero ID; an unknown result counts as a game only.
  expect(roleHeroes(rows, 3, ratings)).toEqual([
    { hero: 10, games: 3, wins: 1, losses: 1, measured: 2, delta: 0 },
    { hero: 40, games: 2, wins: 1, losses: 1, measured: 1, delta: 30 },
    { hero: 20, games: 1, wins: 1, losses: 0, measured: 0, delta: 0 },
  ]);
});
