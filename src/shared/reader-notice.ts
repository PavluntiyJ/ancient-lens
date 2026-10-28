import type { LiveState } from './domain';

export const readerRisk =
  'Reads the Dota process externally using process_vm_readv to obtain the roster and picks. Does not write memory, inject code, or call game functions. The anti-cheat response is unknown.';
export const readerRiskWindows =
  'Reads the Dota process externally using ReadProcessMemory to obtain the roster and picks, and your MMR and rank confidence every 3 seconds. Does not write memory, inject code, or call game functions. The anti-cheat response is unknown.';

/** Systems where the app can read the roster and picks of your own match from the game. */
export function hasNativeReader(platform: string | undefined): boolean {
  return platform === 'linux' || platform === 'win32';
}

export function showReaderNotice(platform: string | undefined, live: LiveState, connected: boolean): boolean {
  return hasNativeReader(platform) && connected && live.mode === 'player' && live.rosterStatus === 'disabled';
}
