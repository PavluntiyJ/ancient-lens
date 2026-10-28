import { useSyncExternalStore } from 'react';
import { z } from 'zod';
import type { StatsFilter } from '../../shared/domain';
import { historySorts } from '../../shared/profile-history';
import { useStatsFilter } from '../preferences';

const storageKey = 'ancient-profile-view';

const viewSchema = z.object({
  days: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(0)]),
  hero: z.number().int().min(0),
  result: z.enum(['all', 'win', 'loss']),
  rankedOnly: z.boolean(),
  includeTurbo: z.boolean(),
  modes: z.enum(['match', 'all']),
  position: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  duration: z.enum(['all', 'short', 'medium', 'long']),
  timeOfDay: z.enum(['all', 'night', 'morning', 'afternoon', 'evening']),
  weekday: z.union([z.enum(['all', 'weekdays', 'weekend']), z.number().int().min(0).max(6)]),
  patch: z.string().max(40),
  columns: z.object({ xpm: z.boolean(), damage: z.boolean(), lhdn: z.boolean() }),
  sort: z.enum(historySorts),
  direction: z.enum(['asc', 'desc']),
});
/** Period, filters, columns and sort of the profile page, kept between visits. */
export type ProfileView = z.infer<typeof viewSchema>;

export function defaultProfileView(settings: StatsFilter): ProfileView {
  return {
    days: 30,
    hero: 0,
    result: 'all',
    rankedOnly: settings.rankedOnly,
    includeTurbo: settings.mode === 'all',
    modes: 'match',
    position: 0,
    duration: 'all',
    timeOfDay: 'all',
    weekday: 'all',
    patch: 'all',
    columns: { xpm: true, damage: true, lhdn: true },
    sort: 'date',
    direction: 'desc',
  };
}

/** A saved view, or the defaults when it is missing, unreadable or from another version. */
export function readProfileView(raw: string | null, settings: StatsFilter): ProfileView {
  try {
    const parsed = viewSchema.safeParse(JSON.parse(raw ?? 'null'));
    if (parsed.success) return parsed.data;
  } catch {
    /* Unreadable: defaults below. */
  }
  return defaultProfileView(settings);
}

function subscribe(callback: () => void) {
  window.addEventListener('profile-view', callback);
  return () => window.removeEventListener('profile-view', callback);
}
/** The last written view, used when storage is unavailable (private mode, blocked). */
let memory: string | null = null;
function stored(): string | null {
  try {
    return localStorage.getItem(storageKey) ?? memory;
  } catch {
    return memory;
  }
}

export function useProfileView(): [ProfileView, (change: Partial<ProfileView>) => void] {
  const settings = useStatsFilter();
  const raw = useSyncExternalStore(subscribe, stored);
  const view = readProfileView(raw, settings);
  const change = (next: Partial<ProfileView>) => {
    memory = JSON.stringify({ ...readProfileView(stored(), settings), ...next });
    try {
      localStorage.setItem(storageKey, memory);
    } catch {
      /* Storage unavailable: kept in memory for this session. */
    }
    window.dispatchEvent(new Event('profile-view'));
  };
  return [view, change];
}
