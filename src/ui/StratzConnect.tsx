import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { ProviderInfo } from '../shared/domain';
import { api, errorMessage, Notice } from './App';

const askedKey = 'ancient-stratz-asked';
const tokensUrl = 'https://stratz.com/api';

export function stratzAsked(): boolean {
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
    // Without storage the offer can return next launch; the connection is saved by Rust.
  }
}

/**
 * Token entry: Rust checks the token with STRATZ, saves it in the system secret store and
 * starts the statistics service. The field is cleared as soon as the call is sent, so the
 * page holds the token only while it is being pasted.
 */
export function StratzConnectForm({
  connected,
  busyChanged,
}: {
  connected(info: ProviderInfo): void;
  busyChanged?(busy: boolean): void;
}) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [opening, setOpening] = useState(false);
  async function openWebsite() {
    setOpening(true);
    setError('');
    try {
      if (!api.openStratzTokens) throw new Error('Browser opening is unavailable in this session.');
      await api.openStratzTokens();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setOpening(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = token;
    setToken('');
    setBusy(true);
    busyChanged?.(true);
    setError('');
    try {
      connected(await api.connectStratz!(value));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      busyChanged?.(false);
    }
  }
  return (
    <div className="stratz-connect">
      <ol>
        <li>
          Open the STRATZ API page.{' '}
          <button type="button" className="secondary" disabled={opening || busy} onClick={() => void openWebsite()}>
            <ExternalLink size={14} /> {opening ? 'Opening browser…' : 'Open stratz.com/api'}
          </button>
        </li>
        <li>
          Sign in with Steam, then copy your API token from <b>My Tokens</b>.
        </li>
        <li>Paste the token here and connect.</li>
      </ol>
      <form className="button-row" onSubmit={(event) => void submit(event)}>
        <input
          type="password"
          aria-label="Your STRATZ API token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="STRATZ API token"
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
          disabled={busy}
        />
        <button className="primary" disabled={busy || !token.trim()}>
          {busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
      {busy && <p role="status">Checking the token with STRATZ and starting the statistics service…</p>}
      {error && <Notice error>{error}</Notice>}
      <p className="fine-print">
        If the page does not open, copy this address into your browser: <b className="selectable-url">{tokensUrl}</b>
      </p>
      <details className="fine-print">
        <summary>How your token is stored</summary>
        <p>
          One STRATZ request checks the token. It is then saved in Windows Credential Manager or the Linux keyring and
          passed only to the local statistics service. It is never shown again and is not kept in settings, exports or
          logs. Ask for a new token at STRATZ if it leaks.
        </p>
      </details>
    </div>
  );
}

export function StratzConnectDialog({
  close,
  connected,
  firstRun = false,
}: {
  close(): void;
  connected(info: ProviderInfo): void;
  firstRun?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  function finish() {
    markAsked();
    close();
  }
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="quick-dialog"
      aria-label="Connect STRATZ"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) finish();
      }}
    >
      <section className="stratz-dialog">
        {firstRun && <p className="fine-print">Optional setup · STRATZ</p>}
        <header>
          <h2>Connect STRATZ</h2>
          <button type="button" className="icon-button" aria-label="Close" disabled={busy} onClick={finish}>
            <X size={16} />
          </button>
        </header>
        <p className="muted">
          Recommended for faster player loading: STRATZ loads up to five players per request and adds match performance
          (IMP), positions, hero matchups and pick recommendations. It needs a free STRATZ account and your API token.
        </p>
        <p className="fine-print">
          This is optional and works with memory reading on or off. Without it, public player history uses OpenDota with
          slower, rate-limited loading; notes and recorded matches still work. You can connect later in Settings →
          Connections → STRATZ.
        </p>
        {done ? (
          <>
            <Notice>{done}</Notice>
            <div className="button-row">
              <button type="button" className="primary" onClick={finish}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <StratzConnectForm
              busyChanged={setBusy}
              connected={(info) => {
                markAsked();
                setDone(info.message ?? 'STRATZ connected.');
                connected(info);
              }}
            />
            {firstRun && (
              <div className="button-row">
                <button type="button" className="secondary" disabled={busy} onClick={finish}>
                  Not now
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </dialog>
  );
}
