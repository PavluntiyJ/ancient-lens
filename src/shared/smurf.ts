import type { PlayerSummary } from './domain';

type Player = Pick<PlayerSummary, 'accountId' | 'total'> & { isPublic?: boolean };
export const smurfExplanation =
  'High win rate with few matches compared with other players in this match. This is a heuristic, not proof.';

export function medianMatches(players: Player[]): number {
  const matches = players
    .filter(
      (player) => player.isPublic === true && Number.isSafeInteger(player.total?.games) && player.total!.games > 0,
    )
    .map((player) => player.total!.games)
    .sort((a, b) => a - b);
  const n = matches.length;
  // The upper median: the element above the middle, for odd counts as well.
  return n <= 1 ? 0 : (matches[Math.floor(n / 2) + (n % 2)] ?? 0);
}

export function isSmurf(player: Player, ownAccountId: string, median: number): boolean {
  const total = player.total;
  return (
    player.isPublic === true &&
    player.accountId !== ownAccountId &&
    Number.isFinite(median) &&
    median > 0 &&
    !!total &&
    Number.isSafeInteger(total.games) &&
    total.games > 0 &&
    Number.isSafeInteger(total.wins) &&
    total.wins >= 0 &&
    total.wins <= total.games &&
    (total.wins / total.games) * 100 >= 56 &&
    total.games <= 1500 &&
    total.games / median <= 0.325
  );
}
