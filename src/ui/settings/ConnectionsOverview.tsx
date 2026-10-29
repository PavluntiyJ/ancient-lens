import type { ReactNode } from 'react';
import type { ConnectionStatus } from '../../shared/connections';
import type { SettingsSection } from './sections';

export type ConnectionRow = { section: SettingsSection; name: string; icon: ReactNode; status: ConnectionStatus };

/** One line per connection: what it is, whether it works, and a button to its section. */
export function ConnectionsOverview({ rows, open }: { rows: ConnectionRow[]; open(section: SettingsSection): void }) {
  return (
    <section className="panel connections-overview" aria-labelledby="connections-overview-title">
      <h2 id="connections-overview-title">Connections</h2>
      <ul>
        {rows.map(({ section, name, icon, status }) => (
          <li key={section} className={`connection-row ${status.tone}`}>
            <span className="connection-icon" aria-hidden="true">
              {icon}
            </span>
            <div className="connection-text">
              <b>{name}</b>
              {status.detail && <small>{status.detail}</small>}
            </div>
            <span className={`connection-state ${status.tone}`}>
              <span className="dot" aria-hidden="true" />
              {status.label}
            </span>
            <button
              type="button"
              className={status.tone === 'setup' ? 'primary' : 'secondary'}
              aria-label={`${status.action}: ${name}`}
              onClick={() => open(section)}
            >
              {status.action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
