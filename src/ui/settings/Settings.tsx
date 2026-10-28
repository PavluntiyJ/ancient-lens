import { useEffect, useState } from 'react';
import type { AppInfo, LocalState } from '../../shared/domain';
import type { SteamSetup } from '../../shared/steam-setup';
import { api, errorMessage, Notice, PageHeading } from '../App';
import { AppearanceSettings } from './Appearance';
import { DataSettings } from './DataSettings';
import { DotaConnectionSettings } from './DotaConnection';
import { MatchStatisticsSettings } from './MatchStatistics';
import { ProviderSettings } from './ProviderSettings';
import { ReaderSettings } from './ReaderSettings';
import { ShortcutSettings } from './ShortcutSettings';
import { SoundSettings } from './Sound';
import { WindowSettings } from './WindowSettings';

export function Settings({
  info,
  local,
  update,
  steamSetup,
  steamChanged,
  providerRevision,
  providerChanged,
}: {
  info?: AppInfo;
  local: LocalState;
  update(value: LocalState): void;
  steamSetup?: SteamSetup;
  steamChanged(value: SteamSetup): void;
  providerRevision: number;
  providerChanged(): void;
}) {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  // Pick suggestions and the lane totals need the local STRATZ service (as on the match screen).
  const [suggestions, setSuggestions] = useState<boolean>();
  useEffect(() => {
    let active = true;
    void api
      .getProvider()
      .then((provider) => active && setSuggestions(!!provider.serviceConfigured))
      .catch(() => active && setSuggestions(false));
    return () => {
      active = false;
    };
  }, [providerRevision]);
  async function save(kind: 'gsi' | 'backup') {
    setError('');
    setMessage('');
    try {
      const path = await (kind === 'gsi' ? api.exportGsi() : api.exportData());
      if (path) setMessage(`Saved: ${path}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const reader = (info?.platform === 'linux' || info?.platform === 'win32') && !!api.setNativeRosterReader;
  return (
    <>
      <PageHeading
        eyebrow="YOUR APP"
        title="Settings"
        description="Game connection, local data, and platform features."
      />
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
      <nav className="settings-sections" aria-label="Settings sections">
        {settingsSections
          .filter(([id]) => id !== 'settings-reader' || reader)
          .map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="link-button"
              onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' })}
            >
              {label}
            </button>
          ))}
      </nav>
      <AppearanceSettings />
      <ShortcutSettings local={local} update={update} info={info} />
      <SoundSettings />
      <div id="settings-provider">
        <ProviderSettings changed={providerChanged} />
      </div>
      {reader && (
        <div id="settings-reader">
          <ReaderSettings windows={info?.platform === 'win32'} local={local} update={update} />
        </div>
      )}
      <MatchStatisticsSettings suggestions={suggestions} />
      <div className="settings-grid">
        <DotaConnectionSettings
          info={info}
          steamSetup={steamSetup}
          steamChanged={steamChanged}
          saveGsi={() => void save('gsi')}
        />
        <div className="settings-stack">
          <DataSettings info={info} exportData={() => void save('backup')} />
          <WindowSettings info={info} local={local} update={update} />
        </div>
      </div>
    </>
  );
}

const settingsSections = [
  ['settings-appearance', 'Appearance'],
  ['settings-shortcuts', 'Shortcuts'],
  ['settings-sound', 'Sound'],
  ['settings-provider', 'Player history'],
  ['settings-reader', 'Memory reading'],
  ['settings-statistics', 'Match statistics'],
  ['settings-game', 'Connect Dota 2'],
  ['settings-data', 'Your data'],
  ['settings-window', 'Window'],
] as const;
