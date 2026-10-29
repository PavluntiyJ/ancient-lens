import { useEffect, useState, type ReactNode } from 'react';
import { Activity, Cpu, TrendingUp } from 'lucide-react';
import type { AppInfo, LiveState, LocalState, ProviderInfo, ReleaseInfo } from '../../shared/domain';
import { gameConnection, readerConnection, stratzConnection } from '../../shared/connections';
import type { SteamSetup } from '../../shared/steam-setup';
import { api, PageHeading } from '../App';
import { AppearanceSettings } from './Appearance';
import { ConnectionsOverview, type ConnectionRow } from './ConnectionsOverview';
import { DataSettings } from './DataSettings';
import { DotaConnectionSettings } from './DotaConnection';
import { MatchStatisticsSettings } from './MatchStatistics';
import { ProviderSettings } from './ProviderSettings';
import { ReaderSettings } from './ReaderSettings';
import { settingsGroups, showSection, type SettingsSection } from './sections';
import { ShortcutSettings } from './ShortcutSettings';
import { SoundSettings } from './Sound';
import { UpdateSettings } from './UpdateSettings';
import { WindowSettings } from './WindowSettings';

export function Settings({
  info,
  local,
  update,
  live,
  connected,
  steamSetup,
  steamChanged,
  providerRevision,
  providerChanged,
  section,
  openDiagnostics,
  release,
}: {
  info?: AppInfo;
  local: LocalState;
  update(value: LocalState): void;
  live: LiveState;
  connected: boolean;
  steamSetup?: SteamSetup;
  steamChanged(value: SteamSetup): void;
  providerRevision: number;
  providerChanged(): void;
  /** Section to show on opening; a new object scrolls to it again. */
  section?: { id: SettingsSection };
  openDiagnostics(): void;
  /** This version and the newest release the background check found. */
  release?: ReleaseInfo;
}) {
  // Pick suggestions and the lane totals need the local STRATZ service (as on the match screen).
  const [provider, setProvider] = useState<ProviderInfo>();
  const [providerFailed, setProviderFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void api.getProvider().then(
      (value) => {
        if (!active) return;
        setProvider(value);
        setProviderFailed(false);
      },
      () => active && setProviderFailed(true),
    );
    return () => {
      active = false;
    };
  }, [providerRevision]);
  const suggestions = providerFailed ? false : provider && !!provider.serviceConfigured;
  const reader = (info?.platform === 'linux' || info?.platform === 'win32') && !!api.setNativeRosterReader;
  const groups = settingsGroups.map((group) => ({
    ...group,
    sections: group.sections.filter(([id]) => id !== 'settings-reader' || reader),
  }));
  const sectionIds = groups.flatMap((group) => group.sections.map(([id]) => id));
  const current = useCurrentSection(sectionIds) ?? sectionIds[0];
  // Async sections above the target (Steam check, provider) can grow after the first
  // scroll, so it is repeated once they have had a moment to load.
  useEffect(() => {
    if (!section) return;
    const frame = requestAnimationFrame(() => showSection(section.id, 'auto'));
    const again = setTimeout(() => showSection(section.id, 'auto'), 400);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(again);
    };
  }, [section]);
  const rows: ConnectionRow[] = [
    {
      section: 'settings-game',
      name: 'Dota 2 (GSI)',
      icon: <Activity size={18} />,
      status: gameConnection(live, connected, steamSetup),
    },
    {
      section: 'settings-provider',
      name: 'STRATZ',
      icon: <TrendingUp size={18} />,
      status: providerFailed
        ? { tone: 'off', label: 'Unknown', detail: 'Could not read the provider status.', action: 'Open' }
        : stratzConnection(provider),
    },
    ...(reader
      ? [
          {
            section: 'settings-reader' as const,
            name: 'Memory reading',
            icon: <Cpu size={18} />,
            status: readerConnection(local.nativeRosterReader, live),
          },
        ]
      : []),
  ];
  return (
    <>
      <PageHeading
        eyebrow="YOUR APP"
        title="Settings"
        description="Game connection, local data, and platform features."
      />
      <ConnectionsOverview rows={rows} open={(id) => showSection(id)} />
      <div className="settings-layout">
        <nav className="settings-sections" aria-label="Settings sections">
          {groups.map((group) => (
            <div key={group.id} className="settings-nav-group">
              <span className="settings-nav-label">{group.name}</span>
              {group.sections.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`link-button${current === id ? ' active' : ''}`}
                  aria-current={current === id ? 'location' : undefined}
                  onClick={() => showSection(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="settings-body">
          <SettingsGroup id="connections" name="Connections">
            <DotaConnectionSettings
              info={info}
              steamSetup={steamSetup}
              steamChanged={steamChanged}
              openDiagnostics={openDiagnostics}
            />
            <div id="settings-provider">
              <ProviderSettings changed={providerChanged} />
            </div>
            {reader && (
              <div id="settings-reader">
                <ReaderSettings windows={info?.platform === 'win32'} local={local} update={update} />
              </div>
            )}
          </SettingsGroup>
          <SettingsGroup id="match" name="Match & statistics">
            <MatchStatisticsSettings suggestions={suggestions} />
          </SettingsGroup>
          <SettingsGroup id="interface" name="Interface">
            <AppearanceSettings />
            <ShortcutSettings local={local} update={update} info={info} />
            <SoundSettings />
            <WindowSettings info={info} local={local} update={update} />
          </SettingsGroup>
          <SettingsGroup id="data" name="Data">
            <DataSettings info={info} />
            <UpdateSettings local={local} update={update} release={release} />
          </SettingsGroup>
        </div>
      </div>
    </>
  );
}

function SettingsGroup({ id, name, children }: { id: string; name: string; children: ReactNode }) {
  return (
    <section className="settings-group" aria-labelledby={`settings-group-${id}`}>
      <h2 className="settings-group-title" id={`settings-group-${id}`}>
        {name}
      </h2>
      {children}
    </section>
  );
}

/** The topmost section in the upper part of the window, for the side list. */
function useCurrentSection(ids: SettingsSection[]) {
  const [current, setCurrent] = useState<SettingsSection>();
  const key = ids.join(',');
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const list = key.split(',') as SettingsSection[];
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const first = list.find((id) => visible.get(id));
        if (first) setCurrent(first);
      },
      { rootMargin: '0px 0px -50% 0px' },
    );
    for (const id of list) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);
  return current;
}
