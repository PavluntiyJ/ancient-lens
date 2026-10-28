import { expect, it } from 'vitest';
import type { Match } from '../src/shared/domain';
import { deathParticipation, killParticipation } from '../src/shared/match-stats';

const match = (fields: Partial<Match>): Match => ({
  match_id: 1,
  hero_id: 75,
  start_time: 0,
  duration: 2400,
  player_slot: 131,
  ...fields,
});

it('computes kill and death participation from team totals or the recorded score', () => {
  // The recorded Silencer game: 10/3/17, Dire 38 kills and 23 deaths.
  const silencer = match({ kills: 10, deaths: 3, assists: 17, team_kills: 38, team_deaths: 23 });
  expect(Math.round(killParticipation(silencer)!)).toBe(71);
  expect(Math.round(deathParticipation(silencer)!)).toBe(13);
  // Before the match data arrives, kill participation uses the Dire score from the game.
  const recorded = match({ kills: 10, assists: 17, dire_score: 38, radiant_score: 23 });
  expect(Math.round(killParticipation(recorded)!)).toBe(71);
  expect(deathParticipation(recorded)).toBeUndefined();
  expect(killParticipation(match({ kills: 5, assists: 9, team_kills: 10 }))).toBe(100);
  expect(killParticipation(match({ kills: 0, assists: 0, team_kills: 0 }))).toBe(0);
  expect(killParticipation(match({ kills: 1, team_kills: 10 }))).toBeUndefined();
});
