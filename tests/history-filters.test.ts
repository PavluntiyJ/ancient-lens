import { beforeAll, expect, it } from 'vitest';
import type { Match } from '../src/shared/domain';
import { filterHistory, patchOf, type HistoryFilter, type Patch } from '../src/shared/history';

// Local time is the machine's: pin a zone with a DST change for the time-of-day checks.
beforeAll(() => {
  process.env.TZ = 'Europe/Riga';
});
const base: HistoryFilter = { days: 0, hero: 0, result: 'all', includeTurbo: true, modes: 'all' };
const local = (iso: string) => new Date(iso).getTime() / 1000;
const match = (values: Partial<Match> = {}): Match => ({
  match_id: 1,
  hero_id: 1,
  start_time: local('2026-10-21T12:00:00'),
  duration: 1800,
  player_slot: 0,
  radiant_win: true,
  ...values,
});
const ids = (matches: Match[], filter: Partial<HistoryFilter>) =>
  filterHistory(matches, { ...base, ...filter }).map((m) => m.match_id);

it('keeps ranked-only independent of the selected mode group and leaves unknown lobbies out', () => {
  const rows = [
    match({ match_id: 1, lobby_type: 7, game_mode: 22 }),
    match({ match_id: 2, lobby_type: 0, game_mode: 22 }),
    match({ match_id: 3, game_mode: 22 }),
  ];
  expect(ids(rows, { rankedOnly: true })).toEqual([1]);
  expect(ids(rows, { rankedOnly: false })).toEqual([1, 2, 3]);
});

it('keeps a just recorded match under ranked-only until its match data tells the lobby', () => {
  // GSI reports no lobby: the record lacks it until the match by ID arrives, minutes later.
  const recorded = match({ match_id: 1, recorded: true, local_only: true });
  expect(ids([recorded], { rankedOnly: true })).toEqual([1]);
  expect(ids([{ ...recorded, lobby_type: 0, game_mode: 22 }], { rankedOnly: true })).toEqual([]);
});

it('filters by position, keeping unknown positions out of a chosen one', () => {
  const rows = [
    match({ match_id: 1, position: 'POSITION_1' }),
    match({ match_id: 2, position: null }),
    match({ match_id: 3, role: 'HARD_SUPPORT' }),
  ];
  expect(ids(rows, { position: 1 })).toEqual([1]);
  expect(ids(rows, { position: 5 })).toEqual([3]);
  expect(ids(rows, { position: 0 })).toEqual([1, 2, 3]);
});

it('splits durations at 25 and 40 minutes', () => {
  const rows = [1499, 1500, 2399, 2400].map((duration, i) => match({ match_id: i + 1, duration }));
  expect(ids(rows, { duration: 'short' })).toEqual([1]);
  expect(ids(rows, { duration: 'medium' })).toEqual([2, 3]);
  expect(ids(rows, { duration: 'long' })).toEqual([4]);
});

it('uses the local start hour and weekday of a match', () => {
  const rows = [
    match({ match_id: 1, start_time: local('2026-10-24T05:59:00') }), // Saturday night
    match({ match_id: 2, start_time: local('2026-10-24T06:00:00') }), // Saturday morning
    match({ match_id: 3, start_time: local('2026-10-26T23:30:00') }), // Monday evening, after DST ends
    match({ match_id: 4, start_time: local('2026-10-21T12:00:00') }), // Wednesday afternoon
  ];
  expect(ids(rows, { timeOfDay: 'night' })).toEqual([1]);
  expect(ids(rows, { timeOfDay: 'morning' })).toEqual([2]);
  expect(ids(rows, { timeOfDay: 'afternoon' })).toEqual([4]);
  expect(ids(rows, { timeOfDay: 'evening' })).toEqual([3]);
  expect(ids(rows, { weekday: 6 })).toEqual([1, 2]);
  expect(ids(rows, { weekday: 1 })).toEqual([3]);
  expect(ids(rows, { weekday: 'weekend' })).toEqual([1, 2]);
  expect(ids(rows, { weekday: 'weekdays' })).toEqual([3, 4]);
});

it('places a match in the patch that started before it and leaves matches outside the table unknown', () => {
  const patches: Patch[] = [
    { name: '7.38', date: '2026-02-19T00:00:00Z' },
    { name: '7.39', date: '2026-05-22T00:00:00Z' },
    { name: '7.40', date: '2026-09-10T00:00:00Z' },
  ];
  const rows = [
    match({ match_id: 1, start_time: Date.parse('2026-05-21T23:59:59Z') / 1000 }),
    match({ match_id: 2, start_time: Date.parse('2026-05-22T00:00:00Z') / 1000 }),
    match({ match_id: 3, start_time: Date.parse('2026-10-21T12:00:00Z') / 1000 }),
    match({ match_id: 4, start_time: Date.parse('2025-12-01T00:00:00Z') / 1000 }),
  ];
  expect(rows.map((m) => patchOf(m, patches))).toEqual(['7.38', '7.39', '7.40', undefined]);
  expect(patchOf(rows[0]!, [])).toBeUndefined();
  expect(ids(rows, { patch: '7.39', patches })).toEqual([2]);
  expect(ids(rows, { patch: 'unknown', patches })).toEqual([4]);
  // Without a table every match is unknown; a chosen patch keeps nothing.
  expect(ids(rows, { patch: '7.39' })).toEqual([]);
});
