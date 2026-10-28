import { useEffect, useState, type FormEvent, type ReactNode, type CSSProperties } from 'react';
import {
  Activity,
  ArrowRight,
  BookOpen,
  Crosshair,
  Download,
  LayoutDashboard,
  Monitor,
  Minus,
  Square,
  Wrench,
  Search,
  Settings,
  Shield,
  Swords,
  TrendingUp,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import {
  applyStateUpdate,
  formatDuration,
  type AppInfo,
  type DesktopApi,
  type LiveState,
  type LocalState,
  type OwnUpdate,
  type ProviderInfo,
  type WindowEdge,
} from '../shared/domain';
import { readerRisk, readerRiskWindows } from '../shared/reader-notice';
import type { SteamSetup } from '../shared/steam-setup';
import { MIN_WIN_RATE } from '../shared/draft';
import { SteamSetupPanel } from './SteamSetup';
import { Draft } from './Draft';
import { Roster } from './Roster';
import { MatchScreen } from './MatchScreen';
import { MatchViewport } from './MatchViewport';
import { Notes } from './LocalTools';
import { OwnProfile } from './OwnProfile';
import { TooltipLayer } from './Tooltip';
import { Keycaps } from './Keycaps';
import { ShortcutSettings } from './ShortcutSettings';
import { ShortcutsProvider } from './shortcut-context';
import { defaultShortcuts, matchesShortcut } from '../shared/shortcuts';
import {
  setIncludeTurbo,
  setRankedOnly,
  useStatsFilter,
  useSynergyWeight,
  setSynergyWeight,
  useMinWinRate,
  setMinWinRate,
  useDisplaySettings,
  setDisplaySettings,
  defaultDisplay,
  displayScales,
  useEncounterSound,
  setEncounterSound,
  useRankBracket,
  setRankBracket,
} from './preferences';
import { rankBrackets, type BracketSetting } from '../shared/rank-bracket';
import { playChime } from './sound';
import { StratzConnectDialog, StratzConnectForm } from './StratzConnect';

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
const nav = [
  { id: 'home', name: 'Match and draft', icon: LayoutDashboard },
  { id: 'draft', name: 'Manual draft', icon: Swords },
  { id: 'roster', name: 'Manual roster', icon: Users },
  { id: 'profile', name: 'My profile', icon: UserRound },
  { id: 'notes', name: 'Notes', icon: BookOpen },
  { id: 'live', name: 'GSI diagnostics', icon: Activity },
  { id: 'settings', name: 'Settings', icon: Settings },
] as const;
type Page = (typeof nav)[number]['id'];

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
  const [steamSetup, setSteamSetup] = useState<SteamSetup>();
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
          <nav aria-label="Sections">
            {nav
              .filter((item) => !['draft', 'roster', 'live', 'notes'].includes(item.id))
              .map((item) => (
                <button
                  key={item.id}
                  className={page === item.id ? 'active' : ''}
                  aria-label={item.name}
                  title={item.name}
                  aria-current={page === item.id ? 'page' : undefined}
                  onClick={() => {
                    setPage(item.id);
                    setError('');
                  }}
                >
                  <item.icon size={16} />
                  <span className="sr-only">{item.name}</span>
                </button>
              ))}
          </nav>
          <select
            className="toolbar-scale"
            aria-label="Interface scale"
            title="Interface scale. The match screen also adapts to the window size."
            value={display.scale}
            onChange={(event) => setDisplaySettings({ scale: Number(event.target.value) })}
          >
            {displayScales.map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
          <details className="tools-menu">
            <summary title="Tools" aria-label="Tools">
              <Wrench size={16} />
              <span className="sr-only">Tools</span>
            </summary>
            <div>
              {nav
                .filter((item) => ['draft', 'roster', 'live'].includes(item.id))
                .map((item) => (
                  <button
                    key={item.id}
                    onClick={(event) => {
                      setPage(item.id);
                      event.currentTarget.closest('details')?.removeAttribute('open');
                    }}
                  >
                    <item.icon size={15} />
                    {item.name}
                  </button>
                ))}
            </div>
          </details>
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
                setup={() => setPage('settings')}
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
              <>
                <PageHeading
                  eyebrow="IN GAME"
                  title="Current match"
                  description="Statistics sent locally by Dota 2 through Game State Integration."
                />
                <div className="live-layout">
                  <section className="panel">
                    <LivePanel live={live} connected={connected} />
                  </section>
                  <section className="panel">
                    <h2>Keep the match in view</h2>
                    <p className="muted">
                      Press Alt + Num 5 to bring this window over the game and again to hide it. Closing the window
                      keeps Ancient Lens in the tray.
                    </p>
                    {info?.wayland && (
                      <Notice>
                        On Wayland, window position and always-on-top behavior are controlled by your window manager.
                      </Notice>
                    )}
                    <button className="text-button" onClick={() => setPage('settings')}>
                      Set up connection <ArrowRight size={16} />
                    </button>
                  </section>
                </div>
              </>
            )}
            {page === 'settings' && (
              <SettingsPanel
                local={local}
                update={updateLocal}
                info={info}
                steamSetup={steamSetup}
                steamChanged={setSteamSetup}
                providerRevision={providerRevision}
                providerChanged={() => setProviderRevision((value) => value + 1)}
              />
            )}
          </div>
        </main>
      </div>
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
function LivePanel({ live, connected, compact = false }: { live: LiveState; connected: boolean; compact?: boolean }) {
  const [selectedKey, setSelectedKey] = useState('');
  const watched = live.players?.find((player) => player.key === selectedKey) ?? live.players?.[0];
  const stats = watched ?? live;
  if (live.status === 'error') return <Notice error>{live.error}</Notice>;
  if (!connected)
    return (
      <Empty
        icon={<Activity size={30} />}
        title={live.receivedAt ? 'Connection to the game interrupted' : 'No events from Dota 2'}
      >
        Install the GSI configuration from Settings, add -gamestateintegration to the Steam launch options, and restart
        Dota 2. Then play or spectate a match.
      </Empty>
    );
  return (
    <div className={compact ? 'live-panel compact' : 'live-panel'}>
      <div className="section-title">
        <span className="live-badge">LIVE</span>
        <strong className="mono">{live.clock === undefined ? '—' : formatDuration(live.clock)}</strong>
      </div>
      {watched && (
        <label className="field-label">
          Spectating · player
          <select aria-label="Player to spectate" value={watched.key} onChange={(e) => setSelectedKey(e.target.value)}>
            {live.players?.map((player) => (
              <option key={player.key} value={player.key}>
                {player.team === 'radiant' ? 'Radiant' : 'Dire'} · {player.name || player.hero || player.key}
              </option>
            ))}
          </select>
        </label>
      )}
      <h2 className="live-hero">
        {stats.hero || 'Hero selection'}
        {stats.level !== undefined && <span className="badge">LVL {stats.level}</span>}
      </h2>
      <p className="muted">
        {live.matchId && live.matchId !== '0' ? `Match #${live.matchId}` : 'Match without a public ID'}
      </p>
      <div className="live-numbers">
        <Stat label="K / D / A" value={`${number(stats.kills)} / ${number(stats.deaths)} / ${number(stats.assists)}`} />
        <Stat label="LH / DN" value={`${number(stats.lastHits)} / ${number(stats.denies)}`} />
        <Stat label="Gold" value={number(stats.gold)} />
      </div>
      {stats.maxHealth !== undefined && (
        <div className="vital">
          <label>
            Health{' '}
            <span>
              {number(stats.health)} / {number(stats.maxHealth)}
            </span>
          </label>
          <progress max={stats.maxHealth || 1} value={stats.health ?? 0} />
        </div>
      )}
      {stats.maxMana !== undefined && (
        <div className="vital mana">
          <label>
            Mana{' '}
            <span>
              {number(stats.mana)} / {number(stats.maxMana)}
            </span>
          </label>
          <progress max={stats.maxMana || 1} value={stats.mana ?? 0} />
        </div>
      )}
    </div>
  );
}
function SettingsPanel({
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
  const statsFilter = useStatsFilter();
  const synergyWeight = useSynergyWeight();
  const minWinRate = useMinWinRate();
  const display = useDisplaySettings();
  const encounterSound = useEncounterSound();
  const rankBracket = useRankBracket();
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
          .filter(
            ([id]) =>
              id !== 'settings-reader' ||
              ((info?.platform === 'linux' || info?.platform === 'win32') && api.setNativeRosterReader),
          )
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
      <section className="panel display-settings" id="settings-appearance">
        <h2>Appearance</h2>{' '}
        <div className="scale-setting">
          <span id="scale-label">Interface scale</span>
          <div className="scale-options" role="group" aria-labelledby="scale-label">
            {displayScales.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={display.scale === value}
                onClick={() => setDisplaySettings({ scale: value })}
              >
                {value}%
              </button>
            ))}
          </div>
        </div>
        <p className="fine-print">
          Scales the whole window. The match screen still shrinks itself to fit, down to 90%.
        </p>
        <label>
          <input
            type="checkbox"
            checked={display.compact}
            onChange={(e) => setDisplaySettings({ compact: e.target.checked })}
          />
          Compact rows
        </label>
        <p className="fine-print">Shorter roster rows, so more fits on a small screen.</p>
        <fieldset>
          <legend>Match table columns</legend>
          {(
            [
              ['rank', 'Rank'],
              ['totals', 'Total matches'],
              ['frequent', 'Frequent heroes'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={display[key]}
                onChange={(e) => setDisplaySettings({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
          <p className="fine-print">Hidden columns only leave the roster table; their data still loads.</p>
        </fieldset>
        <button className="secondary" onClick={() => setDisplaySettings(defaultDisplay)}>
          Reset appearance
        </button>
      </section>
      <ShortcutSettings local={local} update={update} info={info} />
      <section className="panel display-settings" id="settings-sound">
        <h2>Sound</h2>
        <label>
          <input type="checkbox" checked={encounterSound} onChange={(e) => setEncounterSound(e.target.checked)} />
          Chime for players with a note
        </label>
        <p className="fine-print">
          Plays when a match you play or watch has someone you wrote a note about, once per player; a lower chime marks
          a "Watch out" note. Notes are kept on this computer by Dota ID, so private profiles count too.
        </p>
        <button type="button" className="secondary" onClick={() => playChime('note')}>
          Play note
        </button>
        <button type="button" className="secondary" onClick={() => playChime('avoid')}>
          Play watch out
        </button>
      </section>
      <div id="settings-provider">
        <ProviderSettings changed={providerChanged} />
      </div>
      {(info?.platform === 'linux' || info?.platform === 'win32') && api.setNativeRosterReader && (
        <div id="settings-reader">
          <ReaderSettings windows={info.platform === 'win32'} local={local} update={update} />
        </div>
      )}
      <section className="panel stats-preferences" id="settings-statistics">
        <h2>Match statistics</h2>
        <label>
          <input
            type="checkbox"
            checked={statsFilter.mode === 'all'}
            onChange={(event) => setIncludeTurbo(event.target.checked)}
          />{' '}
          Include Turbo
        </label>
        <p className="fine-print">
          Adds Turbo games to roster statistics and the profile table. Reloads roster statistics.
        </p>
        <label>
          <input
            type="checkbox"
            checked={statsFilter.rankedOnly}
            onChange={(event) => setRankedOnly(event.target.checked)}
          />{' '}
          Ranked statistics only
        </label>
        <p className="fine-print">
          Leaves unranked matchmaking out of roster statistics; the profile keeps its own filters. Reloads roster
          statistics.
        </p>
        <label className="field-label">
          Rank for hero statistics
          <select value={rankBracket} onChange={(event) => setRankBracket(event.target.value as BracketSetting)}>
            <option value="auto">Automatic</option>
            {rankBrackets.map((bracket) => (
              <option key={bracket.id} value={bracket.id}>
                {bracket.name}
              </option>
            ))}
            <option value="ALL">All ranks</option>
          </select>
        </label>
        <p className="fine-print">
          Matchups, pick recommendations and meta picks use STRATZ statistics of this rank. Automatic follows the median
          rank of the match's players, or your own rank when they are unknown, and keeps it for the match. Divine and
          Immortal are one group in STRATZ. A narrow rank has fewer games, so rare pairs show less data.
        </p>
        <div className={`synergy-setting${suggestions === false ? ' disabled' : ''}`}>
          <label htmlFor="synergy-weight">Synergy weight: {synergyWeight}%</label>
          <input
            id="synergy-weight"
            type="range"
            min="0"
            max="100"
            step="5"
            list="synergy-stops"
            aria-label="Synergy weight"
            aria-describedby="synergy-note"
            value={synergyWeight}
            disabled={suggestions === false}
            onChange={(event) => setSynergyWeight(Number(event.target.value))}
          />
          <datalist id="synergy-stops">
            {synergyStops.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
          <div className="range-stops" aria-hidden="true">
            {synergyStops.map((value) => (
              <button
                key={value}
                type="button"
                tabIndex={-1}
                disabled={suggestions === false}
                className={synergyWeight === value ? 'active' : undefined}
                onClick={() => setSynergyWeight(value)}
              >
                {value}%
              </button>
            ))}
          </div>
          <p className="fine-print" id="synergy-note">
            {suggestions === false
              ? 'Unavailable: pick suggestions and lane totals need STRATZ (connect it under Player history).'
              : 'How much allies count in pick suggestions and the Lanes total. Re-scores loaded data without reloading.'}
          </p>
        </div>
        <div className={`synergy-setting${suggestions === false ? ' disabled' : ''}`}>
          <label className={suggestions === false ? 'disabled' : undefined}>
            <input
              type="checkbox"
              checked={minWinRate.enabled}
              disabled={suggestions === false}
              aria-describedby="min-win-rate-note"
              onChange={(event) => setMinWinRate({ ...minWinRate, enabled: event.target.checked })}
            />{' '}
            Minimum hero win rate for suggestions: {minWinRate.value}%
          </label>
          <input
            type="range"
            min={MIN_WIN_RATE.min}
            max={MIN_WIN_RATE.max}
            step="1"
            aria-label="Minimum hero win rate for suggestions"
            aria-describedby="min-win-rate-note"
            value={minWinRate.value}
            disabled={suggestions === false || !minWinRate.enabled}
            onChange={(event) => setMinWinRate({ ...minWinRate, value: Number(event.target.value) })}
          />
          <div className={`range-stops${minWinRate.enabled ? '' : ' off'}`} aria-hidden="true">
            {minWinRateStops.map((value) => (
              <button
                key={value}
                type="button"
                tabIndex={-1}
                disabled={suggestions === false || !minWinRate.enabled}
                className={minWinRate.value === value ? 'active' : undefined}
                onClick={() => setMinWinRate({ ...minWinRate, value })}
              >
                {value}%
              </button>
            ))}
          </div>
          <p className="fine-print" id="min-win-rate-note">
            Hides suggested heroes whose win rate in that position is not above the threshold. Off by default.
          </p>
        </div>
      </section>
      <div className="settings-grid">
        <section className="panel" id="settings-game">
          <div className="panel-icon">
            <Activity />
          </div>
          <h2>Connect Dota 2</h2>
          <SteamSetupPanel setup={steamSetup} changed={steamChanged}>
            <ol className="setup-steps">
              <li>
                <b>Save the configuration</b>
                <p>
                  The button below creates a file for this computer. If you saved a configuration before, save it again
                  and replace it in the game folder to enable the draft block.
                </p>
              </li>
              <li>
                <b>Move the file to the game folder</b>
                <p>Steam → Dota 2 → Manage → Browse local files.</p>
                <code>game/dota/cfg/gamestate_integration/</code>
                <p>
                  Create the last folder if it does not exist. Keep the filename{' '}
                  <code>gamestate_integration_ancient_lens.cfg</code>.
                </p>
              </li>
              <li>
                <b>Add the Steam launch option</b>
                <code>-gamestateintegration</code>
                <p>Restart Dota 2 and enter a match.</p>
              </li>
            </ol>
            <button className="secondary" onClick={() => void save('gsi')}>
              <Download size={17} />
              Save GSI configuration
            </button>
            <p className="fine-print">
              Local connection: 127.0.0.1:{info?.gsiPort ?? 32123}. The file contains the receiver access token. Do not
              publish it.
            </p>
          </SteamSetupPanel>
        </section>
        <div className="settings-stack">
          <section className="panel" id="settings-data">
            <div className="panel-icon">
              <Shield />
            </div>
            <h2>Your data belongs to you</h2>
            <p className="muted">
              No ads, usage analytics, or cloud account. Your statistics provider receives your IP address and the
              requested player IDs. When the service is connected, personal history and match statistics load from
              STRATZ.
            </p>
            <p className="fine-print">Data folder</p>
            <code className="path">{info?.dataPath ?? 'Loading…'}</code>
            <button className="secondary" onClick={() => void save('backup')}>
              <Download size={16} />
              Export notes and MMR
            </button>
          </section>
          <section className="panel" id="settings-window">
            <div className="panel-icon">
              <Monitor />
            </div>
            <h2>Window over the game</h2>
            {info?.shortcut ? (
              <p className="muted shortcut-line">
                <Keycaps combo={info.shortcutTrigger || local.shortcuts?.global || info.shortcutKey || 'Alt+Numpad5'} />{' '}
                shows this window over the game, or hides it when it is already in front.
              </p>
            ) : (
              <p className="muted">The hotkey is unavailable on this system.</p>
            )}
            <p className="fine-print">
              {info?.shortcutTrigger
                ? 'Your desktop assigned this shortcut. Change it in the system settings under Shortcuts → Ancient Lens.'
                : 'Change the key under Shortcuts above. Run the game in borderless windowed mode.'}{' '}
              {info?.wayland
                ? 'On Wayland, keeping the window above the game is set in the window menu (Keep above others).'
                : ''}
            </p>
            {api.setCloseToTray && <TraySetting local={local} update={update} available={!!info?.tray} />}
            <span className="badge">
              {info?.platform ?? 'Desktop'} · v{info?.version ?? '0.2.0'}
            </span>
          </section>
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
const synergyStops = [0, 25, 50, 75, 100];
const minWinRateStops = [40, 45, 50, 55];

function TraySetting({
  local,
  update,
  available,
}: {
  local: LocalState;
  update(value: LocalState): void;
  available: boolean;
}) {
  const [error, setError] = useState('');
  return (
    <>
      <label className={available ? undefined : 'disabled'}>
        <input
          type="checkbox"
          disabled={!available}
          checked={available && local.closeToTray !== false}
          onChange={(event) => {
            setError('');
            api.setCloseToTray!(event.target.checked).then(update, (e) => setError(errorMessage(e)));
          }}
        />
        Closing the window keeps Ancient Lens in the tray
      </label>
      <p className="fine-print">
        {available
          ? 'Match data and the rating reader keep working in the background. Quit from the tray icon menu.'
          : 'Unavailable: this desktop shows no tray icons, so closing the window quits the app.'}
      </p>
      {error && <Notice error>{error}</Notice>}
    </>
  );
}

function ReaderSettings({
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

function ProviderSettings({ changed }: { changed(): void }) {
  const [info, setInfo] = useState<ProviderInfo>();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    void api
      .getProvider()
      .then(setInfo)
      .catch((error) => setError(errorMessage(error)));
  }, []);
  async function save(value: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.setProviderToken(value);
      setInfo(result);
      setToken('');
      changed();
      setMessage(
        result.hasToken
          ? result.persistent
            ? 'Token saved with system encryption. Loading a match will verify STRATZ access.'
            : 'Token active until the app closes. Loading a match will verify STRATZ access.'
          : 'Using OpenDota. Token removed.',
      );
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (!info)
    return (
      <section className="panel provider-settings">
        <h2>Statistics provider</h2>
        <p>{error || 'Connecting…'}</p>
      </section>
    );
  async function disconnect() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.disconnectStratz!();
      setInfo(result);
      setMessage(result.message ?? '');
      changed();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  if (info.automatic) {
    const connectable = !!info.connectable && !!api.connectStratz;
    return (
      <section className="panel provider-settings">
        <h2>Player history · {info.source}</h2>
        <p className="muted">{info.status}</p>
        <p className="fine-print">
          {info.serviceConfigured
            ? 'Player statistics, personal history, and recommendations load from STRATZ.'
            : 'For faster roster loading and position recommendations, connect STRATZ with your own token.'}
        </p>
        {connectable && !info.serviceConfigured && (
          <StratzConnectForm
            connected={(result) => {
              setInfo(result);
              setMessage(result.message ?? '');
              changed();
            }}
          />
        )}
        {connectable && info.serviceConfigured && (
          <>
            <div className="button-row">
              <button type="button" className="secondary" disabled={busy} onClick={() => void disconnect()}>
                Disconnect STRATZ
              </button>
            </div>
            <p className="fine-print">
              Removes the saved token and stops the statistics service Ancient Lens started; OpenDota is used
              afterwards. To change the token, disconnect and connect again.
            </p>
          </>
        )}
        {!connectable && !info.serviceConfigured && (
          <p className="fine-print">
            This launch sets the statistics service with ANCIENT_STATS_URL. See docs/guide/stats-service.md.
          </p>
        )}
        <p className="fine-print">
          To run the service yourself, for example from a source build, follow docs/guide/stats-service.md. OpenDota
          profiles and local notes work without STRATZ.
        </p>
        {message && <Notice>{message}</Notice>}
        {error && <Notice error>{error}</Notice>}
      </section>
    );
  }
  return (
    <section className="panel provider-settings">
      <h2>Player history · {info?.source ?? 'Loading…'}</h2>
      <p className="muted">
        STRATZ loads the roster in batches of five players. Get your own API token from stratz.com/api. Without a token,
        OpenDota is used: requests respect its rate limits and rows appear gradually.
      </p>
      <form
        className="button-row"
        onSubmit={(event) => {
          event.preventDefault();
          void save(token);
        }}
      >
        <input
          type="password"
          aria-label="Your STRATZ API token"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={info?.hasToken ? 'New STRATZ token' : 'Your STRATZ API token'}
          autoComplete="off"
          spellCheck={false}
          maxLength={4096}
        />
        <button className="primary" disabled={busy || !token.trim()}>
          Connect STRATZ
        </button>
        <button type="button" className="secondary" disabled={busy || !info?.hasToken} onClick={() => void save('')}>
          Use OpenDota
        </button>
      </form>
      <p className="fine-print">
        The token is never shown again or included in exports. If the system keyring is unavailable, the token stays in
        memory until the app closes.
      </p>
      {message && <Notice>{message}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
