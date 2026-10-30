import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PartyLoader } from '../src/shared/party-loader';
import type { PartyHistory } from '../src/shared/domain';

const answer = (accountId: string): PartyHistory => ({
  source: 'STRATZ',
  fetchedAt: '2026-10-30T12:00:00Z',
  players: [{ accountId, matches: [] }],
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('asks once for a roster that arrives in pieces', async () => {
  const load = vi.fn(async (ids: string[]) => answer(ids.join(',')));
  const published: [string, PartyHistory | null][] = [];
  const loader = new PartyLoader(load, (match, history) => published.push([match, history]));
  loader.request('9001', ['1001', '1002']);
  await vi.advanceTimersByTimeAsync(1000);
  loader.request('9001', ['1001', '1002', '1003']);
  await vi.advanceTimersByTimeAsync(2000);
  expect(load).toHaveBeenCalledTimes(1);
  expect(load).toHaveBeenCalledWith(['1001', '1002', '1003']);
  expect(published).toEqual([['9001', answer('1001,1002,1003')]]);
  // The same roster again does not ask again.
  loader.request('9001', ['1003', '1001', '1002']);
  await vi.advanceTimersByTimeAsync(3000);
  expect(load).toHaveBeenCalledTimes(1);
});

it('drops parties of an earlier match', async () => {
  let finish: (value: PartyHistory) => void = () => {};
  const load = vi.fn(() => new Promise<PartyHistory>((done) => (finish = done)));
  const published: string[] = [];
  const loader = new PartyLoader(load, (match) => published.push(match));
  loader.request('9001', ['1001', '1002']);
  await vi.advanceTimersByTimeAsync(2000);
  loader.request('9002', []);
  finish(answer('1001'));
  await vi.advanceTimersByTimeAsync(0);
  expect(published).toEqual(['9002']);
});

it('retries an error after a minute, not sooner', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue(answer('1001'));
  const published: (PartyHistory | null)[] = [];
  const loader = new PartyLoader(load, (_, history) => published.push(history));
  loader.request('9001', ['1001', '1002']);
  await vi.advanceTimersByTimeAsync(2000);
  loader.request('9001', ['1001', '1002']);
  await vi.advanceTimersByTimeAsync(50_000);
  expect(load).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(12_000);
  expect(load).toHaveBeenCalledTimes(2);
  expect(published).toEqual([answer('1001')]);
});
