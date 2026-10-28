import type { Match, MmrEntry } from './domain';

export type MatchRating = { mmr: number; delta: number };

/** Ranked matchmaking lobby (STRATZ lobbyType RANKED). */
export const isRanked = (match: Pick<Match, 'lobby_type'>) => match.lobby_type === 7;

/**
 * MMR after a ranked match and its change. The match journal binds a rating change to the
 * match it recorded; otherwise consecutive measurements read from the game are used: a
 * change between two measurements belongs to a match only when exactly one ranked match
 * ended in between, and a change the journal already explains is not counted again.
 */
export function ratingByMatch(matches: Match[], entries: MmrEntry[]): Map<number, MatchRating> {
  const measured = entries
    .filter((entry) => entry.source === 'dota-memory')
    .map((entry) => ({ value: entry.value, at: Date.parse(entry.createdAt) / 1000 }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at);
  const ranked = matches
    .filter(isRanked)
    .map((match) => ({ id: match.match_id, end: match.start_time + match.duration }));
  const result = new Map<number, MatchRating>();
  for (const match of matches) {
    if (typeof match.mmr_after === 'number' && typeof match.mmr_delta === 'number')
      result.set(match.match_id, { mmr: match.mmr_after, delta: match.mmr_delta });
  }
  const journal = new Set(result.keys());
  for (let i = 1; i < measured.length; i++) {
    const [before, after] = [measured[i - 1]!, measured[i]!];
    const between = ranked.filter((match) => match.end > before.at && match.end <= after.at);
    if (between.length === 1 && !journal.has(between[0]!.id))
      result.set(between[0]!.id, { mmr: after.value, delta: after.value - before.value });
  }
  return result;
}
