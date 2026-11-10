// @vitest-environment happy-dom
import { bridge, deferred, resetBridge } from './dom/bridge';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import type { PlayerSummary, StatsFilter } from '../src/shared/domain';
import { draftLanes, laneForPosition } from '../src/shared/draft';
import { useBracketChoice } from '../src/ui/match/useBracketChoice';
import { useLaneChoice } from '../src/ui/match/useLaneChoice';
import { usePlayerEntries } from '../src/ui/match/usePlayerEntries';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  resetBridge();
});

const filter: StatsFilter = { mode: 'normal', rankedOnly: false };
const summary = (accountId: string, source: 'STRATZ' | 'OpenDota', total?: { games: number; wins: number }) =>
  ({ accountId, source, days: 14, total, heroes: [], profile: { rank_tier: 54 } }) as unknown as PlayerSummary;
const roster = { connected: true, revision: 0, days: 14 as const, filter, providerRevision: 0 };

it('loads each player, then the lifetime totals a STRATZ summary lacks', async () => {
  bridge.getSummary.mockImplementation(async (id: string) =>
    id === '1' ? summary('1', 'STRATZ') : summary('2', 'OpenDota', { games: 10, wins: 6 }),
  );
  bridge.getTotals.mockResolvedValue({ total: { games: 900, wins: 470 }, fetchedAt: '' });
  const { result } = renderHook(() => usePlayerEntries({ ...roster, ids: '1,2', match: '500' }));
  expect(result.current['1']).toEqual({ loading: true, error: undefined });
  await act(async () => {});
  expect(bridge.getSummary.mock.calls).toEqual([
    ['1', 14, filter],
    ['2', 14, filter],
  ]);
  expect(bridge.getTotals.mock.calls).toEqual([['1']]);
  expect(result.current['1'].result?.total).toEqual({ games: 900, wins: 470 });
  expect(result.current['1'].totalsLoading).toBe(false);
  expect(result.current['2'].result?.total).toEqual({ games: 10, wins: 6 });
  expect(result.current['2'].filterKey).toBe('normal-false');
});

it('drops a player summary from the previous match', async () => {
  const old = deferred<PlayerSummary>();
  bridge.getSummary
    .mockReturnValueOnce(old.promise)
    // Match 501 asks again for player 1, who has not answered yet, and for player 3.
    .mockReturnValueOnce(new Promise(() => {}))
    .mockResolvedValueOnce(summary('3', 'OpenDota', { games: 1, wins: 1 }));
  const { result, rerender } = renderHook(({ ids, match }) => usePlayerEntries({ ...roster, ids, match }), {
    initialProps: { ids: '1', match: '500' },
  });
  rerender({ ids: '1,3', match: '501' });
  await act(async () => {});
  await act(async () => old.resolve(summary('1', 'OpenDota', { games: 99, wins: 0 })));
  // Player 1 is in the new match too, but the answer belongs to the request of match 500.
  expect(result.current['1'].result).toBeUndefined();
  expect(result.current['3'].result?.total).toEqual({ games: 1, wins: 1 });
});

it('keeps the shown results while the same match reloads, and clears them for another match', async () => {
  bridge.getSummary.mockResolvedValue(summary('1', 'OpenDota', { games: 5, wins: 2 }));
  const { result, rerender } = renderHook(
    ({ revision, match }) => usePlayerEntries({ ...roster, ids: '1', match, revision }),
    {
      initialProps: { revision: 0, match: '500' },
    },
  );
  await act(async () => {});
  bridge.getSummary.mockReturnValue(new Promise(() => {}));
  rerender({ revision: 1, match: '500' });
  expect(result.current['1']).toMatchObject({ loading: true, result: { accountId: '1' } });
  rerender({ revision: 1, match: '501' });
  expect(result.current['1'].result).toBeUndefined();
});

it('starts from the saved lane and follows the own position once per match', () => {
  localStorage.setItem('preferred-lane', '2');
  const { result, rerender } = renderHook(({ match, position }) => useLaneChoice(match, true, position), {
    initialProps: { match: '500', position: undefined as 1 | 2 | 3 | 4 | 5 | undefined },
  });
  expect(result.current.lane).toBe(2);
  rerender({ match: '500', position: 2 });
  expect(result.current.lane).toBe(laneForPosition(2));
  // The user picks another lane; a later position report in the same match leaves it.
  act(() => result.current.setLane(0));
  rerender({ match: '500', position: 1 });
  expect(result.current.lane).toBe(0);
  expect(localStorage.getItem('preferred-lane')).toBe('0');
  rerender({ match: '501', position: 1 });
  expect(result.current.lane).toBe(laneForPosition(1));
});

it('cycles the lane with the stored keys only while active', () => {
  const { result, rerender } = renderHook(({ active }) => useLaneChoice('500', active, undefined), {
    initialProps: { active: true },
  });
  fireEvent.keyDown(window, { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
  expect(result.current.lane).toBe(draftLanes.length - 1);
  rerender({ active: false });
  fireEvent.keyDown(window, { key: 'ArrowUp', code: 'ArrowUp', altKey: true });
  expect(result.current.lane).toBe(draftLanes.length - 1);
});

it('keeps a bracket for the match once it rests on ranks', () => {
  const { result, rerender } = renderHook(
    ({ match, tiers }) => useBracketChoice({ match, player: true, matchTiers: tiers }),
    { initialProps: { match: '500', tiers: [] as number[] } },
  );
  // Nothing known yet: all ranks, and a better choice may follow.
  expect(result.current).toBe('ALL');
  rerender({ match: '500', tiers: [54, 55, 61] });
  expect(result.current).toBe('LEGEND_ANCIENT');
  // More profiles arrive mid-draft; the match keeps its bracket.
  rerender({ match: '500', tiers: [54, 55, 61, 75, 76, 77, 80] });
  expect(result.current).toBe('LEGEND_ANCIENT');
  rerender({ match: '501', tiers: [75, 76, 77] });
  expect(result.current).toBe('DIVINE_IMMORTAL');
});

it("keeps the own medal's bracket for the match once chosen", () => {
  const { result, rerender } = renderHook(
    ({ tiers }) => useBracketChoice({ match: '500', player: true, matchTiers: tiers, ownTier: 15 }),
    { initialProps: { tiers: [] as number[] } },
  );
  expect(result.current).toBe('HERALD_GUARDIAN');
  rerender({ tiers: [54, 55, 61] });
  expect(result.current).toBe('HERALD_GUARDIAN');
});

it('journals the median medal of an own match', async () => {
  renderHook(() => useBracketChoice({ match: '501', player: true, matchTiers: [75, 76, 77] }));
  await act(async () => {});
  expect(bridge.setMedalRank.mock.calls).toEqual([['501', 76]]);
});

it('journals no medal for a spectated match', async () => {
  renderHook(() => useBracketChoice({ match: '500', player: false, matchTiers: [54, 55, 61] }));
  await act(async () => {});
  expect(bridge.setMedalRank).not.toHaveBeenCalled();
});
