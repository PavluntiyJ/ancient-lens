// @vitest-environment happy-dom
import { bridge, deferred, resetBridge } from './dom/bridge';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { Match, PartyHistory, PlayerHistory, ProviderInfo } from '../src/shared/domain';
import { useOwnHistory } from '../src/ui/match/useOwnHistory';
import { usePartyHistory } from '../src/ui/match/usePartyHistory';
import { useStratzProvider } from '../src/ui/match/useStratzProvider';

afterEach(() => {
  cleanup();
  resetBridge();
  vi.useRealTimers();
});

const history = (accountId: string, matchId: number, tier: number) =>
  ({
    accountId,
    source: 'STRATZ',
    fetchedAt: '2026-11-10T10:00:00Z',
    profile: { rank_tier: tier },
    matches: [{ match_id: matchId } as Match],
    hasMore: false,
    nextOffset: 0,
    stale: false,
  }) as unknown as PlayerHistory;
const parties = (accountId: string): PartyHistory => ({
  source: 'STRATZ',
  fetchedAt: '2026-11-10T10:00:00Z',
  players: [{ accountId, matches: [] }],
});

it('loads the own saved history without spending the provider quota', async () => {
  bridge.getHistory.mockResolvedValue(history('111', 9, 54));
  const { result } = renderHook(() => useOwnHistory('111', 0, '500'));
  await act(async () => {});
  // Cached only: the third argument keeps the provider out of it.
  expect(bridge.getHistory.mock.calls).toEqual([['111', 0, true]]);
  expect(result.current.ownHistory.map((match) => match.match_id)).toEqual([9]);
  expect(result.current.ownTier).toBe(54);
});

it('drops an own history that arrives after the account changed', async () => {
  const first = deferred<PlayerHistory>();
  const second = deferred<PlayerHistory>();
  bridge.getHistory.mockImplementation((id: string) => (id === '111' ? first.promise : second.promise));
  const { result, rerender } = renderHook(({ id }) => useOwnHistory(id, 0, '500'), {
    initialProps: { id: '111' },
  });
  rerender({ id: '222' });
  await act(async () => second.resolve(history('222', 2, 70)));
  await act(async () => first.resolve(history('111', 1, 30)));
  expect(result.current.ownHistory.map((match) => match.match_id)).toEqual([2]);
  expect(result.current.ownTier).toBe(70);
});

it('reloads the own history for a new match or a new journal entry', async () => {
  bridge.getHistory.mockResolvedValue(history('111', 9, 54));
  const { rerender } = renderHook(({ match, recorded }) => useOwnHistory('111', recorded, match), {
    initialProps: { match: '500', recorded: 0 },
  });
  rerender({ match: '501', recorded: 0 });
  rerender({ match: '501', recorded: 1 });
  await act(async () => {});
  expect(bridge.getHistory).toHaveBeenCalledTimes(3);
});

it('reads whether STRATZ answers drafts and can be connected', async () => {
  bridge.getProvider.mockResolvedValue({ serviceConfigured: true, connectable: true } as ProviderInfo);
  const { result } = renderHook(() => useStratzProvider(0));
  expect(result.current.stratzDraft).toBeUndefined();
  await act(async () => {});
  expect(result.current).toEqual({ stratzDraft: true, stratzConnectable: true });
});

it('keeps the provider answer of the latest change only', async () => {
  const before = deferred<ProviderInfo>();
  const after = deferred<ProviderInfo>();
  bridge.getProvider.mockReturnValueOnce(before.promise).mockReturnValueOnce(after.promise);
  const { result, rerender } = renderHook(({ revision }) => useStratzProvider(revision), {
    initialProps: { revision: 0 },
  });
  rerender({ revision: 1 });
  await act(async () => after.resolve({ serviceConfigured: false, connectable: true } as ProviderInfo));
  await act(async () => before.resolve({ serviceConfigured: true, connectable: false } as ProviderInfo));
  expect(result.current).toEqual({ stratzDraft: false, stratzConnectable: true });
});

it('treats an unreadable provider as no STRATZ drafts', async () => {
  bridge.getProvider.mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useStratzProvider(0));
  await act(async () => {});
  expect(result.current).toEqual({ stratzDraft: false, stratzConnectable: false });
});

it('asks for the parties of a settled roster once', async () => {
  vi.useFakeTimers();
  bridge.getParties.mockResolvedValue(parties('1'));
  const { result } = renderHook(() => usePartyHistory('500', '1,2', true));
  expect(result.current).toBeUndefined();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(bridge.getParties.mock.calls).toEqual([[['1', '2']]]);
  expect(result.current?.players[0].accountId).toBe('1');
});

it('drops the parties of a previous match', async () => {
  vi.useFakeTimers();
  const first = deferred<PartyHistory | null>();
  const second = deferred<PartyHistory | null>();
  bridge.getParties.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result, rerender } = renderHook(({ match, ids }) => usePartyHistory(match, ids, true), {
    initialProps: { match: '500', ids: '1,2' },
  });
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  // The next match starts while the first request is still open.
  rerender({ match: '501', ids: '3,4' });
  expect(result.current).toBeNull();
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  await act(async () => second.resolve(parties('3')));
  await act(async () => first.resolve(parties('1')));
  expect(result.current?.players[0].accountId).toBe('3');
});

it('asks for no parties while disconnected', async () => {
  vi.useFakeTimers();
  renderHook(() => usePartyHistory('500', '1,2', false));
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  expect(bridge.getParties).not.toHaveBeenCalled();
});
