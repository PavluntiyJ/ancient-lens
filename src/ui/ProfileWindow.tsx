import { useEffect, useState, type CSSProperties } from 'react';
import { UserRound, X } from 'lucide-react';
import { applyStateUpdate, type AppInfo, type LocalState, type OwnUpdate } from '../shared/domain';
import { defaultShortcuts } from '../shared/shortcuts';
import { api, errorMessage, Notice } from './App';
import { OwnProfile } from './OwnProfile';
import { useDisplaySettings } from './preferences';
import { ShortcutsProvider } from './shortcut-context';
import { TooltipLayer } from './Tooltip';
import { ResizeEdges, TitleBar, useFallbackShortcuts, useKeyboardOnDemand } from './WindowFrame';

/**
 * The profile window: the own profile alone, without the match header. It shares the stored
 * state with the match window through the same events; Settings stay in the match window.
 */
export function ProfileWindow() {
  const display = useDisplaySettings();
  useEffect(() => {
    void api.setWindowMinSize?.(display.scale).catch(() => {});
  }, [display.scale]);
  const [local, setLocal] = useState<LocalState>({ accountId: '', notes: [], mmr: [] });
  const updateLocal = (value: LocalState | OwnUpdate) => setLocal((current) => applyStateUpdate(current, value));
  const [info, setInfo] = useState<AppInfo>();
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [providerRevision, setProviderRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([api.getState(), api.getInfo()])
      .then(([state, appInfo]) => {
        if (!active) return;
        updateLocal(state);
        setInfo(appInfo);
        setReady(true);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    const unsubscribeState = api.onState?.((value) => {
      if (active) updateLocal(value);
    });
    // Connecting STRATZ in the match window changes where the history comes from.
    const unsubscribeProvider = api.onProvider?.(() => {
      if (active) setProviderRevision((value) => value + 1);
    });
    return () => {
      active = false;
      unsubscribeState?.();
      unsubscribeProvider?.();
    };
  }, []);
  const shortcuts = { ...defaultShortcuts, ...local.shortcuts };
  useFallbackShortcuts(info, shortcuts);
  useKeyboardOnDemand(info);
  return (
    <ShortcutsProvider value={shortcuts}>
      <div
        className={`app-shell profile-shell ${display.compact ? 'compact-rows' : ''}`}
        style={{ zoom: display.scale / 100, '--ui-scale': display.scale / 100 } as CSSProperties}
      >
        <TitleBar
          title={`Ancient Lens · ${info?.version ?? ''}`}
          brand={
            <>
              <UserRound size={17} />
              <b>My profile</b>
            </>
          }
          info={info}
          onError={setError}
        />
        <main>
          <div className="content">
            {error && (
              <Notice error>
                {error}
                <button className="notice-close" aria-label="Dismiss message" onClick={() => setError('')}>
                  <X size={16} />
                </button>
              </Notice>
            )}
            {!ready && !error && <Notice>Opening profile…</Notice>}
            {ready && <OwnProfile key={`${local.accountId}:${providerRevision}`} local={local} update={updateLocal} />}
          </div>
        </main>
      </div>
      <ResizeEdges onError={setError} />
      <TooltipLayer scale={display.scale / 100} />
    </ShortcutsProvider>
  );
}
