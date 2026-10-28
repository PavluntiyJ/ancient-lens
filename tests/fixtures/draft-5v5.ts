import type { DraftData, HeroPair } from '../../src/shared/draft';
import type { Hero } from '../../src/shared/domain';

// Invented aggregates, not downloaded game/provider data. Expected scores below
// are hand-calculated; this fixture must not derive them through production code.
export const allies = [6, 7, 8, 9, 10];
export const enemies = [1, 2, 3, 4, 5];
export const heroes: Hero[] = Array.from({ length: 15 }, (_, i) => ({
  id: i + 1,
  localized_name: `Fixture ${i + 1}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: [],
}));
const pair = (from: number, to: number, synergy: number | null): HeroPair => ({
  heroId1: from,
  heroId2: to,
  synergy,
  matchCount: 1000,
  winCount: 500,
});
const position = (heroId: number, n: number, matchCount = 1000) => ({
  heroId,
  position: `POSITION_${n}`,
  week: 1,
  matchCount,
  winCount: matchCount / 2,
});
export const fixture: DraftData = {
  source: 'STRATZ',
  fetchedAt: '2026-10-13T00:00:00Z',
  rawPairs: true,
  positions: [
    position(6, 5),
    position(11, 1),
    position(11, 2),
    position(12, 5),
    position(13, 4),
    position(13, 5),
    position(14, 1),
    position(15, 1, 100),
  ],
  matchups: [
    ...enemies.map((id, i) => ({
      heroId: id,
      with: [],
      vs: [
        pair(id, 11, [-2, -4, -6, -8, -10][i]),
        pair(id, 12, -1),
        ...(i === 0 ? [pair(id, 13, -5)] : []),
        pair(id, 14, -20),
        pair(id, 15, -30),
        ...allies.map((ally) => pair(id, ally, -(ally - id - 1))),
      ],
    })),
    ...allies.map((id, i) => ({
      heroId: id,
      vs: enemies.map((enemy) => pair(id, enemy, id - enemy)),
      with: [pair(id, 11, [2, 4, 6, 8, 10][i]), pair(id, 12, 8)],
    })),
  ],
};
// 11: counter = 30/5 = 6; synergy = (1+2+3+4+5)/5 = 3; total = 9.
// 12: counter = 5/5 = 1; synergy = (4-100+4+4+4+4)/5 = -16; total = -15.
// 13: only one enemy pair; counter = 5/5 = 1; synergy = 0/5; total = 1.
export const expected = [
  { id: 11, counter: 6, synergy: 3, score: 9, coverage: 10, expected: 10 },
  { id: 12, counter: 1, synergy: -16, score: -15, coverage: 10, expected: 10 },
  { id: 13, counter: 1, synergy: 0, score: 1, coverage: 1, expected: 10 },
];
