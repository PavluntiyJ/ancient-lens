// The three connections the Settings overview summarises: the game (GSI), STRATZ and the
// memory reader. Each says whether it works, needs the player, or is off by choice.
import type { LiveState, LocalState, ProviderInfo } from './domain';
import { setupProblems, type SteamSetup } from './steam-setup';

export type ConnectionTone = 'on' | 'setup' | 'off';
export type ConnectionStatus = {
  tone: ConnectionTone;
  label: string;
  detail: string;
  /** Text of the button that opens the section. */
  action: string;
};

export function gameConnection(
  live: Pick<LiveState, 'status' | 'receivedAt' | 'error'>,
  connected: boolean,
  setup?: SteamSetup,
): ConnectionStatus {
  if (connected) return { tone: 'on', label: 'Connected', detail: 'Dota 2 is sending match data.', action: 'Open' };
  if (live.status === 'error')
    return { tone: 'setup', label: 'Error', detail: live.error ?? 'The game connection failed.', action: 'Fix' };
  if (setup?.state === 'repair')
    return { tone: 'setup', label: 'Needs setup', detail: setupProblems(setup).join(' '), action: 'Fix' };
  if (setup?.state === 'restart-game')
    return {
      tone: 'setup',
      label: 'Restart Dota 2',
      detail: 'Dota 2 was started before the launch option was added.',
      action: 'Open',
    };
  if (setup?.state === 'ready')
    return {
      tone: 'off',
      label: 'Ready',
      detail: 'Set up. Data arrives when you play or spectate a match.',
      action: 'Open',
    };
  if (live.receivedAt)
    return {
      tone: 'off',
      label: 'No data',
      detail: 'No events for 30 seconds. Data arrives when you play or spectate a match.',
      action: 'Open',
    };
  return {
    tone: 'setup',
    label: 'Needs setup',
    detail: 'No events from Dota 2 yet. Install the GSI configuration and add -gamestateintegration.',
    action: 'Set up',
  };
}

/** `provider` is undefined while it loads. */
export function stratzConnection(provider?: ProviderInfo): ConnectionStatus {
  if (!provider) return { tone: 'off', label: 'Checking…', detail: '', action: 'Open' };
  if (provider.serviceConfigured || (!provider.automatic && provider.source === 'STRATZ'))
    return {
      tone: 'on',
      label: 'Connected',
      detail: 'Player history and draft statistics load from STRATZ.',
      action: 'Open',
    };
  return {
    tone: 'setup',
    label: 'Not connected',
    detail: 'OpenDota is used. Draft recommendations and lane totals need STRATZ.',
    action: 'Connect',
  };
}

export function readerConnection(
  setting: LocalState['nativeRosterReader'],
  live: Pick<LiveState, 'rosterStatus'>,
): ConnectionStatus {
  if (setting !== 'on')
    return {
      tone: 'off',
      label: 'Off',
      detail: 'Opt-in. Without it your own match shows only your player.',
      action: 'Open',
    };
  if (live.rosterStatus === 'permission')
    return {
      tone: 'setup',
      label: 'Access denied',
      detail: 'The system denied access to Dota memory; GSI data only.',
      action: 'Open',
    };
  if (live.rosterStatus === 'unsupported')
    return {
      tone: 'setup',
      label: 'Unsupported',
      detail: 'This Dota version is not recognised yet; GSI data only.',
      action: 'Open',
    };
  return { tone: 'on', label: 'On', detail: 'Reads the roster and picks while Dota 2 runs.', action: 'Open' };
}
