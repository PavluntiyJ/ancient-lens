import { expect, it } from 'vitest';
import type { Match, MmrEntry } from '../src/shared/domain';
import { chartPoints, dayBands, nearestPoint, pointMatch } from '../src/shared/mmr-chart';

const at = (hours: number) => new Date(Date.UTC(2026, 9, 20) + hours * 3600000).toISOString();
const entry = (value: number, hours: number, source: MmrEntry['source'] = 'dota-memory'): MmrEntry => ({
  id: `${value}-${hours}`,
  value,
  createdAt: at(hours),
  source,
});

it('keeps the latest 50 measurements by time, with the change from the one before', () => {
  const entries = Array.from({ length: 60 }, (_, i) => entry(3000 + i * 10, i)).reverse();
  entries.push({ ...entry(1, 0), createdAt: 'not a date' });
  const points = chartPoints(entries);
  expect(points).toHaveLength(50);
  expect(points[0]!.value).toBe(3100);
  // The first shown point still knows the measurement before it.
  expect(points[0]!.delta).toBe(10);
  expect(points.at(-1)!.value).toBe(3590);
  expect(chartPoints([entry(3000, 1)])[0]!.delta).toBeUndefined();
});

it('picks the point nearest to the pointer by x', () => {
  const xs = [8, 100, 200, 292];
  expect(nearestPoint(xs, 0)).toBe(0);
  expect(nearestPoint(xs, 53)).toBe(0);
  expect(nearestPoint(xs, 55)).toBe(1);
  expect(nearestPoint(xs, 260)).toBe(3);
  expect(nearestPoint([], 10)).toBeUndefined();
});

it('links a game measurement to the recorded match it follows, never a manual entry', () => {
  const start = Date.UTC(2026, 9, 20) / 1000;
  const match = (id: number, endHours: number): Match => ({
    match_id: id,
    hero_id: 1,
    start_time: start + endHours * 3600 - 1800,
    duration: 1800,
    player_slot: 0,
    radiant_win: true,
  });
  const matches = [match(1, 1), match(2, 3), match(3, 20)];
  const ratings = new Map([
    [1, { mmr: 3025, delta: 25 }],
    [2, { mmr: 3000, delta: -25 }],
    [3, { mmr: 3025, delta: 25 }],
  ]);
  const [first, second, manual, late] = chartPoints([
    entry(3025, 1.2),
    entry(3000, 3.5),
    entry(3025, 30),
    entry(3000, 3.6, 'manual'),
  ]).sort((a, b) => a.at - b.at);
  expect(pointMatch(first!, matches, ratings)?.match_id).toBe(1);
  expect(pointMatch(second!, matches, ratings)?.match_id).toBe(2);
  expect(pointMatch(manual!, matches, ratings)).toBeUndefined();
  // Ten hours after the match is beyond the six-hour window.
  expect(pointMatch(late!, matches, ratings)).toBeUndefined();
});

it('groups consecutive points into local days', () => {
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime() / 1000;
  expect(dayBands([at(22, 10), at(22, 23), at(23, 1), at(23, 9), at(23, 22)])).toEqual([
    { from: 0, to: 1, label: 'Oct 22', count: 2 },
    { from: 2, to: 4, label: 'Oct 23', count: 3 },
  ]);
  expect(dayBands([])).toEqual([]);
});
