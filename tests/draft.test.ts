import { describe, expect, it } from 'vitest';
import {
  MIN_PAIR_GAMES,
  PAIR_SHRINKAGE,
  draftWarmBatches,
  matchupAdvantage,
  pairAdvantage,
  scorePositions,
  mergeDraft,
  missingDraftIds,
  type DraftData,
} from '../src/shared/draft';
import { winRateClass, winRateTone, type Hero } from '../src/shared/domain';
const heroes: Hero[] = [1, 2, 3, 4].map((id) => ({
  id,
  localized_name: `Hero ${id}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: ['Carry'],
}));
// Formula tests use provider pairs as-is; shrinkage has its own test below.
const data: DraftData = {
  source: 'STRATZ',
  fetchedAt: new Date().toISOString(),
  rawPairs: true,
  positions: [3, 4].flatMap((heroId) => [
    { heroId, position: 'POSITION_5', week: 1, matchCount: 1000, winCount: 500 },
    { heroId, position: 'POSITION_1', week: 1, matchCount: 10, winCount: 9 },
  ]),
  matchups: [
    {
      heroId: 1,
      vs: [3, 4].map((heroId2) => ({
        heroId1: 1,
        heroId2,
        matchCount: 1000,
        winCount: 500,
        synergy: heroId2 === 3 ? -3 : 0,
      })),
      with: [],
    },
    {
      heroId: 2,
      vs: [],
      with: [3, 4].map((heroId2) => ({
        heroId1: 2,
        heroId2,
        matchCount: 1000,
        winCount: 500,
        synergy: heroId2 === 4 ? 8 : 0,
      })),
    },
  ],
};
describe('position recommendations', () => {
  it('uses actual positions, inverts enemy advantage, and lets ally synergy change the order', () => {
    const alone = scorePositions(heroes, data, [], [1]);
    expect(alone[5][0].hero.id).toBe(3);
    expect(alone[5][0].counter).toBeGreaterThan(0);
    const withAlly = scorePositions(heroes, data, [2], [1]);
    expect(withAlly[5][0].hero.id).toBe(4);
    expect(withAlly[5][0].synergy).toBeGreaterThan(0);
    expect(withAlly[1]).toEqual([]);
  });
  it('excludes picked/banned heroes and does not invent missing enemy data', () => {
    expect(scorePositions(heroes, data, [2, 4], [1], [3])[5]).toEqual([]);
    expect(scorePositions(heroes, { ...data, matchups: [] }, [2], [1])[5]).toEqual([]);
  });
  it('rejects malformed pairs and low sample sizes', () => {
    const bad = structuredClone(data);
    bad.matchups[0].vs.forEach((row) => {
      row.winCount = row.matchCount + 1;
    });
    expect(scorePositions(heroes, bad, [], [1])[5]).toEqual([]);
  });
});
it('colours the displayed win rate rather than making every value green', () => {
  expect(winRateClass(49, 100)).toBe('negative');
  expect(winRateClass(50, 100)).toBe('neutral');
  expect(winRateClass(51, 100)).toBe('positive');
  expect(winRateClass(0, 0)).toBe('neutral');
  expect(winRateClass(501, 1000)).toBe('neutral');
});

it('weights synergy without adding win rate or shrinking each pair', () => {
  const input = structuredClone(data);
  input.positions.find((row) => row.heroId === 3 && row.position === 'POSITION_5')!.winCount = 900;
  const rows = scorePositions(heroes, input, [2], [1])[5];
  expect(rows.find((row) => row.hero.id === 3)?.score).toBe(3);
  expect(rows.find((row) => row.hero.id === 4)?.score).toBe(4);
  expect(rows[0].hero.id).toBe(4);
  expect(scorePositions(heroes, input, [2], [1], [], 0)[5][0].hero.id).toBe(3);
});
it('keeps missing pairs in the team divisor and penalizes a sole shared role', () => {
  expect(scorePositions(heroes, data, [], [1, 2])[5][0].score).toBe(1.5);
  const input = structuredClone(data);
  input.positions.push({ heroId: 2, position: 'POSITION_5', week: 1, matchCount: 1000, winCount: 500 });
  expect(scorePositions(heroes, input, [2], [1])[5].find((row) => row.hero.id === 4)?.synergy).toBe(-96);
});

it('deduplicates flexible heroes and pages the twelve strongest candidates per category', async () => {
  const { laneSuggestions, draftLanes } = await import('../src/shared/draft');
  const sample = scorePositions(heroes, data, [2], [1])[5][0];
  const many = Array.from({ length: 15 }, (_, index) => ({
    ...sample,
    hero: { ...sample.hero, id: index + 10 },
    score: 20 - index,
  }));
  const rows = { 1: many, 2: [{ ...many[0], score: 30 }], 3: [], 4: [], 5: [sample] };
  const core = laneSuggestions(rows, draftLanes[0].core);
  expect(core).toHaveLength(12);
  expect(new Set(core.map((row) => row.hero.id)).size).toBe(12);
  expect(core[0].score).toBe(30);
  expect(core.slice(6).map((row) => row.hero.id)).toEqual([16, 17, 18, 19, 20, 21]);
  expect(laneSuggestions(rows, draftLanes[1].support)).toEqual([sample]);
  expect(laneSuggestions(rows, draftLanes[3].support)).toEqual([]);
});

it('keeps only candidates above the minimum position win rate, before paging', async () => {
  const { laneSuggestions } = await import('../src/shared/draft');
  const sample = scorePositions(heroes, data, [2], [1])[5][0];
  const row = (id: number, score: number, base: number) => ({ ...sample, hero: { ...sample.hero, id }, score, base });
  // Hero 10 is flexible: its stronger position 1 row is below the threshold, position 5 is not.
  const rows = {
    1: [row(10, 9, 47), row(11, 8, 50), row(12, 7, 50.01)],
    2: [],
    3: [],
    4: [],
    5: [row(10, 6, 53)],
  };
  expect(laneSuggestions(rows, [1, 5]).map((item) => [item.hero.id, item.score])).toEqual([
    [10, 9],
    [11, 8],
    [12, 7],
  ]);
  expect(laneSuggestions(rows, [1, 5], 50).map((item) => [item.hero.id, item.score])).toEqual([
    [12, 7],
    [10, 6],
  ]);
});

it('uses bidirectional advantage, preserves team signs, and never substitutes raw win rate', async () => {
  const { matchupAdvantage, meanAdvantage, sumAdvantage, advantageTone } = await import('../src/shared/draft');
  const input = structuredClone(data);
  input.matchups = [
    { heroId: 1, with: [], vs: [{ heroId1: 1, heroId2: 2, matchCount: 1000, winCount: 750, synergy: 5 }] },
    { heroId: 2, with: [], vs: [{ heroId1: 2, heroId2: 1, matchCount: 1000, winCount: 250, synergy: -3 }] },
  ];
  expect(matchupAdvantage(input, 1, 2)).toBe(4);
  expect(matchupAdvantage(input, 2, 1)).toBe(-4);
  expect(matchupAdvantage(input, 1, 3)).toBeUndefined();
  expect(meanAdvantage([4, undefined, -2])).toBe(1);
  expect(meanAdvantage([undefined])).toBeUndefined();
  expect(sumAdvantage([4, undefined, -2.5])).toBe(1.5);
  expect(sumAdvantage([undefined])).toBeUndefined();
  expect(advantageTone(1.4).tone).toBe('neutral');
  expect(advantageTone(1.5).tone).toBe('radiant');
  expect(advantageTone(-4).tone).toBe('dire');
  expect(advantageTone(-6).intensity).toBeGreaterThan(advantageTone(-2).intensity);
  input.matchups[1].vs[0].synergy = 666;
  expect(matchupAdvantage(input, 1, 2)).toBeUndefined();
  input.matchups[1].vs[0].synergy = -3;
  input.matchups[1].vs[0].matchCount = MIN_PAIR_GAMES - 1;
  expect(matchupAdvantage(input, 1, 2)).toBeUndefined();
});

it('win rate tones follow the sample and gap thresholds', () => {
  expect(winRateTone(60, 100, true)).toBe('positive');
  expect(winRateTone(40, 100, true)).toBe('negative');
  expect(winRateTone(56, 100, true)).toBe('positive moderate');
  expect(winRateTone(54, 100, true)).toBe('neutral');
  expect(winRateTone(30, 40, true)).toBe('neutral');
  expect(winRateTone(3, 3)).toBe('positive moderate');
  expect(winRateTone(47, 100)).toBe('negative moderate');
  expect(winRateTone(48, 100)).toBe('neutral');
  expect(winRateTone(90, 100)).toBe('positive moderate');
  expect(winRateTone(1, 2)).toBe('neutral');
  expect(winRateTone(0, 0)).toBe('neutral');
});

it('uses ally and enemy hovers in scores but excludes only confirmed heroes and bans', () => {
  const baseline = scorePositions(heroes, data, [], [1], [], 50, [1])[5];
  const hoveredAlly = scorePositions(heroes, data, [2], [1], [], 50, [1])[5];
  expect(baseline[0].hero.id).toBe(3);
  expect(hoveredAlly[0].hero.id).toBe(4);
  expect(hoveredAlly[0].score).toBe(4);
  const hoveredCandidate = scorePositions(heroes, data, [2, 4], [1], [], 50, [1, 2])[5];
  expect(hoveredCandidate.find((row) => row.hero.id === 4)).toMatchObject({ score: 4, expected: 2, coverage: 2 });
  expect(scorePositions(heroes, data, [2, 4], [1], [4], 50, [1, 2])[5].some((row) => row.hero.id === 4)).toBe(false);
  expect(scorePositions(heroes, data, [2, 4], [1], [], 50, [1, 2, 4])[5].some((row) => row.hero.id === 4)).toBe(false);
  const hoveredEnemy = scorePositions(heroes, data, [2], [1], [], 50, [2])[5];
  expect(hoveredEnemy.find((row) => row.hero.id === 3)?.counter).toBe(3);
  expect(scorePositions(heroes, data, [2], [], [], 50, [2])[5].find((row) => row.hero.id === 3)?.counter).toBe(0);
});

it('shrinks pair advantage by sample size and keeps the sign', () => {
  const pair = (matchCount: number, synergy: number) => ({
    heroId1: 1,
    heroId2: 2,
    matchCount,
    winCount: Math.round(matchCount / 2),
    synergy,
  });
  expect(pairAdvantage(pair(1300, 4))).toBeCloseTo(2);
  expect(pairAdvantage(pair(2500, -6), 'with')).toBeCloseTo(-3);
  expect(pairAdvantage(pair(1000, 4), 'vs', 0)).toBe(4);
  // More evidence moves the estimate toward the observed value, never past it.
  const small = pairAdvantage(pair(200, 5))!,
    large = pairAdvantage(pair(20000, 5))!;
  expect(small).toBeLessThan(large);
  expect(large).toBeLessThan(5);
  expect(pairAdvantage(pair(MIN_PAIR_GAMES - 1, 5))).toBeUndefined();
  expect(pairAdvantage(pair(MIN_PAIR_GAMES, 5))).toBeGreaterThan(0);
  expect(PAIR_SHRINKAGE.with).toBeGreaterThan(PAIR_SHRINKAGE.vs);
  // Production data (no rawPairs) is shrunk in both the matrix and the scores.
  const shrunk: DraftData = { ...structuredClone(data), rawPairs: undefined };
  shrunk.matchups = [
    { heroId: 1, with: [], vs: [{ heroId1: 1, heroId2: 2, matchCount: 1300, winCount: 650, synergy: 4 }] },
    { heroId: 2, with: [], vs: [{ heroId1: 2, heroId2: 1, matchCount: 1300, winCount: 650, synergy: -4 }] },
  ];
  expect(matchupAdvantage(shrunk, 1, 2)).toBeCloseTo(2);
  expect(matchupAdvantage({ ...shrunk, rawPairs: true }, 1, 2)).toBe(4);
});

it('tints matrix cells grey near zero and towards the winning team as the advantage grows', async () => {
  const { matchupTint } = await import('../src/shared/draft');
  expect(matchupTint(0)).toMatchObject({ tone: 'neutral', rgb: '115, 115, 115' });
  expect(matchupTint(0.03)).toMatchObject({ tone: 'neutral', rgb: '115, 115, 115' });
  expect(matchupTint(-0.5).tone).toBe('dire');
  expect(matchupTint(-1.5).strength).toBeGreaterThan(matchupTint(-0.5).strength);
  expect(matchupTint(-9)).toMatchObject({ tone: 'dire', rgb: '239, 68, 68', strength: 1 });
  expect(matchupTint(2.5)).toMatchObject({ tone: 'radiant', rgb: '34, 197, 94' });
});

it('turns a matrix pair grey below the even boundary and tinted from it', async () => {
  const { matchupTint, MATCHUP_EVEN } = await import('../src/shared/draft');
  expect(matchupTint(MATCHUP_EVEN - 0.01).tone).toBe('neutral');
  expect(matchupTint(-(MATCHUP_EVEN + 0.01)).tone).toBe('dire');
});

it('states that draft tables cover all ranks and when they were fetched', async () => {
  const { draftDataNote } = await import('../src/shared/draft');
  expect(draftDataNote(undefined)).toBe('STRATZ, all ranks');
  expect(draftDataNote({ fetchedAt: 'not a date' })).toBe('STRATZ, all ranks');
  expect(draftDataNote({ fetchedAt: '2026-10-23T10:00:00Z' })).toMatch(/^STRATZ, all ranks · updated Oct 23, 2026/);
  expect(draftDataNote({ fetchedAt: 'x', bracket: 'DIVINE_IMMORTAL' })).toBe('STRATZ, Divine – Immortal');
  expect(draftDataNote({ fetchedAt: 'x', bracket: 'ALL' })).toBe('STRATZ, all ranks');
});

describe('draft data while the heroes change', () => {
  const reply = (ids: number[], fetchedAt: string): DraftData => ({
    ...data,
    fetchedAt,
    matchups: ids.map((heroId) => ({ heroId, vs: [], with: [] })),
  });
  it('adds replies by hero and asks only for heroes it has not asked for', () => {
    const first = mergeDraft(undefined, '9-0', [1, 2], reply([1, 2], '2026-10-23T10:00:00Z'));
    expect(missingDraftIds(first, '9-0', [2, 1])).toEqual([]);
    expect(missingDraftIds(first, '9-0', [1, 3])).toEqual([3]);
    // Hero 4 has no STRATZ row: it is known, not asked for again.
    const second = mergeDraft(first, '9-0', [3, 4], reply([3], '2026-10-23T11:00:00Z'));
    expect(second.data.matchups.map((row) => row.heroId)).toEqual([1, 2, 3]);
    expect(missingDraftIds(second, '9-0', [1, 2, 3, 4])).toEqual([]);
    expect(second.data.fetchedAt).toBe('2026-10-23T10:00:00Z');
  });
  it('starts over for another match or provider', () => {
    const store = mergeDraft(undefined, '9-0', [1], reply([1], '2026-10-23T10:00:00Z'));
    expect(missingDraftIds(store, '10-0', [1])).toEqual([1]);
    expect(missingDraftIds(undefined, '9-0', [1])).toEqual([1]);
    const next = mergeDraft(store, '9-1', [2], reply([2], '2026-10-23T11:00:00Z'));
    expect(next.data.matchups.map((row) => row.heroId)).toEqual([2]);
    expect(next.known).toEqual([2]);
  });
  it('warms the service with every valid hero in batches of ten', () => {
    const ids = [...Array.from({ length: 23 }, (_, i) => i + 1), 0, 1001, 5];
    const batches = draftWarmBatches(ids.map((id) => ({ id })));
    expect(batches.map((batch) => batch.length)).toEqual([10, 10, 3]);
    expect(batches.flat()).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
  });
});
