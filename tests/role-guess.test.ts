import { describe, expect, it } from 'vitest';
import { guessTeamRoles } from '../src/shared/role-guess';
import type { PositionStat } from '../src/shared/draft';

const history = (counts: number[]) =>
  counts.flatMap((count, index) => Array.from({ length: count }, () => ({ position: `POSITION_${index + 1}` })));
// Hero 1 is a carry, 2 a mid, 3 an offlaner, 4 a soft and 5 a hard support; 6 is flexible.
const heroPositions: PositionStat[] = [1, 2, 3, 4, 5].flatMap((heroId) =>
  [1, 2, 3, 4, 5].map((position) => ({
    heroId,
    position: `POSITION_${position}`,
    week: 1,
    matchCount: position === heroId ? 9000 : 250,
    winCount: 0,
  })),
);
heroPositions.push(
  ...[1, 2, 3, 4, 5].map((position) => ({
    heroId: 6,
    position: `POSITION_${position}`,
    week: 1,
    matchCount: 2000,
    winCount: 0,
  })),
);

describe('team role guess', () => {
  it('gives every player a different position from their history and hero', () => {
    const roles = guessTeamRoles(
      [
        { heroId: 5, matches: history([0, 0, 0, 2, 20]) },
        { heroId: 1, matches: history([18, 1, 0, 0, 0]) },
        { heroId: 2, matches: history([3, 15, 0, 0, 0]) },
        { heroId: 3, matches: history([0, 0, 12, 1, 0]) },
        { heroId: 4, matches: history([0, 0, 1, 14, 3]) },
      ],
      heroPositions,
    );
    expect(roles.map((role) => role?.position)).toEqual([5, 1, 2, 3, 4]);
    expect(roles.every((role) => role?.guessed)).toBe(true);
    expect(roles[0]).toMatchObject({ player: { games: 20, known: 22 } });
    expect(roles[0]!.hero!.share).toBeCloseTo(9000 / 10000);
  });
  it('lets the hero settle two players with the same history', () => {
    const roles = guessTeamRoles(
      [
        { heroId: 5, matches: history([10, 0, 0, 0, 0]) },
        { heroId: 1, matches: history([10, 0, 0, 0, 0]) },
      ],
      heroPositions,
    );
    expect(roles.map((role) => role?.position)).toEqual([5, 1]);
  });
  it('uses only the hero and the free positions for a private profile', () => {
    const roles = guessTeamRoles(
      [{ heroId: 1, matches: history([20, 0, 0, 0, 0]) }, { heroId: 1 }, { heroId: 6 }],
      heroPositions,
    );
    expect(roles[0]?.position).toBe(1);
    expect(roles[1]?.position).not.toBe(1);
    expect(roles[1]?.player).toBeUndefined();
  });
  it('keeps a lane chosen in the draft as known and out of the others’ reach', () => {
    const roles = guessTeamRoles(
      [
        { heroId: 1, matches: history([20, 0, 0, 0, 0]), lanes: [3] },
        { heroId: 1, matches: history([0, 0, 20, 0, 0]) },
      ],
      heroPositions,
    );
    expect(roles[0]).toMatchObject({ position: 3, guessed: false });
    expect(roles[1]?.position).not.toBe(3);
    expect(roles[1]?.guessed).toBe(true);
  });
  it('picks among several chosen lanes and leaves a player without data unknown', () => {
    const roles = guessTeamRoles(
      [{ heroId: 6, matches: history([1, 0, 0, 3, 9]), lanes: [1, 4] }, {}, { heroId: 999 }],
      heroPositions,
    );
    expect(roles[0]).toMatchObject({ position: 4, guessed: true });
    expect(roles[1]).toBeUndefined();
    expect(roles[2]).toBeUndefined();
  });
  it('still guesses the others when a player has no lane left', () => {
    const roles = guessTeamRoles(
      [
        { heroId: 1, lanes: [1] },
        { heroId: 2, lanes: [2] },
        { heroId: 6, lanes: [1, 2] },
        { heroId: 5, matches: history([0, 0, 0, 0, 9]) },
      ],
      heroPositions,
    );
    expect(roles[2]).toBeUndefined();
    expect(roles[3]?.position).toBe(5);
  });
});
