import { Download, Shield } from 'lucide-react';
import type { AppInfo } from '../../shared/domain';

export function DataSettings({ info, exportData }: { info?: AppInfo; exportData(): void }) {
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
      <button className="secondary" onClick={exportData}>
        <Download size={16} />
        Export notes and MMR
      </button>
    </section>
  );
}
