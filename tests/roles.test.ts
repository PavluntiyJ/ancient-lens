import { draftLanePositions } from '../src/shared/roles';
import { expect, it } from 'vitest';
import { matchSchema } from '../src/shared/domain';
import { mainPosition, matchPosition, rankedRoles, summarizePositions } from '../src/shared/roles';

it('uses the queued position only behind the provider position and support role', () => {
  for (const { id } of rankedRoles) expect(matchPosition({ queue_position: id })).toBe(id);
  expect(matchPosition({ position: 'POSITION_3', queue_position: 2 })).toBe(3);
  expect(matchPosition({ role: 'LIGHT_SUPPORT', queue_position: 2 })).toBe(4);
  expect(matchPosition({ role: 'HARD_SUPPORT', queue_position: 2 })).toBe(5);
  expect(matchPosition({ position: null, role: 'CORE', queue_position: 2 })).toBe(2);
  expect(matchPosition({ position: 'UNKNOWN', role: null, queue_position: 5 })).toBe(5);
  expect(matchPosition({ queue_position: null })).toBeUndefined();
  expect(summarizePositions([{ queue_position: 2 }, {}])).toMatchObject({ known: 1, unknown: 1, counts: { 2: 1 } });
  expect(mainPosition([{ queue_position: 2 }])?.position).toBe(2);
});

it('validates the queued position while retaining old cached matches', () => {
  const match = { match_id: 1, hero_id: 1, start_time: 1, duration: 1, player_slot: 0 };
  expect(matchSchema.parse({ ...match, queue_position: 2 }).queue_position).toBe(2);
  expect(matchSchema.parse({ ...match, queue_position: null }).queue_position).toBeNull();
  expect(matchSchema.parse(match).queue_position).toBeUndefined();
  for (const queue_position of [0, 6, -1, 1.5, '2'])
    expect(matchSchema.safeParse({ ...match, queue_position }).success).toBe(false);
});

it('uses all five provider positions and keeps explicit position ahead of broad role', () => {
  for (const role of rankedRoles) {
    expect(matchPosition({ position: `POSITION_${role.id}`, role: 'CORE' })).toBe(role.id);
  }
  expect(matchPosition({ position: 'POSITION_4', role: 'HARD_SUPPORT' })).toBe(4);
  expect(matchPosition({ role: 'LIGHT_SUPPORT' })).toBe(4);
  expect(matchPosition({ role: 'HARD_SUPPORT', position: 'UNKNOWN' })).toBe(5);
});

it('does not guess positions from generic roles or unknown and legacy data', () => {
  for (const position of [undefined, null, 'UNKNOWN', 'FILTERED', 'ALL', 'POSITION_6', '1']) {
    expect(matchPosition({ position, role: 'CORE' })).toBeUndefined();
  }
  expect(matchPosition({ role: 'SUPPORT' })).toBeUndefined();
  expect(matchPosition({})).toBeUndefined();
});

it('counts known positions separately from missing data without dropping matches', () => {
  expect(
    summarizePositions([
      { position: 'POSITION_1' },
      { position: 'POSITION_1' },
      { role: 'LIGHT_SUPPORT' },
      { role: 'CORE' },
      {},
    ]),
  ).toEqual({
    counts: { 1: 2, 2: 0, 3: 0, 4: 1, 5: 0 },
    unknown: 2,
    known: 3,
  });
  expect(summarizePositions([])).toEqual({ counts: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, unknown: 0, known: 0 });
});

it('preserves position through match validation while accepting old cached matches', () => {
  const match = { match_id: 1, hero_id: 1, start_time: 1, duration: 1, player_slot: 0 };
  expect(matchSchema.parse({ ...match, position: 'POSITION_3' }).position).toBe('POSITION_3');
  expect(matchPosition(matchSchema.parse(match))).toBeUndefined();
});

it('maps verified Dota lane bits to ranked roles without guessing group flags', () => {
  expect([1, 2, 4, 8, 16].map(draftLanePositions)).toEqual([[1], [3], [2], [4], [5]]);
  expect(draftLanePositions(7)).toEqual([1, 2, 3]);
  expect(draftLanePositions(24)).toEqual([4, 5]);
  expect(draftLanePositions(31)).toEqual([1, 2, 3, 4, 5]);
  expect(draftLanePositions(18)).toEqual([3, 5]);
  for (const flags of [0, -1, 32, 1.5]) expect(draftLanePositions(flags)).toEqual([]);
});

it('main position share ignores matches without a known position', () => {
  const rows = ['POSITION_3', 'POSITION_3', 'POSITION_5', null].map((position) => ({ position, role: null }));
  expect(mainPosition(rows)).toEqual({ position: 3, games: 2, known: 3, share: 2 / 3 });
  expect(mainPosition([{ position: null, role: null }])).toBeUndefined();
  // Ties keep the lower position, matching the order of the position strip.
  expect(
    mainPosition([
      { position: 'POSITION_4', role: null },
      { position: 'POSITION_2', role: null },
    ])?.position,
  ).toBe(2);
});

it('keeps the STRATZ average rank of a match only as a rank tier', () => {
  const base = { match_id: 1, hero_id: 2, start_time: 0, duration: 1800, player_slot: 0 };
  expect(matchSchema.parse({ ...base, average_rank: 75 }).average_rank).toBe(75);
  expect(matchSchema.parse(base).average_rank).toBeUndefined();
  expect(matchSchema.safeParse({ ...base, average_rank: 95 }).success).toBe(false);
});
