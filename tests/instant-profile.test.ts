import { expect, it } from 'vitest';
import { matchSchema } from '../src/shared/domain';
import { filterHistory } from '../src/shared/history';
import { roleHeroes, roleHistory } from '../src/shared/profile-history';
import { guessTeamRoles } from '../src/shared/role-guess';

it('uses a recorded queue position consistently in filters, position cards and history-based role guesses', () => {
  const match = matchSchema.parse({
    match_id: 1,
    hero_id: 74,
    start_time: 1000,
    duration: 1800,
    player_slot: 128,
    radiant_win: false,
    recorded: true,
    local_only: true,
    queue_position: 2,
  });
  const filter = { days: 0, hero: 0, result: 'all' as const, includeTurbo: false, position: 2 as const };
  expect(filterHistory([match], filter)).toEqual([match]);
  expect(filterHistory([match], { ...filter, position: 3 })).toEqual([]);
  expect(roleHistory([match], 2, new Map())).toMatchObject({ games: 1, played: 1, wins: 1 });
  expect(roleHeroes([match], 2, new Map())).toMatchObject([{ hero: 74, games: 1, wins: 1 }]);
  expect(guessTeamRoles([{ matches: [match] }], [])[0]).toMatchObject({
    position: 2,
    guessed: true,
    player: { games: 1, known: 1 },
  });
});
