import { useState } from 'react';
import type { LocalState } from '../../shared/domain';
import { readerRisk, readerRiskWindows } from '../../shared/reader-notice';
import { api, errorMessage, Notice } from '../App';

export function ReaderSettings({
  windows,
  local,
  update,
}: {
  windows: boolean;
  local: LocalState;
  update(value: LocalState): void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function change(enabled: boolean) {
    setBusy(true);
    setError('');
    try {
      update(await api.setNativeRosterReader!(enabled ? 'on' : 'off'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel reader-settings">
      <h2>{windows ? 'Read roster and rating from Dota memory' : 'Read roster from Dota memory on Linux'}</h2>
      <p className="muted">{windows ? readerRiskWindows : readerRisk}</p>
      <label>
        <input
          type="checkbox"
          aria-label="Allow Dota memory reading"
          checked={local.nativeRosterReader === 'on'}
          disabled={busy}
          onChange={(event) => void change(event.target.checked)}
        />
        Allow Dota memory reading
      </label>
      <p className="fine-print">
        Off by default. Changes apply without restarting the app.{' '}
        {windows
          ? 'When disabled, Steam still identifies your account, but the roster, picks, MMR and confidence are not read from the game.'
          : 'When disabled, only GSI data is available.'}
      </p>
      {busy && <span role="status">Applying setting…</span>}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
