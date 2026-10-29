import { Activity, Download } from 'lucide-react';
import type { AppInfo } from '../../shared/domain';
import type { SteamSetup } from '../../shared/steam-setup';
import { api } from '../App';
import { SteamSetupPanel } from '../SteamSetup';
import { useSavedFile } from './SavedFile';

export function DotaConnectionSettings({
  info,
  steamSetup,
  steamChanged,
  openDiagnostics,
}: {
  info?: AppInfo;
  steamSetup?: SteamSetup;
  steamChanged(value: SteamSetup): void;
  openDiagnostics(): void;
}) {
  const gsi = useSavedFile(() => api.exportGsi());
  return (
    <section className="panel" id="settings-game">
      <div className="panel-icon">
        <Activity />
      </div>
      <h2>Connect Dota 2</h2>
      <SteamSetupPanel setup={steamSetup} changed={steamChanged}>
        <ol className="setup-steps">
          <li>
            <b>Save the configuration</b>
            <p>
              The button below creates a file for this computer. If you saved a configuration before, save it again and
              replace it in the game folder to enable the draft block.
            </p>
          </li>
          <li>
            <b>Move the file to the game folder</b>
            <p>Steam → Dota 2 → Manage → Browse local files.</p>
            <code>game/dota/cfg/gamestate_integration/</code>
            <p>
              Create the last folder if it does not exist. Keep the filename{' '}
              <code>gamestate_integration_ancient_lens.cfg</code>.
            </p>
          </li>
          <li>
            <b>Add the Steam launch option</b>
            <code>-gamestateintegration</code>
            <p>Restart Dota 2 and enter a match.</p>
          </li>
        </ol>
        <button className="secondary" onClick={gsi.run}>
          <Download size={17} />
          Save GSI configuration
        </button>
        <p className="fine-print">
          Local connection: 127.0.0.1:{info?.gsiPort ?? 32123}. The file contains the receiver access token. Do not
          publish it.
        </p>
        {gsi.notice}
      </SteamSetupPanel>
      <p className="fine-print diagnostics-link">
        <button type="button" className="link-button" onClick={openDiagnostics}>
          Open GSI diagnostics
        </button>{' '}
        to see what Dota 2 sends right now: the match, your hero and the clock.
      </p>
    </section>
  );
}
