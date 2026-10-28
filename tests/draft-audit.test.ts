import { expect, it } from 'vitest';
import { MIN_PAIR_GAMES, laneSuggestions, matchupAdvantage, meanAdvantage, scorePositions } from '../src/shared/draft';
import { allies, enemies, expected, fixture, heroes } from './fixtures/draft-5v5';

it('explains every candidate score in a fixed 5v5, including missing pairs and role conflict', () => {
  const rows = scorePositions(heroes, fixture, allies, enemies, [14]);
  expect(rows[1].map((row) => row.hero.id)).toEqual([11]);
  expect(rows[2].map((row) => row.hero.id)).toEqual([11]);
  expect(rows[3]).toEqual([]);
  expect(rows[4].map((row) => row.hero.id)).toEqual([13]);
  expect(rows[5].map((row) => row.hero.id)).toEqual([13, 12]);
  const unique = laneSuggestions(rows, [1, 2, 3, 4, 5]);
  expect(unique.map((row) => row.hero.id)).toEqual([11, 13, 12]);
  for (const { id, ...calculated } of expected) {
    expect(unique.find((row) => row.hero.id === id)).toMatchObject({ ...calculated, base: 50, games: 1000 });
  }
  const noSynergy = scorePositions(heroes, fixture, allies, enemies, [14], 0);
  expect(noSynergy[5].find((row) => row.hero.id === 12)).toMatchObject({
    score: 1,
    counter: 1,
    synergy: 0,
    expected: 5,
    coverage: 5,
  });
});

it('explains all 25 bidirectional matrix cells and preserves the Radiant sign', () => {
  const matrix = allies.map((r) => enemies.map((d) => matchupAdvantage(fixture, r, d)));
  expect(matrix).toEqual([
    [4.5, 3.5, 2.5, 1.5, 0.5],
    [5.5, 4.5, 3.5, 2.5, 1.5],
    [6.5, 5.5, 4.5, 3.5, 2.5],
    [7.5, 6.5, 5.5, 4.5, 3.5],
    [8.5, 7.5, 6.5, 5.5, 4.5],
  ]);
  expect(meanAdvantage(matrix.flat())).toBe(4.5);
  expect(matchupAdvantage(fixture, 1, 6)).toBe(-4.5);
});

it('applies the position share boundary independently of sample size and winrate', () => {
  const data = structuredClone(fixture);
  const first = data.positions.find((row) => row.heroId === 11 && row.position === 'POSITION_1')!;
  const second = data.positions.find((row) => row.heroId === 11 && row.position === 'POSITION_2')!;
  // A main position needs 20% of the hero's games, as in Meta picks.
  Object.assign(first, { matchCount: 999, winCount: 500 });
  Object.assign(second, { matchCount: 4001, winCount: 2000 });
  expect(scorePositions(heroes, data, allies, enemies, [14])[1]).toEqual([]);
  Object.assign(first, { matchCount: 1000, winCount: 500 });
  Object.assign(second, { matchCount: 4000, winCount: 2000 });
  expect(scorePositions(heroes, data, allies, enemies, [14])[1].map((row) => row.hero.id)).toEqual([11]);
});

it('does not turn null, sentinel or low-sample evidence into a known zero', () => {
  for (const change of [{ synergy: null }, { synergy: 666 }, { matchCount: MIN_PAIR_GAMES - 1, winCount: 10 }]) {
    const data = structuredClone(fixture);
    Object.assign(
      data.matchups[0].vs.find((pair) => pair.heroId2 === 13)!,
      change,
    );
    const row = scorePositions(heroes, data, allies, enemies, [14])[4];
    expect(row).toEqual([]);
    Object.assign(
      data.matchups[0].vs.find((pair) => pair.heroId2 === 6)!,
      change,
    );
    expect(matchupAdvantage(data, 6, 1)).toBeUndefined();
  }
});

it('keeps known scores and unknown matrix cells when a picked hero row is absent', () => {
  const data = structuredClone(fixture);
  data.matchups = data.matchups.filter((row) => row.heroId !== 1);
  for (const ally of allies) expect(matchupAdvantage(data, ally, 1)).toBeUndefined();
  expect(matchupAdvantage(data, 6, 2)).toBe(3.5);
  const rows = scorePositions(heroes, data, allies, enemies, [14]);
  expect(rows[1].map((row) => row.hero.id)).toEqual([11]);
  expect(rows[1][0]).toMatchObject({ coverage: 9, expected: 10, synergy: 3 });
  expect(rows[1][0].counter).toBeCloseTo(5.6);
  expect(rows[1][0].score).toBeCloseTo(8.6);
  expect(rows[4]).toEqual([]);
  expect(rows[5].map((row) => row.hero.id)).toEqual([12]);
});
