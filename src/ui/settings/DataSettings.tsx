import { useState } from 'react';
import { Download, FolderOpen, Shield } from 'lucide-react';
import type { AppInfo } from '../../shared/domain';
import { api, errorMessage, Notice } from '../App';
import { useSavedFile } from './SavedFile';

export function DataSettings({ info }: { info?: AppInfo }) {
  const backup = useSavedFile(() => api.exportData());
  const [logError, setLogError] = useState('');
  return (
    <section className="panel" id="settings-data">
      <div className="panel-icon">
        <Shield />
      </div>
      <h2>Your data belongs to you</h2>
      <p className="muted">
        No ads, usage analytics, or cloud account. Your statistics provider receives your IP address and the requested
        player IDs. When the service is connected, personal history and match statistics load from STRATZ.
      </p>
      <p className="fine-print">Data folder</p>
      <code className="path">{info?.dataPath ?? 'Loading…'}</code>
      <button className="secondary" onClick={backup.run}>
        <Download size={16} />
        Export notes and MMR
      </button>
      {backup.notice}
      <p className="fine-print">Log file, to attach to a bug report</p>
      <code className="path">{info?.logPath ?? 'Loading…'}</code>
      <p className="muted">
        Connection outcomes and errors, without tokens, player or match IDs. Read it before you share it.
      </p>

      <button
        className="secondary"
        onClick={() => {
          setLogError('');
          void api.openLogFolder().catch((e) => setLogError(errorMessage(e)));
        }}
      >
        <FolderOpen size={16} />
        Open log folder
      </button>

      {logError && <Notice error>{logError}</Notice>}
    </section>
  );
}
