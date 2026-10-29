import { lazy, Suspense, useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { Crosshair, Search, X } from 'lucide-react';
import {
  applyStateUpdate,
  type AppInfo,
  type DesktopApi,
  type LiveState,
  type LocalState,
  type OwnUpdate,
} from '../shared/domain';
import type { SteamSetup } from '../shared/steam-setup';
import { Draft } from './Draft';
import { Roster } from './Roster';
import { MatchScreen } from './MatchScreen';
import { MatchViewport } from './MatchViewport';
import type { SettingsSection } from './settings/sections';
import { HeaderNav, type Page } from './HeaderNav';
import { TooltipLayer } from './Tooltip';
import { ShortcutsProvider } from './shortcut-context';
import { defaultShortcuts } from '../shared/shortcuts';
import { useDisplaySettings } from './preferences';
import { StratzConnectDialog, stratzAsked } from './StratzConnect';
import { ReaderConsentDialog, readerAsked } from './ReaderConsent';
import { shouldAskReader } from '../shared/reader-notice';
import { shouldAskStratz } from '../shared/stratz-notice';
import { ResizeEdges, TitleBar, useFallbackShortcuts, useKeyboardOnDemand } from './WindowFrame';

// Pages opened from the header load on first use, so the match screen starts with less code.
const Notes = lazy(() => import('./LocalTools').then((module) => ({ default: module.Notes })));
const Diagnostics = lazy(() => import('./Diagnostics').then((module) => ({ default: module.Diagnostics })));
const Settings = lazy(() => import('./settings/Settings').then((module) => ({ default: module.Settings })));

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
  const [stratzOpen, setStratzOpen] = useState<'startup' | 'manual' | null>(null);
  const [askReader, setAskReader] = useState(false);
  const [steamSetup, setSteamSetup] = useState<SteamSetup>();
  const [settingsSection, setSettingsSection] = useState<{ id: SettingsSection }>();
  const open = (next: Page) => {
    // The profile has a window of its own.
    if (next === 'profile') {
      void api.showWindow?.('profile').catch((e) => setError(errorMessage(e)));
      return;
    }
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
    // STRATZ connected or disconnected in the profile window.
    const unsubscribeProvider = api.onProvider?.(() => {
      if (active) setProviderRevision((value) => value + 1);
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      unsubscribe();
      unsubscribeState?.();
      unsubscribeProvider?.();
      clearInterval(timer);
    };
  }, []);
  // Wait for either reader decision, then offer STRATZ even when reading was skipped.
  // A failed provider lookup leaves normal startup usable; Settings can retry it later.
  useEffect(() => {
    if (!ready || askReader || stratzAsked()) return;
    let active = true;
    void api.getProvider().then(
      (provider) => {
        if (active && api.connectStratz && shouldAskStratz(info, provider, stratzAsked())) setStratzOpen('startup');
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [ready, askReader, info, providerRevision]);
  const shortcuts = { ...defaultShortcuts, ...local.shortcuts };
  useFallbackShortcuts(info, shortcuts);
  useKeyboardOnDemand(info);
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
  return (
    <ShortcutsProvider value={shortcuts}>
      <div
        className={`app-shell match-shell ${display.compact ? 'compact-rows' : ''}`}
        style={{ zoom: display.scale / 100, '--ui-scale': display.scale / 100 } as CSSProperties}
      >
        <TitleBar
          title={info?.version ? `Ancient Lens · ${info.version}` : 'Ancient Lens'}
          brand={
            <>
              <Crosshair size={17} />
              <b>Ancient Lens</b>
            </>
          }
          info={info}
          onError={setError}
        >
          <HeaderNav page={page} open={(next) => (next === 'settings' ? openSettings() : open(next))} />
        </TitleBar>
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
                connectStratz={() => setStratzOpen('manual')}
              />
            </MatchViewport>
            <div hidden={page !== 'draft'}>
              <Draft active={page === 'draft'} />
            </div>
            <div hidden={page !== 'roster'}>
              <Roster active={page === 'roster'} notes={local.notes} />
            </div>
            <Suspense fallback={null}>
              {page === 'notes' && <Notes local={local} update={updateLocal} initialId={local.accountId} />}
              {page === 'live' && (
                <Diagnostics
                  live={live}
                  connected={connected}
                  info={info}
                  setup={() => openSettings('settings-game')}
                />
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
            </Suspense>
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
      {stratzOpen && !askReader && (
        <StratzConnectDialog
          firstRun={stratzOpen === 'startup'}
          close={() => setStratzOpen(null)}
          connected={() => setProviderRevision((value) => value + 1)}
        />
      )}
      <ResizeEdges onError={setError} />
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
