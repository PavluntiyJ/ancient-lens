import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  connectionHint,
  repairCloses,
  repairSummary,
  repairWarning,
  setupProblems,
  type SteamSetup,
} from '../src/shared/steam-setup';

vi.mock('../src/ui/App', () => ({
  api: { repairSteamSetup: vi.fn() },
  errorMessage: String,
  Notice: ({ children }: { children: unknown }) => <div className="notice">{children as string}</div>,
}));
const { SteamSetupPanel } = await import('../src/ui/SteamSetup');

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
const broken: SteamSetup = { ...ready, state: 'repair', config: 'outdated', launchOption: 'missing' };

describe('Steam setup', () => {
  it('names each problem and what the repair will close', () => {
    expect(setupProblems(ready)).toEqual([]);
    expect(setupProblems(broken)).toEqual([
      'The GSI file in the Dota 2 folder is from an older setup.',
      '-gamestateintegration is missing from the Dota 2 launch options.',
    ]);
    expect(repairCloses(broken)).toBe(true);
    expect(repairWarning(broken)).toMatch(/^Steam will close, and Steam starts again afterwards\./);
    const game = { ...broken, gameRunning: true, accounts: 2 };
    expect(repairWarning(game)).toMatch(/^Dota 2 and Steam will close/);
    expect(repairWarning(game)).toContain('for 2 Steam accounts');
    // Only the GSI file: nothing closes and no confirmation is needed.
    const fileOnly = { ...broken, launchOption: 'present' as const };
    expect(repairCloses(fileOnly)).toBe(false);
    expect(repairWarning(fileOnly)).toBeNull();
    expect(repairCloses({ ...broken, steamRunning: false })).toBe(false);
  });

  it('summarises the repair and asks for a game restart when the game kept running', () => {
    const result = {
      installedConfig: true,
      launchOptions: 1,
      stoppedGame: true,
      restartedSteam: true,
      launchedGame: false,
      restartGame: false,
      status: ready,
    };
    expect(repairSummary(result)).toBe(
      'Done: installed the GSI file, added -gamestateintegration to the launch options, restarted Steam.',
    );
    expect(repairSummary({ ...result, launchOptions: 0, restartedSteam: false, restartGame: true })).toBe(
      'Done: installed the GSI file. Restart Dota 2 to connect it.',
    );
    expect(repairSummary({ ...result, installedConfig: false, launchOptions: 0, restartedSteam: false })).toBe(
      'Nothing needed to change.',
    );
  });

  it('gives the match screen a concrete reason when no data arrives', () => {
    expect(connectionHint(undefined)).toBeNull();
    expect(connectionHint({ ...ready, state: 'unavailable' })).toBeNull();
    expect(connectionHint(broken)).toContain('can fix this in Settings');
    expect(connectionHint({ ...ready, state: 'restart-game' })).toContain('Restart Dota 2');
  });

  it('shows the checks, the repair action and the manual fallback', () => {
    const render = (setup?: SteamSetup) =>
      renderToStaticMarkup(
        <SteamSetupPanel setup={setup} changed={() => {}}>
          <p>manual steps</p>
        </SteamSetupPanel>,
      );
    expect(render()).toContain('Checking Steam');
    const html = render(broken);
    expect(html).toContain('From an older setup');
    expect(html).toContain('Set up automatically');
    expect(html).toContain('Start Dota 2 afterwards');
    expect(html).toContain('manual steps');
    expect(render(ready)).not.toContain('Set up automatically');
    expect(render(ready)).toContain('-gamestateintegration is set');
    const unavailable = render({ ...ready, state: 'unavailable', dotaPath: null, detail: 'Dota 2 was not found.' });
    expect(unavailable).toContain('Dota 2 was not found. Use the manual setup below.');
    expect(unavailable).toContain('<details class="manual-setup" open=""');
  });
});
