import { expect, it } from 'vitest';
import type { HeroAverageRow, Match } from '../src/shared/domain';
import {
  expectedValue,
  matchBracket,
  ownValue,
  profileWinRateTone,
  statBand,
  statBandLabels,
} from '../src/shared/stat-bands';

const match = (values: Partial<Match> = {}): Match => ({
  match_id: 1,
  hero_id: 33,
  start_time: 0,
  duration: 31 * 60,
  player_slot: 0,
  position: 'POSITION_3',
  ...values,
});
const row = (values: Partial<HeroAverageRow>): HeroAverageRow => ({
  heroId: 33,
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
  ...values,
});

it('bands every statistic by its ratio to the average, as in the agreed mockup', () => {
  const edges: [number, number][] = [
    [0.44, 0],
    [0.45, 1],
    [0.64, 1],
    [0.65, 2],
    [0.84, 2],
    [0.85, 3],
    [1.15, 3],
    [1.16, 4],
    [1.35, 4],
    [1.36, 5],
    [1.7, 5],
    [1.71, 6],
  ];
  for (const key of ['kills', 'assists', 'kp', 'last_hits', 'gold_per_min', 'xp_per_min', 'hero_damage'] as const)
    for (const [ratio, band] of edges) expect(statBand(ratio * 100, 100, key), `${key} ${ratio}`).toBe(band);
  expect(statBandLabels).toEqual([
    'Terrible',
    'Bad',
    'Below typical',
    'Typical',
    'Above typical',
    'Good',
    'Exceptional',
  ]);
});

it('never calls deaths better than typical', () => {
  expect(statBand(11, 5.6, 'deaths')).toBe(1);
  expect(statBand(12, 6, 'deaths')).toBe(0);
  expect(statBand(7.5, 6, 'deaths')).toBe(2);
  expect(statBand(7, 6, 'deaths')).toBe(3);
  expect(statBand(1, 6, 'deaths')).toBe(3);
});

it('has no band without a usable average', () => {
  expect(statBand(5, 0, 'kills')).toBeNull();
  expect(statBand(Number.NaN, 5, 'kills')).toBeNull();
  expect(statBand(5, Infinity, 'kills')).toBeNull();
});

it('compares with the timeline row at the minute the match ended', () => {
  // STRATZ rows are cumulative values at a minute of the game, from minute 0 to 35.
  const rows = [
    row({ time: 20, deaths: 3.5, cs: 90, xp: 9000, killContribution: 55 }),
    row({ time: 31, deaths: 6, cs: 150, xp: 18600, killContribution: 60 }),
    row({ time: 35, deaths: 7, cs: 175, xp: 21000, killContribution: 62 }),
  ];
  expect(expectedValue(rows, match(), 'deaths')).toBe(6);
  expect(expectedValue(rows, match(), 'last_hits')).toBe(150);
  // XPM is XP over the row's minutes; KP is already a share at that minute.
  expect(expectedValue(rows, match(), 'xp_per_min')).toBe(600);
  expect(expectedValue(rows, match(), 'kp')).toBe(60);
  // 31:40 rounds to minute 32, which is missing: the nearest row is used.
  expect(expectedValue(rows, match({ duration: 31 * 60 + 40 }), 'deaths')).toBe(6);
  expect(expectedValue(rows, match({ duration: 20 * 60 + 10 }), 'deaths')).toBe(3.5);
});

it('continues a longer game at the growth of the last five minutes', () => {
  const rows = [
    row({ time: 30, deaths: 6, cs: 150, xp: 18000 }),
    row({ time: 35, deaths: 7, cs: 175, xp: 21000, killContribution: 62 }),
  ];
  const late = match({ duration: 50 * 60 });
  // Deaths 6 → 7 over minutes 30–35: 0.2 a minute for 15 more minutes.
  expect(expectedValue(rows, late, 'deaths')).toBeCloseTo(7 + 0.2 * 15, 6);
  expect(expectedValue(rows, late, 'last_hits')).toBeCloseTo(175 + 5 * 15, 6);
  // XP grows 600 a minute late in the game: (21000 + 600 × 15) / 50.
  expect(expectedValue(rows, late, 'xp_per_min')).toBeCloseTo(600, 6);
  // KP is a share: as at minute 35.
  expect(expectedValue(rows, late, 'kp')).toBe(62);
  // Without minute 30, the average minute so far.
  expect(expectedValue([rows[1]!], late, 'deaths')).toBeCloseTo((7 * 50) / 35, 6);
  // 35:20 is still minute 35.
  expect(expectedValue(rows, match({ duration: 35 * 60 + 20 }), 'deaths')).toBe(7);
});

it('has no expected value from a row with too few games or without GPM', () => {
  expect(expectedValue([row({ time: 31, matchCount: 49 })], match(), 'deaths')).toBeUndefined();
  expect(expectedValue([row({ time: 31, matchCount: 50 })], match(), 'deaths')).toBe(6);
  // STRATZ leaves goldPerMinute empty; GPM is then not coloured.
  expect(expectedValue([row({ time: 31, goldPerMinute: null })], match(), 'gold_per_min')).toBeUndefined();
  expect(expectedValue([row({ time: 31 })], match(), 'gold_per_min')).toBe(400);
});

it('uses rows without a minute as they are', () => {
  expect(expectedValue([row({ time: null, deaths: 7 })], match({ duration: 50 * 60 }), 'deaths')).toBe(7);
  expect(expectedValue([row({ time: null })], match(), 'xp_per_min')).toBeUndefined();
});

it('has no expected value without a row for the position or a known position', () => {
  expect(expectedValue([row({ position: 2 })], match(), 'deaths')).toBeUndefined();
  expect(expectedValue([row({})], match({ position: null }), 'deaths')).toBeUndefined();
  expect(expectedValue([row({ deaths: null })], match(), 'deaths')).toBeUndefined();
});

it('reads the own value of each statistic', () => {
  const m = match({ kills: 4, deaths: 11, assists: 2, team_kills: 20, last_hits: 135, gold_per_min: 399 });
  expect(ownValue(m, 'deaths')).toBe(11);
  expect(ownValue(m, 'kp')).toBe(30);
  expect(ownValue(m, 'last_hits')).toBe(135);
  expect(ownValue(m, 'gold_per_min')).toBe(399);
  expect(ownValue(match(), 'hero_damage')).toBeUndefined();
});

it('maps the match average rank to a STRATZ bracket', () => {
  expect(matchBracket(match({ average_rank: 75 }))).toBe('DIVINE_IMMORTAL');
  expect(matchBracket(match({ average_rank: 80 }))).toBe('DIVINE_IMMORTAL');
  expect(matchBracket(match({ average_rank: 54 }))).toBe('LEGEND_ANCIENT');
  // STRATZ rounds some averages to a medal without stars.
  expect(matchBracket(match({ average_rank: 70 }))).toBe('DIVINE_IMMORTAL');
  expect(matchBracket(match({ average_rank: 10 }))).toBe('HERALD_GUARDIAN');
  expect(matchBracket(match())).toBeUndefined();
  // Without a STRATZ rank, the median medal the live match showed.
  expect(matchBracket(match({ medal_rank: 34 }))).toBe('CRUSADER_ARCHON');
  expect(matchBracket(match({ average_rank: 75, medal_rank: 34 }))).toBe('DIVINE_IMMORTAL');
});

it('colours a win rate only from ten games', () => {
  expect(profileWinRateTone(6, 9)).toBe('few');
  expect(profileWinRateTone(6, 10)).toBe('good');
  expect(profileWinRateTone(5, 10)).toBe('neutral');
  expect(profileWinRateTone(4, 10)).toBe('bad');
  expect(profileWinRateTone(13, 25)).toBe('neutral');
  expect(profileWinRateTone(12, 25)).toBe('neutral');
});
