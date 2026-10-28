import type { PlayerSummary } from './domain';

export type PeriodStatus =
  | { kind: 'games'; partial: boolean }
  | { kind: 'private'; lastMatchAt?: number }
  | { kind: 'idle'; days: number; lastMatchAt?: number }
  | { kind: 'unknown'; days: number };

/**
 * What an empty or non-empty period means. STRATZ reports privacy explicitly (isAnonymous);
 * a private profile may still expose some matches, so its counts are a lower bound and an
 * empty period says nothing about activity. OpenDota does not report privacy at all.
 */
export function periodStatus(
  summary: Pick<PlayerSummary, 'isPublic' | 'days' | 'lastMatchAt'>,
  periodGames: number,
): PeriodStatus {
  const last = summary.lastMatchAt ?? undefined;
  if (periodGames > 0) return { kind: 'games', partial: summary.isPublic === false };
  if (summary.isPublic === false)
    return last === undefined ? { kind: 'private' } : { kind: 'private', lastMatchAt: last };
  if (summary.isPublic === true)
    return last === undefined
      ? { kind: 'idle', days: summary.days }
      : { kind: 'idle', days: summary.days, lastMatchAt: last };
  return { kind: 'unknown', days: summary.days };
}
