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
      <h2>Windows over the game</h2>
      <p className="muted">
        The match window and the profile window stay above the game. Each one is shown or hidden on its own, by its key
        or by its close button; the app keeps running in the tray.
      </p>
      {(
        [
          [
            'match',
            info?.shortcut,
            info?.shortcutTrigger || local.shortcuts?.global || info?.shortcutKey || 'Alt+Numpad5',
          ],
          [
            'profile',
            info?.profileShortcut,
            info?.profileShortcutTrigger || local.shortcuts?.profile || info?.profileShortcutKey || 'Alt+Numpad6',
          ],
        ] as const
      ).map(([name, bound, combo]) =>
        bound ? (
          <p className="muted shortcut-line" key={name}>
            <Keycaps combo={combo} /> shows or hides the {name} window.
          </p>
        ) : (
          <p className="muted" key={name}>
            The {name} window's key is unavailable on this system.
          </p>
        ),
      )}
      <p className="fine-print">
        {info?.overlay
          ? 'Showing a window leaves the keyboard with the game, so it keeps its sound. Clicks work as usual; clicking a text field or the keyboard button in the title bar lets you type, and the game goes to the background until you click it again.'
          : info?.wayland
            ? 'On Wayland the desktop decides: showing a window activates it, so the game goes to the background, and keeping a window above the game is set in its window menu (Keep above others).'
            : ''}{' '}
        {info?.shortcutTrigger
          ? 'Your desktop assigned these shortcuts. Change them in the system settings under Shortcuts → Ancient Lens.'
          : 'Change the keys under Shortcuts above.'}{' '}
        Run the game in borderless windowed mode: exclusive fullscreen covers the windows.
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
        Closing a window keeps Ancient Lens in the tray
      </label>
      <p className="fine-print">
        {available
          ? 'Match data and the rating reader keep working in the background. Quit from the tray icon menu.'
          : 'Unavailable: this desktop shows no tray icons, so closing the last visible window quits the app.'}
      </p>
      {error && <Notice error>{error}</Notice>}
    </>
  );
}
