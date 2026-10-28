import { describe, expect, it } from 'vitest';
import { averageKda, currentStreak, filterHistory, streakRun } from '../src/shared/history';
import type { Match } from '../src/shared/domain';

describe('personal history selection', () => {
  const now = 1700000000000;
  const match: Match = {
    match_id: 1,
    hero_id: 2,
    start_time: now / 1000 - 86400 - 60,
    duration: 120,
    player_slot: 128,
    radiant_win: false,
    game_mode: 22,
    lobby_type: 7,
  };
  const filter = { days: 1, hero: 0, result: 'all' as const, includeTurbo: false };
  it('uses match end time and own team for outcome', () => {
    expect(filterHistory([match], { ...filter, result: 'win' }, now)).toEqual([match]);
    expect(filterHistory([match], { ...filter, result: 'loss' }, now)).toEqual([]);
    expect(filterHistory([{ ...match, radiant_win: null }], { ...filter, result: 'loss' }, now)).toEqual([]);
  });
  it('applies hero and Turbo consistently without hiding older saved records', () => {
    const turbo = { ...match, match_id: 2, game_mode: 23 };
    expect(filterHistory([match, turbo], filter, now)).toEqual([match]);
    expect(filterHistory([match, turbo], { ...filter, includeTurbo: true }, now)).toHaveLength(2);
    expect(filterHistory([match], { ...filter, hero: 3 }, now)).toEqual([]);
    expect(filterHistory([match], { ...filter, days: 0 }, now + 864000000)).toHaveLength(1);
  });
  it('keeps the chronological streak when filtering wins or losses', () => {
    const history = [true, true, false, true].map((won, i) => ({
      ...match,
      match_id: i + 1,
      start_time: now / 1000 - i * 3600,
      radiant_win: !won,
    }));
    const shuffled = [history[3], history[1], history[2], history[0]];
    for (const result of ['all', 'win', 'loss'] as const) {
      expect(currentStreak(shuffled, { ...filter, result }, now)).toBe('2 wins in a row');
    }
    expect(shuffled[0]).toBe(history[3]);
    expect(currentStreak(history.slice(2), filter, now)).toBe('1 loss in a row');
    // The same run as numbers, for the profile summary ("2 W").
    expect(streakRun(shuffled, { ...filter, result: 'loss' }, now)).toEqual({ count: 2, won: true });
    expect(streakRun([{ ...match, radiant_win: null }], filter, now)).toBeUndefined();
  });
  it('matches roster modes and lobbies by default while retaining all-mode history', () => {
    const rows = [1, 2, 3, 4, 18, 22, 23].map((game_mode) => ({ ...match, game_mode, match_id: game_mode }));
    expect(filterHistory(rows, filter, now).map((row) => row.game_mode)).toEqual([2, 3, 22]);
    expect(filterHistory(rows, { ...filter, includeTurbo: true }, now).map((row) => row.game_mode)).toEqual([
      2, 3, 22, 23,
    ]);
    expect(filterHistory(rows, { ...filter, modes: 'all' }, now)).toHaveLength(6);
    expect(filterHistory(rows, { ...filter, modes: 'all', includeTurbo: true }, now)).toHaveLength(7);
    for (const lobby_type of [0, 1, 2, 7, 9])
      expect(filterHistory([{ ...match, lobby_type }], filter, now)).toHaveLength(1);
    for (const lobby_type of [4, -1, undefined]) {
      expect(filterHistory([{ ...match, lobby_type }], filter, now)).toHaveLength(0);
      expect(filterHistory([{ ...match, lobby_type }], { ...filter, modes: 'all' }, now)).toHaveLength(1);
    }
  });
  it('counts a match only the journal has as a matchmaking game, since GSI reports no mode', () => {
    const recorded = { ...match, game_mode: undefined, lobby_type: undefined, recorded: true, local_only: true };
    expect(filterHistory([recorded], filter, now)).toHaveLength(1);
    // A provider row with an unknown mode stays excluded as before.
    expect(filterHistory([{ ...recorded, local_only: undefined }], filter, now)).toHaveLength(0);
    // Once the provider supplies Turbo, the Turbo setting applies again.
    expect(filterHistory([{ ...recorded, local_only: undefined, game_mode: 23 }], filter, now)).toHaveLength(0);
  });
  it('stops a streak at an unknown outcome instead of skipping it', () => {
    const history = [false, null, false].map((radiant_win, i) => ({
      ...match,
      start_time: now / 1000 - i * 3600,
      radiant_win,
    }));
    expect(currentStreak(history, filter, now)).toBe('1 win in a row');
    expect(currentStreak(history.slice(1), filter, now)).toBe('—');
    expect(currentStreak([], filter, now)).toBe('—');
  });
  it('keeps period, hero and Turbo selection for the streak', () => {
    const history = [{ ...match, start_time: now / 1000, game_mode: 23, radiant_win: true }, match];
    expect(currentStreak(history, filter, now)).toBe('1 win in a row');
    expect(currentStreak(history, { ...filter, includeTurbo: true }, now)).toBe('1 loss in a row');
    expect(currentStreak(history, { ...filter, hero: 3 }, now)).toBe('—');
    expect(currentStreak(history, filter, now + 864000000)).toBe('—');
  });
  it('averages K/D/A only over complete records, including real zeros', () => {
    const complete = { ...match, kills: 10, deaths: 2, assists: 8 };
    expect(
      averageKda([
        complete,
        match,
        { ...complete, kills: null },
        { ...complete, deaths: undefined },
        { ...complete, assists: NaN },
      ]),
    ).toBe('10 / 2 / 8');
    expect(averageKda([complete, { ...match, kills: 0, deaths: 0, assists: 0 }])).toBe('5 / 1 / 4');
    expect(averageKda([{ ...match, kills: 0, deaths: 0, assists: 0 }])).toBe('0 / 0 / 0');
    expect(averageKda([match, { ...complete, assists: null }])).toBe('—');
    expect(averageKda([])).toBe('—');
  });
});

it('does not call a recent-only provider sample complete history', async () => {
  const { historyCoverage } = await import('../src/shared/history');
  expect(historyCoverage({ hasMore: false })).toBe('complete');
  expect(historyCoverage({ hasMore: false, limited: true })).toBe('recent');
  expect(historyCoverage({ hasMore: true, limited: true })).toBe('incomplete');
  expect(historyCoverage({ hasMore: false, historyUnavailable: true })).toBe('incomplete');
  expect(historyCoverage({ hasMore: false, warning: 'cache' })).toBe('incomplete');
});
