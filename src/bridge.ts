import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  draftInputSchema,
  normalizeLive,
  scoreDraft,
  type DesktopApi,
  type LiveState,
  type LocalState,
  type OwnUpdate,
  type ReleaseInfo,
  type Hero,
  type MatchupRow,
} from './shared/domain';

// The typed interface between React and the Tauri commands.
// No Node runtime or sidecar is part of the application.
if (isTauri()) {
  async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
    try {
      return await invoke<T>('desktop_call', { command, args });
    } catch (error) {
      throw new Error(typeof error === 'string' ? error : String(error));
    }
  }
  const native: DesktopApi = {
    windowName: getCurrentWindow().label === 'profile' ? 'profile' : 'main',
    setKeyboard: (on) => call('window:keyboard', { on }),
    showWindow: (window) => call('window:show', { window }),
    onProvider: (callback) => {
      let disposed = false;
      const pending = listen('provider:update', () => {
        if (!disposed) callback();
      });
      return () => {
        disposed = true;
        void pending.then((unlisten) => unlisten()).catch(() => {});
      };
    },
    resizeWindow: (edge) => call('window:resize', { edge }),
    windowAction: (action) => call('window:action', { action }),
    setWindowMinSize: (scale) => call('window:min-size', { scale }),
    getState: () => call('state:get'),
    getInfo: () => call('app:info'),
    onState: (callback) => {
      let disposed = false;
      const pending = Promise.all([
        listen<LocalState>('state:update', (event) => {
          if (!disposed) callback(event.payload);
        }),
        listen<OwnUpdate>('own:update', (event) => {
          if (!disposed) callback(event.payload);
        }),
      ]);
      // Refresh after registration to cover the initial get/listen race.
      void pending
        .then(() => call<LocalState>('state:get'))
        .then((value) => {
          if (!disposed) callback(value);
        })
        .catch(() => {});
      return () => {
        disposed = true;
        void pending.then((unlisten) => unlisten.forEach((stop) => stop())).catch(() => {});
      };
    },
    setNativeRosterReader: (value) => call('state:reader', { value }),
    setCloseToTray: (value) => call('state:tray', { value }),
    setUpdateCheck: (value) => call('state:update-check', { value }),
    skipVersion: (version) => call('state:skip-version', { version }),
    getRelease: () => call('release:get'),
    onRelease: (callback) => {
      let disposed = false;
      const pending = listen<ReleaseInfo>('release:update', (event) => {
        if (!disposed) callback(event.payload);
      });
      return () => {
        disposed = true;
        void pending.then((unlisten) => unlisten()).catch(() => {});
      };
    },
    openRelease: () => call('release:open'),
    setShortcuts: (shortcuts) => call('state:shortcuts', { shortcuts }),
    setAccount: (id) => call('state:account', { id }),
    getPlayer: (id) => call('player:get', { id }),
    setMedalRank: (matchId, tier) => call('journal:medal', { matchId, tier }),
    openPlayerSite: (id, site) => call('player:site', { id, site }),
    openMatchSite: (id, site) => call('match:site', { id, site }),
    getHistory: (id, offset = 0, cachedOnly = false, refresh = false) =>
      call('history:get', { id, offset, cachedOnly, refresh }),
    getHeroes: () => call('heroes:get'),
    getPatches: () => call('patches:get'),
    getCountry: (id) => call('country:get', { id }),
    getTotals: (id) => call('totals:get', { id }),
    getDraftData: (ids, bracket = 'ALL') => call('draft:data', { ids, bracket }),
    getHeroAverages: (ids, bracket) => call('averages:get', { ids, bracket }),
    getDraft: async (raw) => {
      const input = draftInputSchema.parse(raw);
      const heroes = await call<Hero[]>('heroes:get');
      if ([...input.allies, ...input.enemies, ...input.bans].some((id) => !heroes.some((h) => h.id === id)))
        throw new Error('Unknown hero.');
      const rows = await call<MatchupRow[]>('matchups:get', { ids: input.enemies });
      return {
        suggestions: scoreDraft(
          heroes,
          rows.map((row) => row.opponents),
          input,
        ),
        fetchedAt: new Date().toISOString(),
      };
    },
    getMatchups: (ids) => call('matchups:get', { ids }),
    getPeriodStats: (id, days = 30) => call('period:get', { id, days }),
    getSummary: (id, days, filter) => call('summary:get', { id, days, ...(filter ? { filter } : {}) }),
    getProvider: () => call('provider:get'),
    setProviderToken: (token) => call('provider:token', { token }),
    connectStratz: (token) => call('provider:connect', { token }),
    disconnectStratz: () => call('provider:disconnect'),
    openStratzTokens: () => call('stratz:tokens'),
    saveNote: (note) => call('note:save', { note }),
    deleteNote: (id) => call('note:delete', { id }),
    addMmr: (value, expectedAccountId) => call('mmr:add', { value, expectedAccountId }),
    deleteMmr: (id) => call('mmr:delete', { id }),
    getLive: () => call<LiveState>('live:get').then(normalizeLive),
    exportGsi: () => call('gsi:export'),
    getSteamSetup: () => call('steam:status'),
    repairSteamSetup: (launch) => call('steam:repair', { launch }),
    exportData: () => call('data:export'),
    toggleWindow: (window = 'main') => call('window:toggle', { window }),
    onLive: (callback) => {
      let disposed = false;
      const pending = listen<LiveState>('live:update', (event) => {
        if (!disposed) callback(normalizeLive(event.payload));
      });
      void pending.catch((error) => {
        if (!disposed) callback({ status: 'error', receivedAt: null, error: String(error) });
      });
      return () => {
        disposed = true;
        void pending.then((unlisten) => unlisten()).catch(() => {});
      };
    },
  };
  window.ancient = native;
}
