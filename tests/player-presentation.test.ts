import { expect, it } from 'vitest';
import { heroPerformance } from '../src/shared/hero-performance';
import { playerSiteUrl } from '../src/shared/player-sites';
it('does not mark tiny samples as strong heroes and uses the observed sample thresholds', () => {
  expect(heroPerformance(1, 1).tone).toBe('neutral');
  expect(heroPerformance(4, 5).tone).toBe('positive');
  expect(heroPerformance(3, 5).tone).toBe('neutral');
  expect(heroPerformance(6, 10).tone).toBe('positive');
  expect(heroPerformance(4, 10).tone).toBe('negative');
  expect(heroPerformance(49, 100).tone).toBe('neutral');
  expect(heroPerformance(90, 100).intensity).toBeGreaterThan(heroPerformance(60, 100).intensity);
});
it('builds all three direct links using account ID, including SteamID64 input', () => {
  expect(playerSiteUrl('76561197960265729', 'dotabuff')).toBe('https://www.dotabuff.com/players/1');
  expect(playerSiteUrl('1', 'opendota')).toBe('https://www.opendota.com/players/1');
  expect(playerSiteUrl('123456789', 'steam')).toBe('https://steamcommunity.com/profiles/76561198083722517');
  expect(playerSiteUrl('1', 'stratz')).toBe('https://stratz.com/players/1');
  expect(() => playerSiteUrl('javascript:alert(1)', 'stratz')).toThrow();
});
