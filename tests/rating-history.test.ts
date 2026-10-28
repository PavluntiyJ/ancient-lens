import { expect, it } from 'vitest';
import type { Match, MmrEntry } from '../src/shared/domain';
import { ratingByMatch } from '../src/shared/rating-history';

const match = (id: number, end: number, lobby = 7): Match => ({
  match_id: id,
  hero_id: 1,
  start_time: end - 1800,
  duration: 1800,
  player_slot: 0,
  lobby_type: lobby,
});
const entry = (value: number, at: number, source: MmrEntry['source'] = 'dota-memory'): MmrEntry => ({
  id: String(at),
  value,
  createdAt: new Date(at * 1000).toISOString(),
  accountId: '1',
  source,
});

it('attributes a rating change to the only ranked match between two measurements', () => {
  const result = ratingByMatch(
    [match(1, 1000), match(2, 2000), match(3, 2100), match(4, 3000, 0)],
    [entry(6526, 500), entry(6586, 1500), entry(6560, 2500), entry(6590, 3500)],
  );
  expect(result.get(1)).toEqual({ mmr: 6586, delta: 60 });
  // Two ranked matches between measurements: the change cannot be split between them.
  expect(result.has(2)).toBe(false);
  expect(result.has(3)).toBe(false);
  // Unranked matches never get a rating, even when they are the only match in a window.
  expect(result.has(4)).toBe(false);
});

it('ignores manual entries and needs a measurement before the match', () => {
  expect(ratingByMatch([match(1, 1000)], [entry(6586, 1500)]).size).toBe(0);
  expect(ratingByMatch([match(1, 1000)], [entry(6500, 500, 'manual'), entry(6586, 1500)]).size).toBe(0);
});

it('takes the journal rating of a recorded match and does not count its change twice', () => {
  const recorded = { ...match(1, 1000), mmr_after: 6586, mmr_delta: 60 };
  const result = ratingByMatch([recorded], [entry(6526, 500), entry(6586, 1500)]);
  expect(result.get(1)).toEqual({ mmr: 6586, delta: 60 });
  // Without any measurement in the profile the journal still supplies the change.
  expect(ratingByMatch([recorded], []).get(1)).toEqual({ mmr: 6586, delta: 60 });
});
