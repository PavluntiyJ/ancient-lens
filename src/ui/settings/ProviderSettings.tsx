import { useEffect, useState } from 'react';
import type { ProviderInfo } from '../../shared/domain';
import { api, errorMessage, Notice } from '../App';
import { StratzConnectForm } from '../StratzConnect';

export function ProviderSettings({ changed }: { changed(): void }) {
  const [info, setInfo] = useState<ProviderInfo>();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void api
      .getProvider()
      .then(setInfo)
      .catch((error) => setError(errorMessage(error)));
  }, []);
  async function save(value: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.setProviderToken(value);
      setInfo(result);
      setToken('');
      changed();
      setMessage(
        result.hasToken
          ? result.persistent
            ? 'Token saved with system encryption. Loading a match will verify STRATZ access.'
            : 'Token active until the app closes. Loading a match will verify STRATZ access.'
          : 'Using OpenDota. Token removed.',
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!info)
    return (
      <section className="panel provider-settings">
        <h2>Statistics provider</h2>
        <p>{error || 'Connecting…'}</p>
      </section>
    );
  async function disconnect() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.disconnectStratz!();
      setInfo(result);
      setMessage(result.message ?? '');
      changed();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (info.automatic) {
    const connectable = !!info.connectable && !!api.connectStratz;
    return (
      <section className="panel provider-settings">
        <h2>Player history · {info.source}</h2>
        <p className="muted">{info.status}</p>
        <p className="fine-print">
          {info.serviceConfigured
            ? 'Player statistics, personal history, and recommendations load from STRATZ.'
            : 'For faster roster loading and position recommendations, connect STRATZ with your own token.'}
        </p>
        {connectable && !info.serviceConfigured && (
          <StratzConnectForm
            connected={(result) => {
              setInfo(result);
              setMessage(result.message ?? '');
              changed();
            }}
          />
        )}
        {connectable && info.serviceConfigured && (
          <>
            <div className="button-row">
              <button type="button" className="secondary" disabled={busy} onClick={() => void disconnect()}>
                Disconnect STRATZ
              </button>
            </div>
            <p className="fine-print">
              Removes the saved token and stops the statistics service Ancient Lens started; OpenDota is used
              afterwards. To change the token, disconnect and connect again.
            </p>
          </>
        )}
        {!connectable && !info.serviceConfigured && (
          <p className="fine-print">
            This launch sets the statistics service with ANCIENT_STATS_URL. See docs/guide/stats-service.md.
          </p>
        )}
        <p className="fine-print">
          To run the service yourself, for example from a source build, follow docs/guide/stats-service.md. OpenDota
          profiles and local notes work without STRATZ.
        </p>
        {message && <Notice>{message}</Notice>}
        {error && <Notice error>{error}</Notice>}
      </section>
    );
  }
  return (
    <section className="panel provider-settings">
      <h2>Player history · {info?.source ?? 'Loading…'}</h2>
      <p className="muted">
        STRATZ loads the roster in batches of five players. Get your own API token from stratz.com/api. Without a token,
        OpenDota is used: requests respect its rate limits and rows appear gradually.
      </p>
      <form
        className="button-row"
        onSubmit={(event) => {
          event.preventDefault();
          void save(token);
        }}
      >
        <input
          type="password"
          aria-label="Your STRATZ API token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={info?.hasToken ? 'New STRATZ token' : 'Your STRATZ API token'}
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
        />
        <button className="primary" disabled={busy || !token.trim()}>
          Connect STRATZ
        </button>
        <button type="button" className="secondary" disabled={busy || !info?.hasToken} onClick={() => void save('')}>
          Use OpenDota
        </button>
      </form>
      <p className="fine-print">
        The token is never shown again or included in exports. If the system keyring is unavailable, the token stays in
        memory until the app closes.
      </p>
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
