import { useEffect, useRef, useState } from 'react';
import { Cpu } from 'lucide-react';
import type { LocalState } from '../shared/domain';
import { readerRisk, readerRiskWindows } from '../shared/reader-notice';
import { api, errorMessage, Notice } from './App';

const askedKey = 'ancient-reader-asked';

/** Whether the first-run reader question was already shown on this computer. */
export function readerAsked(): boolean {
  try {
    return localStorage.getItem(askedKey) === 'true';
  } catch {
    return false;
  }
}
function markAsked() {
  try {
    localStorage.setItem(askedKey, 'true');
  } catch {
    // Without storage the question returns next launch; the reader setting itself is saved by Rust.
  }
}

/**
 * Asked once at startup: the reader is what fills your own match, so it is offered up front,
 * but it stays off until the player chooses it here or in Settings.
 */
export function ReaderConsentDialog({
  windows,
  update,
  close,
}: {
  windows: boolean;
  update(value: LocalState): void;
  close(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  function later() {
    markAsked();
    close();
  }
  async function enable() {
    setBusy(true);
    setError('');
    try {
      update(await api.setNativeRosterReader!('on'));
      markAsked();
      close();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="quick-dialog"
      aria-labelledby="reader-consent-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) later();
      }}
    >
      <section className="reader-consent">
        <div className="panel-icon">
          <Cpu size={18} />
        </div>
        <h2 id="reader-consent-title">See all ten players in your own match</h2>
        <p>
          When you play, Dota sends Ancient Lens only your own player. To show the whole roster, picks and bans
          {windows ? ', and your exact MMR and rank confidence,' : ''} the app can read them from the running game.
        </p>
        <p className="muted">{windows ? readerRiskWindows : readerRisk}</p>
        <p className="fine-print">
          Spectating, public profiles and notes work without it. You can change this at any time in Settings →
          Connections → Memory reading.
        </p>
        <p className="fine-print">
          Memory reading finds the players in your match. The optional STRATZ connection adds public statistics about
          them; it works independently of this choice.
        </p>
        {error && <Notice error>{error}</Notice>}
        <div className="button-row">
          <button type="button" className="primary" disabled={busy} onClick={() => void enable()}>
            Enable memory reading
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={later}>
            Not now
          </button>
        </div>
      </section>
    </dialog>
  );
}
