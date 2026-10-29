import { Download, Shield } from 'lucide-react';
import type { AppInfo } from '../../shared/domain';
import { api } from '../App';
import { useSavedFile } from './SavedFile';

export function DataSettings({ info }: { info?: AppInfo }) {
  const backup = useSavedFile(() => api.exportData());
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
    </section>
  );
}
