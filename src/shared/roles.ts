import type { Match } from './domain';

export type Position = 1 | 2 | 3 | 4 | 5;
export const rankedRoles = [
  { id: 1, name: 'Safe Lane', title: 'Carry · position 1' },
  { id: 2, name: 'Mid Lane', title: 'Mid · position 2' },
  { id: 3, name: 'Off Lane', title: 'Offlane · position 3' },
  { id: 4, name: 'Soft Support', title: 'Soft support · position 4' },
  { id: 5, name: 'Hard Support', title: 'Hard support · position 5' },
] as const;

export function matchPosition(match: Pick<Match, 'position' | 'role' | 'queue_position'>): Position | undefined {
  const position = rankedRoles.find((role) => match.position === `POSITION_${role.id}`)?.id;
  if (position) return position;
  // STRATZ distinguishes the two supports even when position is unavailable.
  if (match.role === 'LIGHT_SUPPORT') return 4;
  if (match.role === 'HARD_SUPPORT') return 5;
  return rankedRoles.find((role) => role.id === match.queue_position)?.id;
}

export function summarizePositions(matches: Pick<Match, 'position' | 'role' | 'queue_position'>[]) {
  const counts: Record<Position, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unknown = 0;
  for (const match of matches) {
    const position = matchPosition(match);
    if (position) counts[position]++;
    else unknown++;
  }
  return { counts, unknown, known: matches.length - unknown };
}

/** Most played position and its share among matches with a known position. */
export function mainPosition(matches: Pick<Match, 'position' | 'role' | 'queue_position'>[]) {
  const { counts, known } = summarizePositions(matches);
  if (!known) return undefined;
  const [position, games] = rankedRoles
    .map((role) => [role.id, counts[role.id]] as const)
    .reduce((best, item) => (item[1] > best[1] ? item : best));
  return { position, games, known, share: games / known };
}

// SteamTracking/Protobufs: dota2/dota_gcmessages_common_match_management.proto,
// ELaneSelectionFlags (Safe=1, Off=2, Mid=4, Support=8, HardSupport=16).
export function draftLanePositions(flags: number): Position[] {
  if (!Number.isInteger(flags) || flags <= 0 || flags > 31) return [];
  const bits = { 1: 1, 2: 4, 3: 2, 4: 8, 5: 16 };
  return rankedRoles.filter((role) => flags & bits[role.id]).map((role) => role.id);
}
