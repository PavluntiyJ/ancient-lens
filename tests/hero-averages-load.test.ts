import { expect, it, vi } from 'vitest';
import type { HeroAverages, Match } from '../src/shared/domain';
import { averageBatches, cachedAverages, loadBatch } from '../src/ui/profile/useHeroAverages';

const match = (id: number, hero: number, average_rank?: number): Match => ({
  match_id: id,
  hero_id: hero,
  start_time: 0,
  duration: 1800,
  player_slot: 0,
  average_rank,
});

it('batches the heroes of each bracket ten at a time', () => {
  const many = Array.from({ length: 23 }, (_, i) => match(i, i + 1, 75));
  expect(averageBatches(many).map((batch) => [batch.bracket, batch.ids.length])).toEqual([
    ['DIVINE_IMMORTAL', 10],
    ['DIVINE_IMMORTAL', 10],
    ['DIVINE_IMMORTAL', 3],
  ]);
  // No average rank: nothing to compare with. A hero in two brackets is asked for in both.
  expect(averageBatches([match(1, 5), match(2, 33, 75), match(3, 33, 54), match(4, 33, 75)])).toEqual([
    { bracket: 'DIVINE_IMMORTAL', ids: [33] },
    { bracket: 'LEGEND_ANCIENT', ids: [33] },
  ]);
});

it('keeps loaded rows per bracket and hero', async () => {
  const fetch = vi.fn(async (ids: number[]): Promise<HeroAverages> => ({
    source: 'STRATZ',
    fetchedAt: '2026-10-27T00:00:00Z',
    bracket: 'LEGEND_ANCIENT',
    rows: ids.map((heroId) => ({
      heroId,
      position: 3,
      time: 30,
      matchCount: 400,
      kills: 5,
      deaths: 6,
      assists: 12,
      goldPerMinute: 400,
      xp: 18000,
      cs: 150,
      heroDamage: 20000,
      networth: 14000,
      killContribution: 60,
    })),
  }));
  await loadBatch({ bracket: 'LEGEND_ANCIENT', ids: [7, 8] }, fetch);
  expect(cachedAverages(7, 'LEGEND_ANCIENT')?.[0]?.deaths).toBe(6);
  expect(cachedAverages(7, 'DIVINE_IMMORTAL')).toBeUndefined();
  await loadBatch({ bracket: 'LEGEND_ANCIENT', ids: [7, 8] }, fetch);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('remembers a failed batch for the session instead of asking again', async () => {
  const fetch = vi.fn(async (): Promise<HeroAverages> => {
    throw new Error('Hero averages require a local STRATZ service; see Settings');
  });
  await loadBatch({ bracket: 'HERALD_GUARDIAN', ids: [1, 2] }, fetch);
  await loadBatch({ bracket: 'HERALD_GUARDIAN', ids: [1, 2] }, fetch);
  expect(fetch).toHaveBeenCalledTimes(1);
  // Known to be missing: no rows, which leaves the numbers white.
  expect(cachedAverages(1, 'HERALD_GUARDIAN')).toEqual([]);
});
