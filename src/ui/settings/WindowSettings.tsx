import { useState } from 'react';
import { Monitor } from 'lucide-react';
import type { AppInfo, LocalState } from '../../shared/domain';
import { api, errorMessage, Notice } from '../App';
import { Keycaps } from '../Keycaps';

export function WindowSettings({
  info,
  local,
  update,
}: {
  info?: AppInfo;
  local: LocalState;
  update(value: LocalState): void;
}) {
  return (
    <section className="panel" id="settings-window">
      <div className="panel-icon">
        <Monitor />
      </div>
      <h2>Window over the game</h2>
      {info?.shortcut ? (
        <p className="muted shortcut-line">
          <Keycaps combo={info.shortcutTrigger || local.shortcuts?.global || info.shortcutKey || 'Alt+Numpad5'} /> shows
          this window over the game, or hides it when it is already in front.
        </p>
      ) : (
        <p className="muted">The hotkey is unavailable on this system.</p>
      )}
      <p className="fine-print">
        {info?.shortcutTrigger
          ? 'Your desktop assigned this shortcut. Change it in the system settings under Shortcuts → Ancient Lens.'
          : 'Change the key under Shortcuts above. Run the game in borderless windowed mode.'}{' '}
        {info?.wayland
          ? 'On Wayland, keeping the window above the game is set in the window menu (Keep above others).'
          : ''}
      </p>
      {api.setCloseToTray && <TraySetting local={local} update={update} available={!!info?.tray} />}
      <span className="badge">
        {info?.platform ?? 'Desktop'} · v{info?.version ?? '0.2.0'}
      </span>
    </section>
  );
}

function TraySetting({
  local,
  update,
  available,
}: {
  local: LocalState;
  update(value: LocalState): void;
  available: boolean;
}) {
  const [error, setError] = useState('');
  return (
    <>
      <label className={available ? undefined : 'disabled'}>
        <input
          type="checkbox"
          disabled={!available}
          checked={available && local.closeToTray !== false}
          onChange={(event) => {
            setError('');
            api.setCloseToTray!(event.target.checked).then(update, (e) => setError(errorMessage(e)));
          }}
        />
        Closing the window keeps Ancient Lens in the tray
      </label>
      <p className="fine-print">
        {available
          ? 'Match data and the rating reader keep working in the background. Quit from the tray icon menu.'
          : 'Unavailable: this desktop shows no tray icons, so closing the window quits the app.'}
      </p>
      {error && <Notice error>{error}</Notice>}
    </>
  );
}
