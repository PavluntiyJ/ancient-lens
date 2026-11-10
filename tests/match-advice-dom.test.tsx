// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import type { Hero } from '../src/shared/domain';
import type { DraftData } from '../src/shared/draft';
import { draftPickIds } from '../src/ui/match/draftPicks';
import { useDraftAdvice } from '../src/ui/match/useDraftAdvice';

afterEach(cleanup);

const hero = (id: number) =>
  ({ id, name: `npc_dota_hero_${id}`, localized_name: `Hero ${id}`, roles: [] }) as unknown as Hero;
const heroes = [1, 2, 3, 4].map(hero);
const data: DraftData = { source: 'STRATZ', fetchedAt: '2026-11-10T10:00:00Z', positions: [], matchups: [] };

it('lists picks and hovers per side, confirmed picks and bans, of known heroes only', () => {
  const ids = draftPickIds(
    [
      { team: 'radiant', heroId: 2 },
      { team: 'dire', heroId: 99 },
    ] as never,
    [
      { team: 'radiant', heroId: 1 },
      { team: 'dire', heroId: 3 },
    ] as never,
    [4, 98],
    heroes,
  );
  expect(ids).toEqual({ banIds: '4', confirmedIds: '2,99', radiantIds: '2,1', direIds: '3', pickedIds: '1,2,3' });
});

it('scores nothing without draft data or picks, and keeps its results while the draft stands still', () => {
  const picks = draftPickIds([{ team: 'radiant', heroId: 1 }] as never, [], [], heroes);
  const { result, rerender } = renderHook(
    ({ draftData }) => useDraftAdvice({ draftData, heroes, picks, synergyWeight: 1 }),
    {
      initialProps: { draftData: undefined as DraftData | undefined },
    },
  );
  expect(result.current.recommendations).toBeUndefined();
  rerender({ draftData: data });
  const first = result.current;
  expect(first.recommendations).toBeDefined();
  // A render with the same draft keeps the memoised results.
  rerender({ draftData: data });
  expect(result.current.recommendations).toBe(first.recommendations);
  expect(result.current.counters).toBe(first.counters);
  expect(result.current.meta).toBe(first.meta);
});
