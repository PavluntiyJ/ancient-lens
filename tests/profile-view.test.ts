import { expect, it } from 'vitest';
import type { StatsFilter } from '../src/shared/domain';
import { defaultProfileView, readProfileView, type ProfileView } from '../src/ui/profile/profile-view';

const settings: StatsFilter = { mode: 'all', rankedOnly: true };

it('starts from 30 days, no filters, every column and newest first', () => {
  expect(defaultProfileView(settings)).toEqual({
    days: 30,
    hero: 0,
    result: 'all',
    rankedOnly: true,
    includeTurbo: true,
    modes: 'match',
    position: 0,
    duration: 'all',
    timeOfDay: 'all',
    weekday: 'all',
    patch: 'all',
    columns: { xpm: true, damage: true, lhdn: true },
    sort: 'date',
    direction: 'desc',
  });
  expect(defaultProfileView({ mode: 'normal', rankedOnly: false })).toMatchObject({
    rankedOnly: false,
    includeTurbo: false,
  });
});

it('reads back a saved view', () => {
  const view: ProfileView = {
    ...defaultProfileView(settings),
    days: 7,
    hero: 33,
    result: 'loss',
    position: 3,
    weekday: 6,
    columns: { xpm: false, damage: true, lhdn: false },
    sort: 'gold_per_min',
    direction: 'asc',
  };
  expect(readProfileView(JSON.stringify(view), settings)).toEqual(view);
});

it('falls back to the defaults for a missing, broken or outdated view', () => {
  for (const raw of [
    null,
    '{',
    '{"days":5}',
    JSON.stringify({ ...defaultProfileView(settings), sort: 'networth' }),
    JSON.stringify({ ...defaultProfileView(settings), position: 6 }),
  ])
    expect(readProfileView(raw, settings), String(raw)).toEqual(defaultProfileView(settings));
});
