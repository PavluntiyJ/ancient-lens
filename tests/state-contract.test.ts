// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ownUpdateSchema, stateResultSchema, validateStateResult } from '../src/shared/state-schema';
import { defaultShortcuts } from '../src/shared/shortcuts';

const state = () => ({
  revision: 0,
  ownAccount: null,
  ratingSnapshot: null,
  profileAccounts: [],
  unassignedMmrCount: 0,
  nativeRosterReader: 'off',
  closeToTray: true,
  autoHide: true,
  keysOverGame: true,
  updateCheck: true,
  skippedVersion: null,
  shortcuts: defaultShortcuts,
  recordedMatches: 0,
  journalRevision: 0,
  accountId: '',
  notes: [],
  mmr: [],
});
const invoke = vi.fn();
const callbacks = new Map<string, (event: { payload: unknown }) => void>();
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    callbacks.set(name, callback);
    return () => callbacks.delete(name);
  }),
}));

it('rejects missing, renamed and mistyped public fields while preserving extensible saved records', () => {
  const value = state();
  expect(stateResultSchema.parse(value)).toEqual(value);
  const { autoHide, ...missing } = value;
  expect(() => stateResultSchema.parse(missing)).toThrow();
  expect(() => stateResultSchema.parse({ ...missing, automaticHide: autoHide })).toThrow();
  expect(() => stateResultSchema.parse({ ...value, mmr: [{ id: 'x', value: '3000', createdAt: 'now' }] })).toThrow();
  const extended = { ...value, mmr: [{ id: 'x', value: 3000, createdAt: 'now', futureField: true }] };
  expect(stateResultSchema.parse(extended)).toEqual(extended);
  expect(() => ownUpdateSchema.parse({ revision: 1, ownAccount: { accountId: '1' } })).toThrow();
  expect(validateStateResult('player:get', { provider: 'outside this contract' })).toEqual({
    provider: 'outside this contract',
  });
});

// Import the actual bridge so tests prove that command results and event payloads use the guard.
describe('state bridge boundary', () => {
  beforeEach(async () => {
    vi.resetModules();
    invoke.mockReset().mockResolvedValue(state());
    callbacks.clear();
    await import('../src/bridge');
  });
  it('validates commands before returning a typed result', async () => {
    await expect(window.ancient.getState()).resolves.toEqual(state());
    invoke.mockResolvedValue({ accountId: 'renamed-only' });
    await expect(window.ancient.getState()).rejects.toThrow();
    await expect(window.ancient.addMmr(3000, '')).rejects.toThrow();
  });
  it('validates state and own-account events before notifying the page', async () => {
    const callback = vi.fn();
    const stop = window.ancient.onState(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalled());
    callback.mockClear();
    callbacks.get('state:update')!({ payload: state() });
    callbacks.get('own:update')!({ payload: { revision: 1, ownAccount: null } });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(() => callbacks.get('state:update')!({ payload: { accountId: '1' } })).toThrow();
    expect(() => callbacks.get('own:update')!({ payload: { revision: '1', ownAccount: null } })).toThrow();
    expect(callback).toHaveBeenCalledTimes(2);
    stop();
  });
});
