// The Steam side of the game connection, as checked and repaired by src-tauri/src/steam_setup.rs.
const GSI_FLAG = '-gamestateintegration';

export type SteamSetup = {
  state: 'ready' | 'repair' | 'restart-game' | 'unavailable';
  steamPath: string | null;
  dotaPath: string | null;
  config: 'installed' | 'missing' | 'outdated' | 'unknown';
  launchOption: 'present' | 'missing' | 'unknown';
  accounts: number;
  steamRunning: boolean;
  gameRunning: boolean;
  gameFlag: boolean | null;
  detail: string | null;
};
export type SteamRepair = {
  installedConfig: boolean;
  launchOptions: number;
  stoppedGame: boolean;
  restartedSteam: boolean;
  launchedGame: boolean;
  restartGame: boolean;
  status: SteamSetup;
};

export function setupProblems(setup: SteamSetup): string[] {
  const problems: string[] = [];
  if (setup.config === 'missing') problems.push('The Ancient Lens GSI file is missing from the Dota 2 folder.');
  if (setup.config === 'outdated') problems.push('The GSI file in the Dota 2 folder is from an older setup.');
  if (setup.launchOption === 'missing') problems.push(`${GSI_FLAG} is missing from the Dota 2 launch options.`);
  return problems;
}

/** What the repair closes; `null` when it only writes the GSI file. */
export function repairWarning(setup: SteamSetup): string | null {
  if (setup.launchOption !== 'missing') return null;
  const closing = [setup.gameRunning && 'Dota 2', setup.steamRunning && 'Steam'].filter(Boolean).join(' and ');
  const options = `Your existing launch options are kept and ${GSI_FLAG} is added${
    setup.accounts > 1 ? ` for ${setup.accounts} Steam accounts` : ''
  }. A copy of each changed Steam file is saved next to it.`;
  if (!closing) return options;
  return `${closing} will close${setup.steamRunning ? ', and Steam starts again afterwards' : ''}. Steam can only save launch options while it is closed. ${options}`;
}
export function repairSummary(result: SteamRepair): string {
  const done: string[] = [];
  if (result.installedConfig) done.push('installed the GSI file');
  if (result.launchOptions) done.push(`added ${GSI_FLAG} to the launch options`);
  if (result.restartedSteam) done.push('restarted Steam');
  if (result.launchedGame) done.push('started Dota 2');
  const text = done.length ? `Done: ${done.join(', ')}.` : 'Nothing needed to change.';
  if (result.restartGame) return `${text} Restart Dota 2 to connect it.`;
  return text;
}

/** Whether the repair has to close Steam or the game, which needs the user's confirmation. */
export function repairCloses(setup: SteamSetup): boolean {
  return setup.launchOption === 'missing' && (setup.steamRunning || setup.gameRunning);
}

/** What the match screen says while no game data arrives. */
export function connectionHint(setup?: SteamSetup): string | null {
  if (setup?.state === 'repair') return `${setupProblems(setup).join(' ')} Ancient Lens can fix this in Settings.`;
  if (setup?.state === 'restart-game')
    return `Dota 2 was started before ${GSI_FLAG} was added. Restart Dota 2 to connect it.`;
  if (setup?.state === 'ready')
    return 'Dota 2 is set up for Ancient Lens. The roster and picks will appear when the game sends them.';
  return null;
}
