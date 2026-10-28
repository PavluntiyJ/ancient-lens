import { matchWon, type Match, type Participant } from './domain';

export type Side = { games: number; wins: number };
export type Meeting = { match: Match; ally: boolean; won: boolean | null; player: Participant };
export type Meetings = {
  ally: Side;
  enemy: Side;
  /** Every earlier match together, newest first, with the outcome for the own account. */
  games: Meeting[];
};

/**
 * Earlier matches of the own account with another player, from the own history: STRATZ
 * participants and the local match journal. Wins are the own account's. Matches without
 * participant lists (OpenDota, older cache) cannot show a meeting, so none means "none
 * seen in the loaded history", not "never met". The current match is left out.
 */
export function meetings(history: Match[], accountId: string, currentMatchId?: string): Meetings | null {
  const id = Number(accountId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const result: Meetings = { ally: { games: 0, wins: 0 }, enemy: { games: 0, wins: 0 }, games: [] };
  for (const match of history) {
    if (String(match.match_id) === currentMatchId) continue;
    const asAlly = match.allies?.find((player) => player.id === id);
    const player = asAlly ?? match.enemies?.find((player) => player.id === id);
    if (!player) continue;
    const ally = !!asAlly;
    const side = ally ? result.ally : result.enemy;
    const won = matchWon(match);
    side.games++;
    if (won) side.wins++;
    result.games.push({ match, ally, won, player });
  }
  result.games.sort((a, b) => b.match.start_time - a.match.start_time || b.match.match_id - a.match.match_id);
  return result.games.length ? result : null;
}
