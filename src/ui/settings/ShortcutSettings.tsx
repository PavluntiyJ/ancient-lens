import { useEffect, useState } from 'react';
import { api, errorMessage, Notice } from '../App';
import { Keycaps } from '../Keycaps';
import type { LocalState } from '../../shared/domain';
import {
  defaultShortcuts,
  normalizeShortcut,
  shortcutConflicts,
  shortcutFromEvent,
  shortcutNames,
  shortcutProblem,
  type ShortcutName,
  type Shortcuts,
} from '../../shared/shortcuts';

/**
 * One rebindable key. The recorder listens in the capture phase so opening a panel or the
 * lane cannot also run while the user records its replacement; Esc leaves the old value.
 */
export function ShortcutSettings({
  local,
  update,
  info,
}: {
  local: LocalState;
  update(value: LocalState): void;
  info?: { platform: string; shortcutTrigger?: string | null; profileShortcutTrigger?: string | null };
}) {
  const shortcuts = { ...defaultShortcuts, ...local.shortcuts };
  const [recording, setRecording] = useState<ShortcutName>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const linux = info?.platform === 'linux';

  async function save(next: Shortcuts, changed?: ShortcutName) {
    const problems = shortcutConflicts(next);
    const first = Object.keys(problems)[0] as ShortcutName | undefined;
    if (first) {
      setError(problems[first] ?? 'This combination is not available.');
      setMessage('');
      return;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      update(await api.setShortcuts!(next));
      const global = !changed || shortcutNames.some((entry) => entry.name === changed && entry.global);
      setMessage(global ? 'Shortcut saved and registered.' : 'Shortcut saved. It works on the match screen.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!recording) return;
    document.body.setAttribute('data-shortcut-recording', '');
    const keydown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(undefined);
        return;
      }
      const combo = shortcutFromEvent(event);
      if (!combo) return;
      const problem = shortcutProblem(shortcuts, recording, combo);
      setRecording(undefined);
      if (problem) {
        setError(problem);
        setMessage('');
        return;
      }
      void save({ ...shortcuts, [recording]: combo }, recording);
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      document.body.removeAttribute('data-shortcut-recording');
      window.removeEventListener('keydown', keydown, true);
    };
  });

  return (
    <section className="panel shortcut-settings" id="settings-shortcuts">
      <h2>Shortcuts</h2>
      <p className="muted">
        Every key can be changed. Press the new combination; Esc cancels. A combination needs Ctrl, Alt or Shift.
      </p>
      <div className="shortcut-list">
        {shortcutNames.map((entry) => {
          // On Linux the desktop portal assigns the global keys and describes them itself.
          const trigger = entry.name === 'profile' ? info?.profileShortcutTrigger : info?.shortcutTrigger;
          const shown = linux && entry.global ? trigger : shortcuts[entry.name];
          return (
            <div className="shortcut-row" key={entry.name}>
              <div>
                <b>{entry.label}</b>
                <small className="muted">{entry.detail}</small>
              </div>
              <Keycaps combo={shown || shortcuts[entry.name]} />
              {entry.global && linux ? (
                <span className="fine-print">
                  {trigger
                    ? 'Assigned by your desktop. Change it in system settings under Shortcuts → Ancient Lens.'
                    : 'The desktop did not bind this key.'}
                </span>
              ) : (
                <button
                  type="button"
                  className="secondary"
                  data-needs-keyboard
                  aria-label={`Change ${entry.label}`}
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    setMessage('');
                    setRecording(entry.name);
                  }}
                >
                  {recording === entry.name ? 'Press a combination…' : 'Change'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="button-row">
        <button type="button" className="secondary" disabled={busy} onClick={() => void save(defaultShortcuts)}>
          Reset shortcuts
        </button>
        <small className="fine-print">
          {linux
            ? 'In-page keys apply to the match screen. The two show/hide keys come from the desktop portal.'
            : 'The two show/hide keys are registered with Windows. If another application owns one, the previous keys stay active.'}
        </small>
      </div>
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}

/** Canonical value for display; unknown text stays as typed rather than disappearing. */
export const displayShortcut = (combo: string) => normalizeShortcut(combo) ?? combo;
