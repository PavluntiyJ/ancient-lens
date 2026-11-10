// @vitest-environment happy-dom
import { bridge, deferred, resetBridge } from './dom/bridge';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { Hero } from '../src/shared/domain';
import type { DraftData } from '../src/shared/draft';
import { useDraftData } from '../src/ui/match/useDraftData';
import { useHeroes } from '../src/ui/match/useHeroes';

afterEach(() => {
  cleanup();
  resetBridge();
  vi.useRealTimers();
});

const hero = (id: number) => ({ id, name: `npc_dota_hero_${id}`, localized_name: `Hero ${id}` }) as Hero;
const reply = (ids: number[], fetchedAt = '2026-11-10T10:00:00Z'): DraftData => ({
  source: 'STRATZ',
  fetchedAt,
  positions: [],
  matchups: ids.map((heroId) => ({ heroId, vs: [], with: [] })),
});
type Props = Partial<Parameters<typeof useDraftData>[0]>;
/** The hook with its shared error held as MatchScreen holds it. */
function useDraft(props: Props) {
  const [error, setError] = useState('');
  const draft = useDraftData({
    match: '500',
    providerRevision: 0,
    bracket: 'ALL',
    pickedIds: '',
    heroes: [],
    phase: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
    connected: true,
    revision: 0,
    stratzDraft: true,
    ...props,
    error,
    setError,
  });
  return { ...draft, error, setError };
}
const heroIds = (data?: DraftData) => data?.matchups.map((row) => row.heroId);

it('loads the hero list once connected and reports a failure', async () => {
  bridge.getHeroes.mockResolvedValueOnce([hero(1)]).mockRejectedValueOnce(new Error('Heroes unavailable'));
  const reportError = vi.fn();
  const { result, rerender } = renderHook(({ connected, revision }) => useHeroes(connected, revision, reportError), {
    initialProps: { connected: false, revision: 0 },
  });
  expect(bridge.getHeroes).not.toHaveBeenCalled();
  rerender({ connected: true, revision: 0 });
  await act(async () => {});
  expect(result.current.map((item) => item.id)).toEqual([1]);
  rerender({ connected: true, revision: 1 });
  await act(async () => {});
  expect(reportError).toHaveBeenCalledWith('Heroes unavailable');
  expect(result.current.map((item) => item.id)).toEqual([1]);
});

it('asks only for heroes the match has not asked for yet', async () => {
  vi.useFakeTimers();
  bridge.getDraftData.mockImplementation(async (ids: number[]) => reply(ids));
  const { result, rerender } = renderHook((props: Props) => useDraft(props), {
    initialProps: { pickedIds: '1,2' } as Props,
  });
  expect(result.current.draftBusy).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(heroIds(result.current.draftData)).toEqual([1, 2]);
  rerender({ pickedIds: '1,2,3' });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(bridge.getDraftData.mock.calls).toEqual([
    [[1, 2], 'ALL'],
    [[3], 'ALL'],
  ]);
  expect(heroIds(result.current.draftData)).toEqual([1, 2, 3]);
  expect(result.current.draftBusy).toBe(false);
});

it('drops a draft reply from the previous match', async () => {
  vi.useFakeTimers();
  const old = deferred<DraftData>();
  bridge.getDraftData.mockReturnValueOnce(old.promise).mockResolvedValueOnce(reply([7]));
  const { result, rerender } = renderHook((props: Props) => useDraft(props), {
    initialProps: { pickedIds: '1' } as Props,
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  rerender({ match: '501', pickedIds: '7' });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  await act(async () => old.resolve(reply([1])));
  expect(heroIds(result.current.draftData)).toEqual([7]);
});

it('hides the data while a request failed, and the next request clears the error', async () => {
  vi.useFakeTimers();
  bridge.getDraftData
    .mockResolvedValueOnce(reply([1]))
    .mockRejectedValueOnce(new Error('Quota reached'))
    .mockResolvedValueOnce(reply([3]));
  const { result, rerender } = renderHook((props: Props) => useDraft(props), {
    initialProps: { pickedIds: '1' } as Props,
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  rerender({ pickedIds: '1,2' });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(result.current.error).toBe('Quota reached');
  expect(result.current.draftData).toBeUndefined();
  rerender({ pickedIds: '1,2,3' });
  expect(result.current.error).toBe('');
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(heroIds(result.current.draftData)).toEqual([1, 3]);
});

it('fetches every hero once per match during the draft', async () => {
  vi.useFakeTimers();
  bridge.getDraftData.mockImplementation(async (ids: number[]) => reply(ids));
  const heroes = Array.from({ length: 12 }, (_, index) => hero(index + 1));
  const { rerender } = renderHook((props: Props) => useDraft(props), {
    initialProps: { heroes, phase: 'DOTA_GAMERULES_STATE_HERO_SELECTION' } as Props,
  });
  await act(async () => {});
  const warm = bridge.getDraftData.mock.calls.filter(([ids]) => ids.length);
  expect(warm.map(([ids]) => ids.length)).toEqual([10, 2]);
  rerender({ heroes, phase: 'DOTA_GAMERULES_STATE_STRATEGY_TIME' });
  await act(async () => {});
  expect(bridge.getDraftData.mock.calls.filter(([ids]) => ids.length)).toHaveLength(2);
});

it('asks STRATZ for nothing when it does not answer drafts', async () => {
  vi.useFakeTimers();
  const { result } = renderHook((props: Props) => useDraft(props), {
    initialProps: {
      pickedIds: '1',
      stratzDraft: false,
      heroes: [hero(1)],
      phase: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
    },
  });
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(bridge.getDraftData).not.toHaveBeenCalled();
  expect(result.current.draftData).toBeUndefined();
  expect(result.current.draftBusy).toBe(false);
});
