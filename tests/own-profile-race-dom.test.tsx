// @vitest-environment happy-dom
import { bridge, deferred, resetBridge } from './dom/bridge';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { LocalState, SteamIdentity } from '../src/shared/domain';
import { OwnProfile } from '../src/ui/OwnProfile';

const identity = (accountId: string, name: string): SteamIdentity => ({
  accountId,
  name,
  avatar: '',
  fetchedAt: '2026-11-06T12:00:00Z',
  stale: false,
  source: 'Steam Community',
});
const local = (accountId: string): LocalState => ({ accountId, notes: [], mmr: [] });

beforeEach(() => {
  bridge.getHeroes.mockResolvedValue([]);
  bridge.getPatches.mockResolvedValue([]);
  bridge.getHistory.mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  resetBridge();
});

it('ignores a Steam identity that arrives after the account changed', async () => {
  const first = deferred<SteamIdentity>();
  const second = deferred<SteamIdentity>();
  bridge.getSteamProfile.mockImplementation((id: string) => (id === '111' ? first.promise : second.promise));
  const view = render(<OwnProfile local={local('111')} update={() => {}} />);
  // The game switches accounts before Steam answered for the first one.
  view.rerender(<OwnProfile local={local('222')} update={() => {}} />);
  expect(bridge.getSteamProfile.mock.calls.map(([id]) => id)).toEqual(['111', '222']);
  await act(async () => second.resolve(identity('222', 'Second Account')));
  expect(screen.getAllByText('Second Account').length).toBeGreaterThan(0);
  // The first account's answer comes last and must not replace the current one.
  await act(async () => first.resolve(identity('111', 'First Account')));
  expect(screen.queryByText('First Account')).toBeNull();
  expect(screen.getAllByText('Second Account').length).toBeGreaterThan(0);
});
