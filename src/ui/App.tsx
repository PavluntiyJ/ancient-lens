import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { Crosshair, Minus, Square, Search, X } from 'lucide-react';
import {
  applyStateUpdate,
  type AppInfo,
  type DesktopApi,
  type LiveState,
  type LocalState,
  type OwnUpdate,
  type WindowEdge,
} from '../shared/domain';
import type { SteamSetup } from '../shared/steam-setup';
import { Draft } from './Draft';
import { Roster } from './Roster';
import { MatchScreen } from './MatchScreen';
import { MatchViewport } from './MatchViewport';
import { Notes } from './LocalTools';
import { OwnProfile } from './OwnProfile';
import { Diagnostics } from './Diagnostics';
import { Settings } from './settings/Settings';
import type { SettingsSection } from './settings/sections';
import { HeaderNav, type Page } from './HeaderNav';
import { TooltipLayer } from './Tooltip';
import { ShortcutsProvider } from './shortcut-context';
import { defaultShortcuts, matchesShortcut } from '../shared/shortcuts';
import { useDisplaySettings } from './preferences';
import { StratzConnectDialog } from './StratzConnect';
import { ReaderConsentDialog, readerAsked } from './ReaderConsent';
import { shouldAskReader } from '../shared/reader-notice';

declare global {
  interface Window {
    ancient: DesktopApi;
  }
}
export const api = window.ancient;
export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : 'Could not complete the action.';
}
export const number = (value: number | undefined | null) => (value == null ? '—' : value.toLocaleString('en-US'));
export const date = (value: string | number) =>
  new Date(value).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
export function Empty({
  icon = <Search size={28} />,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
export function Stat({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function App() {
  const display = useDisplaySettings();
  // The window cannot shrink below the size that shows the whole match screen at this scale.
  useEffect(() => {
    void api.setWindowMinSize?.(display.scale).catch(() => {});
  }, [display.scale]);
  const [local, setLocal] = useState<LocalState>({ accountId: '', notes: [], mmr: [] });
  const updateLocal = (value: LocalState | OwnUpdate) => setLocal((current) => applyStateUpdate(current, value));
  const [info, setInfo] = useState<AppInfo>();
  const [live, setLive] = useState<LiveState>({ status: 'waiting', receivedAt: null });
  const [page, setPage] = useState<Page>('home');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const [ready, setReady] = useState(false);
  const [providerRevision, setProviderRevision] = useState(0);
  const [stratzOpen, setStratzOpen] = useState(false);
  const [askReader, setAskReader] = useState(false);
  const [steamSetup, setSteamSetup] = useState<SteamSetup>();
  const [settingsSection, setSettingsSection] = useState<{ id: SettingsSection }>();
  const open = (next: Page) => {
    setPage(next);
    setError('');
  };
  const openSettings = (id?: SettingsSection) => {
    setSettingsSection(id ? { id } : undefined);
    open('settings');
  };
  useEffect(() => {
    let active = true;
    if (!api) {
      setError('Launch the desktop app with npm run dev.');
      return;
    }
    void Promise.all([api.getState(), api.getInfo(), api.getLive()])
      .then(([state, appInfo, current]) => {
        if (!active) return;
        updateLocal(state);
        setInfo(appInfo);
        setLive(current);
        setReady(true);
        setAskReader(!!api.setNativeRosterReader && shouldAskReader(appInfo, state.nativeRosterReader, readerAsked()));
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    const unsubscribe = api.onLive((value) => {
      if (active) setLive(value);
    });
    const unsubscribeState = api.onState?.((value) => {
      if (active) updateLocal(value);
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      unsubscribe();
      unsubscribeState?.();
      clearInterval(timer);
    };
  }, []);
  // A desktop that only offers an X11 key grab misses the shortcut while this window has the
  // keyboard; handle it here so the second press always hides the window. Windows registers
  // the global key and would otherwise toggle twice.
  const shortcuts = { ...defaultShortcuts, ...local.shortcuts };
  const globalShortcut = shortcuts.global;
  useEffect(() => {
    if (info?.platform !== 'linux' || info?.shortcutTrigger) return;
    const toggle = (event: KeyboardEvent) => {
      if (!matchesShortcut(event, globalShortcut)) return;
      event.preventDefault();
      if (!event.repeat) void api?.toggleWindow().catch(() => {});
    };
    window.addEventListener('keydown', toggle);
    return () => window.removeEventListener('keydown', toggle);
  }, [info?.platform, info?.shortcutTrigger, globalShortcut]);
  // Checked again periodically and on opening Settings, so later changes are noticed.
  const onSettings = page === 'settings';
  useEffect(() => {
    if (!api?.getSteamSetup) return;
    let active = true;
    const check = () =>
      api.getSteamSetup!().then(
        (value) => {
          if (active) setSteamSetup(value);
        },
        () => {},
      );
    void check();
    const timer = setInterval(check, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [onSettings]);
  const connected = live.status === 'connected' && live.receivedAt !== null && now - live.receivedAt < 30_000;
  async function windowAction(action: 'drag' | 'minimize' | 'maximize' | 'close') {
    try {
      await api.windowAction?.(action);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <ShortcutsProvider value={shortcuts}>
      <div
        className={`app-shell match-shell ${display.compact ? 'compact-rows' : ''}`}
        style={{ zoom: display.scale / 100, '--ui-scale': display.scale / 100 } as CSSProperties}
      >
        <header className="app-toolbar slim-toolbar">
          <div
            className="titlebar-drag"
            title={`Ancient Lens · ${info?.version ?? '0.4.1'}`}
            onMouseDown={(event) => {
              if (event.button === 0 && event.detail === 1) void windowAction('drag');
            }}
            onDoubleClick={() => void windowAction('maximize')}
          >
            <div className="compact-brand">
              <Crosshair size={17} />
              <b>Ancient Lens</b>
            </div>
          </div>
          <HeaderNav page={page} open={(next) => (next === 'settings' ? openSettings() : open(next))} />
          {api.windowAction && (
            <div className="window-controls">
              <button aria-label="Minimize window" title="Minimize" onClick={() => void windowAction('minimize')}>
                <Minus size={15} />
              </button>
              <button
                aria-label="Maximize or restore window"
                title="Maximize / restore"
                onClick={() => void windowAction('maximize')}
              >
                <Square size={13} />
              </button>
              <button
                className="window-close"
                aria-label="Close window"
                title="Close"
                onClick={() => void windowAction('close')}
              >
                <X size={16} />
              </button>
            </div>
          )}
        </header>
        <main>
          <div className={`content ${page === 'home' ? 'match-content' : ''}`}>
            {error && (
              <Notice error>
                {error}
                <button className="notice-close" aria-label="Dismiss message" onClick={() => setError('')}>
                  <X size={16} />
                </button>
              </Notice>
            )}
            {!ready && !error && <Notice>Opening workspace…</Notice>}
            <MatchViewport active={page === 'home'}>
              <MatchScreen
                ownAccountId={local.accountId}
                ownMmr={local.ownAccount?.mmr ?? local.ratingSnapshot?.mmr}
                platform={info?.platform}
                active={page === 'home'}
                providerRevision={providerRevision}
                live={live}
                connected={connected}
                notes={local.notes}
                recordedMatches={local.recordedMatches ?? 0}
                steamSetup={steamSetup}
                setup={openSettings}
                openTool={open}
                connectStratz={() => setStratzOpen(true)}
              />
            </MatchViewport>
            {page === 'profile' && <OwnProfile key={local.accountId} local={local} update={updateLocal} />}
            <div hidden={page !== 'draft'}>
              <Draft active={page === 'draft'} />
            </div>
            <div hidden={page !== 'roster'}>
              <Roster active={page === 'roster'} notes={local.notes} />
            </div>
            {page === 'notes' && <Notes local={local} update={updateLocal} initialId={local.accountId} />}
            {page === 'live' && (
              <Diagnostics live={live} connected={connected} info={info} setup={() => openSettings('settings-game')} />
            )}
            {page === 'settings' && (
              <Settings
                local={local}
                update={updateLocal}
                info={info}
                live={live}
                connected={connected}
                section={settingsSection}
                openDiagnostics={() => open('live')}
                steamSetup={steamSetup}
                steamChanged={setSteamSetup}
                providerRevision={providerRevision}
                providerChanged={() => setProviderRevision((value) => value + 1)}
              />
            )}
          </div>
        </main>
      </div>
      {askReader && (
        <ReaderConsentDialog
          windows={info?.platform === 'win32'}
          update={updateLocal}
          close={() => setAskReader(false)}
        />
      )}
      {stratzOpen && (
        <StratzConnectDialog
          close={() => setStratzOpen(false)}
          connected={() => setProviderRevision((value) => value + 1)}
        />
      )}
      {api.resizeWindow &&
        (['North', 'South', 'East', 'West', 'NorthEast', 'NorthWest', 'SouthEast', 'SouthWest'] as WindowEdge[]).map(
          (edge) => (
            <div
              key={edge}
              className={`window-resize-edge edge-${edge.toLowerCase()}`}
              aria-hidden="true"
              onMouseDown={(event) => {
                if (event.button === 0) void api.resizeWindow!(edge).catch((e) => setError(errorMessage(e)));
              }}
            />
          ),
        )}
      <TooltipLayer scale={display.scale / 100} />
    </ShortcutsProvider>
  );
}

export function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="page-heading" data-section={eyebrow}>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}
