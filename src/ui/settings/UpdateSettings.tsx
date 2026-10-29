import { useState } from 'react';
import { CircleArrowUp } from 'lucide-react';
import type { LocalState, ReleaseInfo } from '../../shared/domain';
import { api, errorMessage, Notice } from '../App';

export function UpdateSettings({
  local,
  update,
  release,
}: {
  local: LocalState;
  update(value: LocalState): void;
  release?: ReleaseInfo;
}) {
  const [error, setError] = useState('');
  const on = local.updateCheck !== false;
  const latest = on ? release?.latest : null;
  return (
    <section className="panel" id="settings-updates">
      <div className="panel-icon">
        <CircleArrowUp />
      </div>
      <h2>New versions</h2>
      <p className="muted">
        Shortly after start and every 12 hours, Ancient Lens asks GitHub for its list of releases and shows a notice
        above the match screen when a newer version is out. Nothing is downloaded or installed.
      </p>
      {api.setUpdateCheck && (
        <label>
          <input
            type="checkbox"
            checked={on}
            onChange={(event) => {
              setError('');
              api.setUpdateCheck!(event.target.checked).then(update, (e) => setError(errorMessage(e)));
            }}
          />
          Tell me when a new version is released
        </label>
      )}
      <p className="fine-print">
        The request contains no account, settings or app version; GitHub sees your IP address. Without a connection the
        check stays silent and is tried again later.
      </p>
      <p className="muted release-status">
        You have {release?.current ?? '…'}.{' '}
        {latest ? (
          <>
            Newest release: <b>{latest.version}</b>
            {latest.prerelease ? ' (prerelease)' : ''}.{' '}
            <button
              className="secondary"
              onClick={() => void api.openRelease?.().catch((e) => setError(errorMessage(e)))}
            >
              What's new
            </button>
          </>
        ) : on ? (
          'No newer release is known.'
        ) : (
          'Checking is off.'
        )}
      </p>
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
