import { expect, it } from 'vitest';
import type { Match } from '../src/shared/domain';
import { heroPool } from '../src/shared/hero-pool';
import { meetings } from '../src/shared/meetings';

const game = (id: number, start: number, extra: Partial<Match> = {}): Match => ({
  match_id: id,
  hero_id: 1,
  start_time: start,
  duration: 1800,
  player_slot: 0,
  radiant_win: true,
  ...extra,
});

it('counts earlier matches as ally or opponent with the own result and the last meeting', () => {
  const history = [
    game(1, 100, { allies: [{ id: 55, hero: 14, kills: 3, deaths: 1, assists: 9 }] }),
    game(2, 300, { enemies: [{ id: 55, hero: 8 }], radiant_win: false }),
    game(3, 200, { enemies: [{ id: 55 }, { id: 66 }] }),
    game(4, 400, { allies: [{ id: 66 }] }),
    game(9, 500, { allies: [{ id: 55 }] }),
  ];
  const met = meetings(history, '55', '9')!;
  expect(met.ally).toEqual({ games: 1, wins: 1 });
  expect(met.enemy).toEqual({ games: 2, wins: 1 });
  expect(met.games.map((game) => game.match.match_id)).toEqual([2, 3, 1]);
  expect([met.games[0]!.ally, met.games[0]!.won, met.games[0]!.player.hero]).toEqual([false, false, 8]);
  expect(met.games[2]!.player.kills).toBe(3);
  expect(meetings(history, '77')).toBeNull();
  expect(meetings(history, 'x')).toBeNull();
});

it('marks recent and heavy hero spam by their thresholds', () => {
  const five = [1, 2, 3, 4, 5].map((i) => game(i, 1000 - i, { hero_id: 7 }));
  expect(heroPool([...five, game(6, 10, { hero_id: 8 })], [{ hero_id: 7, games: 5 }]).get(7)).toBe('recent');
  // Seven of the last ten, with the newest game on another hero.
  const ten = [8, 7, 7, 7, 8, 7, 7, 8, 7, 7].map((hero_id, i) => game(i + 1, 1000 - i, { hero_id }));
  expect(heroPool(ten, []).get(7)).toBe('recent');
  expect(heroPool(ten.slice(0, 9), []).size).toBe(0);
  const six = [8, 7, 7, 7, 8, 7, 8, 8, 7, 7].map((hero_id, i) => game(i + 1, 1000 - i, { hero_id }));
  expect(heroPool(six, []).size).toBe(0);
  // Heavy needs 25 games and 60%, and replaces Recent for the same hero.
  expect(
    heroPool(five, [
      { hero_id: 7, games: 15 },
      { hero_id: 8, games: 10 },
    ]).get(7),
  ).toBe('heavy');
  expect(
    heroPool(
      [],
      [
        { hero_id: 7, games: 14 },
        { hero_id: 8, games: 10 },
      ],
    ).size,
  ).toBe(0);
  expect(
    heroPool(
      [],
      [
        { hero_id: 7, games: 14 },
        { hero_id: 8, games: 11 },
      ],
    ).size,
  ).toBe(0);
});
