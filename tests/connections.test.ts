import { describe, expect, it } from 'vitest';
import { gameConnection, readerConnection, stratzConnection } from '../src/shared/connections';
import type { SteamSetup } from '../src/shared/steam-setup';

const ready: SteamSetup = {
  state: 'ready',
  steamPath: '/home/user/.local/share/Steam',
  dotaPath: '/home/user/.local/share/Steam/steamapps/common/dota 2 beta',
  config: 'installed',
  launchOption: 'present',
  accounts: 1,
  steamRunning: true,
  gameRunning: false,
  gameFlag: null,
  detail: null,
};
const waiting = { status: 'waiting' as const, receivedAt: null };

describe('Settings connection overview', () => {
  it('reports the game connection from live data first, then the Steam setup', () => {
    expect(gameConnection({ status: 'connected', receivedAt: 1 }, true, { ...ready, state: 'repair' })).toMatchObject({
      tone: 'on',
      label: 'Connected',
    });
    expect(gameConnection({ status: 'error', receivedAt: null, error: 'Port 32123 is busy' }, false, ready)).toEqual({
      tone: 'setup',
      label: 'Error',
      detail: 'Port 32123 is busy',
      action: 'Fix',
    });
    const repair = gameConnection(waiting, false, { ...ready, state: 'repair', launchOption: 'missing' });
    expect(repair).toMatchObject({ tone: 'setup', label: 'Needs setup', action: 'Fix' });
    expect(repair.detail).toContain('-gamestateintegration is missing');
    expect(gameConnection(waiting, false, { ...ready, state: 'restart-game' })).toMatchObject({
      tone: 'setup',
      label: 'Restart Dota 2',
    });
    // Set up but no game running is not a problem to fix.
    expect(gameConnection(waiting, false, ready)).toMatchObject({ tone: 'off', label: 'Ready' });
    expect(gameConnection({ status: 'waiting', receivedAt: 5 }, false)).toMatchObject({
      tone: 'off',
      label: 'No data',
    });
    expect(gameConnection(waiting, false, { ...ready, state: 'unavailable' })).toMatchObject({
      tone: 'setup',
      label: 'Needs setup',
      action: 'Set up',
    });
  });

  it('reports STRATZ as connected only with the service or a token', () => {
    expect(stratzConnection(undefined)).toMatchObject({ tone: 'off', label: 'Checking…' });
    const opendota = { source: 'OpenDota' as const, hasToken: false, persistent: false, automatic: true };
    expect(stratzConnection(opendota)).toMatchObject({ tone: 'setup', label: 'Not connected', action: 'Connect' });
    expect(stratzConnection({ ...opendota, source: 'STRATZ', serviceConfigured: true })).toMatchObject({
      tone: 'on',
      label: 'Connected',
    });
    // The older token form (no automatic service) counts a saved token.
    expect(stratzConnection({ source: 'STRATZ', hasToken: true, persistent: true })).toMatchObject({ tone: 'on' });
  });

  it('keeps memory reading opt-in and flags a reader that cannot work', () => {
    expect(readerConnection(undefined, {})).toMatchObject({ tone: 'off', label: 'Off' });
    expect(readerConnection('off', { rosterStatus: 'ready' })).toMatchObject({ tone: 'off' });
    expect(readerConnection('on', { rosterStatus: 'ready' })).toMatchObject({ tone: 'on', label: 'On' });
    expect(readerConnection('on', { rosterStatus: 'permission' })).toMatchObject({
      tone: 'setup',
      label: 'Access denied',
    });
    expect(readerConnection('on', { rosterStatus: 'unsupported' })).toMatchObject({ tone: 'setup' });
  });
});
