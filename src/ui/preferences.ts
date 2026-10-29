import { useSyncExternalStore } from 'react';
import type { StatsFilter } from '../shared/domain';
import { MIN_WIN_RATE } from '../shared/draft';
import { rankBrackets, type BracketSetting } from '../shared/rank-bracket';

const key = 'ancient-include-turbo';
const rankedKey = 'ancient-ranked-only';
// One object per combination keeps useSyncExternalStore snapshots stable.
const filters: Record<string, StatsFilter> = {
  'normal-false': { mode: 'normal', rankedOnly: false },
  'all-false': { mode: 'all', rankedOnly: false },
  'normal-true': { mode: 'normal', rankedOnly: true },
  'all-true': { mode: 'all', rankedOnly: true },
};
function subscribe(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('stats-preferences', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('stats-preferences', callback);
  };
}
export function useStatsFilter() {
  return useSyncExternalStore(
    subscribe,
    () =>
      filters[
        `${localStorage.getItem(key) === 'true' ? 'all' : 'normal'}-${localStorage.getItem(rankedKey) === 'true'}`
      ]!,
  );
}
/** Roster statistics from ranked matchmaking only (lobby 7); public unranked games are left out. */
export function setRankedOnly(ranked: boolean) {
  localStorage.setItem(rankedKey, String(ranked));
  window.dispatchEvent(new Event('stats-preferences'));
}
export function setIncludeTurbo(include: boolean) {
  localStorage.setItem(key, String(include));
  window.dispatchEvent(new Event('stats-preferences'));
}

export function useSynergyWeight() {
  return useSyncExternalStore(subscribe, () => {
    const saved = localStorage.getItem('ancient-synergy-weight');
    const value = saved === null ? 50 : Number(saved);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 50;
  });
}
export function setSynergyWeight(weight: number) {
  localStorage.setItem('ancient-synergy-weight', String(Math.max(0, Math.min(100, weight))));
  window.dispatchEvent(new Event('stats-preferences'));
}

const rankBracketKey = 'ancient-rank-bracket';
const bracketSettings: BracketSetting[] = ['auto', 'ALL', ...rankBrackets.map((bracket) => bracket.id)];
/** Rank bracket for hero statistics (matchups, recommendations, meta): automatic by default. */
export function useRankBracket(): BracketSetting {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(rankBracketKey));
  return bracketSettings.find((value) => value === raw) ?? 'auto';
}
export function setRankBracket(setting: BracketSetting) {
  localStorage.setItem(rankBracketKey, setting);
  window.dispatchEvent(new Event('stats-preferences'));
}

const encounterSoundKey = 'ancient-encounter-sound';
/** A chime when a player with a note is in the match: on by default. */
export function useEncounterSound() {
  return useSyncExternalStore(subscribe, () => localStorage.getItem(encounterSoundKey) !== 'off');
}
export function setEncounterSound(enabled: boolean) {
  localStorage.setItem(encounterSoundKey, enabled ? 'on' : 'off');
  window.dispatchEvent(new Event('stats-preferences'));
}
const encounterVolumeKey = 'ancient-encounter-volume';
/** Chime volume in percent, 80 by default. */
export function encounterVolume() {
  const saved = localStorage.getItem(encounterVolumeKey);
  const value = saved === null ? 80 : Number(saved);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 80;
}
export function useEncounterVolume() {
  return useSyncExternalStore(subscribe, encounterVolume);
}
export function setEncounterVolume(volume: number) {
  localStorage.setItem(encounterVolumeKey, String(Math.max(0, Math.min(100, Math.round(volume)))));
  window.dispatchEvent(new Event('stats-preferences'));
}

export type MinWinRate = { enabled: boolean; value: number };
const minWinRateKey = 'ancient-min-win-rate';
const minWinRates = new Map<string, MinWinRate>();
/** Optional minimum position win rate for pick suggestions: off by default, 50% (reference). */
export function useMinWinRate(): MinWinRate {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(minWinRateKey) ?? '');
  let setting = minWinRates.get(raw);
  if (!setting) {
    const [enabled, saved] = raw.split(':');
    const value = Number(saved);
    setting = {
      enabled: enabled === 'on',
      value:
        Number.isInteger(value) && value >= MIN_WIN_RATE.min && value <= MIN_WIN_RATE.max
          ? value
          : MIN_WIN_RATE.initial,
    };
    minWinRates.set(raw, setting);
  }
  return setting;
}
export function setMinWinRate(setting: MinWinRate) {
  const value = Math.round(Math.max(MIN_WIN_RATE.min, Math.min(MIN_WIN_RATE.max, setting.value)));
  localStorage.setItem(minWinRateKey, `${setting.enabled ? 'on' : 'off'}:${value}`);
  window.dispatchEvent(new Event('stats-preferences'));
}

export type DisplaySettings = { scale: number; compact: boolean; rank: boolean; totals: boolean; frequent: boolean };
export const displayScales = [80, 90, 100, 110, 120] as const;
export const defaultDisplay: DisplaySettings = { scale: 100, compact: false, rank: true, totals: true, frequent: true };
function readDisplay(raw: string | null): DisplaySettings {
  try {
    const saved = JSON.parse(raw ?? '{}');
    return {
      scale: displayScales.includes(saved.scale) ? saved.scale : 100,
      ...Object.fromEntries(
        ['compact', 'rank', 'totals', 'frequent'].map((key) => [
          key,
          typeof saved[key] === 'boolean' ? saved[key] : defaultDisplay[key as keyof DisplaySettings],
        ]),
      ),
    } as DisplaySettings;
  } catch {
    return defaultDisplay;
  }
}
export function useDisplaySettings(): DisplaySettings {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem('ancient-display'));
  return readDisplay(raw);
}
export function setDisplaySettings(change: Partial<DisplaySettings>) {
  localStorage.setItem(
    'ancient-display',
    JSON.stringify({ ...readDisplay(localStorage.getItem('ancient-display')), ...change }),
  );
  window.dispatchEvent(new Event('stats-preferences'));
}
