import type { Match } from './domain';
import type { PositionStat } from './draft';
import { summarizePositions, type Position } from './roles';

export type RoleSlot = {
  heroId?: number;
  /** The player's matches in the selected period; absent for a private profile. */
  matches?: Pick<Match, 'position' | 'role' | 'queue_position'>[];
  /** Lanes the player selected in the draft, when the game reports them. */
  lanes?: Position[];
};
export type RoleGuess = {
  position: Position;
  /** False only for a single lane selected in the draft. */
  guessed: boolean;
  /** The player's games in this position among games with a known position. */
  player?: { games: number; known: number };
  /** Share of the hero's games (all ranks) played in this position. */
  hero?: { share: number };
};

const positions = [1, 2, 3, 4, 5] as const;

// One position per player of a team, over positions 1-5:
// the assignment maximises the product of the player's and the hero's position shares
// (add-one smoothed, so one sparse source never vetoes a position).
export function guessTeamRoles(slots: RoleSlot[], heroPositions: PositionStat[]): (RoleGuess | undefined)[] {
  const result: (RoleGuess | undefined)[] = slots.map(() => undefined);
  const facts = slots.map((slot) => {
    const history = slot.matches ? summarizePositions(slot.matches) : undefined;
    const rows = heroPositions.filter((row) => row.heroId === slot.heroId && /^POSITION_[1-5]$/.test(row.position));
    const heroGames = (position: Position) =>
      rows.filter((row) => row.position === `POSITION_${position}`).reduce((sum, row) => sum + row.matchCount, 0);
    const heroTotal = positions.reduce((sum, position) => sum + heroGames(position), 0);
    const describe = (position: Position, guessed: boolean): RoleGuess => ({
      position,
      guessed,
      ...(history?.known ? { player: { games: history.counts[position], known: history.known } } : {}),
      ...(heroTotal ? { hero: { share: heroGames(position) / heroTotal } } : {}),
    });
    const score = (position: Position) => {
      if (slot.lanes && slot.lanes.length > 1 && !slot.lanes.includes(position)) return -Infinity;
      const player = history?.known ? (history.counts[position] + 1) / (history.known + 5) : 0.2;
      const hero = heroTotal ? (heroGames(position) + 1) / (heroTotal + 5) : 0.2;
      return Math.log(player) + Math.log(hero);
    };
    const informative = !!history?.known || !!heroTotal || (slot.lanes?.length ?? 0) > 1;
    return { slot, describe, score, informative };
  });
  const taken = new Set<Position>();
  facts.forEach(({ slot, describe }, index) => {
    const lane = slot.lanes?.length === 1 ? slot.lanes[0] : undefined;
    if (!lane) return;
    result[index] = describe(lane, false);
    taken.add(lane);
  });
  const open = facts.flatMap((fact, index) => (fact.informative && !result[index] ? [index] : []));
  let best: { total: number; picks: (Position | undefined)[] } = { total: -Infinity, picks: [] };
  const search = (depth: number, total: number, picks: (Position | undefined)[]) => {
    if (depth === open.length) {
      if (total > best.total) best = { total, picks: [...picks] };
      return;
    }
    // Fixed lanes may leave a player no possible position; that player stays unknown.
    const free = positions.filter(
      (position) => !taken.has(position) && facts[open[depth]!]!.score(position) > -Infinity,
    );
    if (!free.length) return search(depth + 1, total, [...picks, undefined]);
    for (const position of free) {
      taken.add(position);
      search(depth + 1, total + facts[open[depth]!]!.score(position), [...picks, position]);
      taken.delete(position);
    }
  };
  search(0, 0, []);
  best.picks.forEach((position, depth) => {
    if (position) result[open[depth]!] = facts[open[depth]!]!.describe(position, true);
  });
  return result;
}
