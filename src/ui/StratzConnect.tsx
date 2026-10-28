import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, X } from 'lucide-react';
import type { ProviderInfo } from '../shared/domain';
import { api, errorMessage, Notice } from './App';

/**
 * Token entry: Rust checks the token with STRATZ, saves it in the system secret store and
 * starts the statistics service. The field is cleared as soon as the call is sent, so the
 * page holds the token only while it is being pasted.
 */
export function StratzConnectForm({ connected }: { connected(info: ProviderInfo): void }) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = token;
    setToken('');
    setBusy(true);
    setError('');
    try {
      connected(await api.connectStratz!(value));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stratz-connect">
      <ol>
        <li>
          Sign in at STRATZ with Steam and copy your token from <b>My Tokens</b>.{' '}
          <button
            type="button"
            className="secondary"
            onClick={() => void api.openStratzTokens?.().catch((e) => setError(errorMessage(e)))}
          >
            <ExternalLink size={14} /> Open stratz.com/api
          </button>
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
        One STRATZ request checks the token. It is then saved in Windows Credential Manager or the Linux keyring and
        passed only to the local statistics service. It is never shown again and is not kept in settings, exports or
        logs. Ask for a new token at STRATZ if it leaks.
      </p>
    </div>
  );
}

export function StratzConnectDialog({ close, connected }: { close(): void; connected(info: ProviderInfo): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [done, setDone] = useState('');
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
        close();
      }}
    >
      <section className="stratz-dialog">
        <header>
          <h2>Connect STRATZ</h2>
          <button type="button" className="icon-button" aria-label="Close" onClick={close}>
            <X size={16} />
          </button>
        </header>
        <p className="muted">
          STRATZ statistics power position recommendations, hero matchups, meta and counter picks. They need a free
          STRATZ account and its API token.
        </p>
        {done ? (
          <>
            <Notice>{done}</Notice>
            <div className="button-row">
              <button type="button" className="primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        ) : (
          <StratzConnectForm
            connected={(info) => {
              setDone(info.message ?? 'STRATZ connected.');
              connected(info);
            }}
          />
        )}
      </section>
    </dialog>
  );
}
