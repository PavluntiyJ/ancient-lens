import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cardStats, MatchTeams } from '../src/ui/PlayerCard';
import type { Hero, Match } from '../src/shared/domain';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));
vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));
const heroes: Hero[] = [14, 31, 60].map((id) => ({
  id,
  localized_name: `Hero ${id}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: [],
}));
const match = (won: boolean, position: string, extra: Partial<Match> = {}): Match => ({
  match_id: 1,
  hero_id: 60,
  start_time: 1_700_000_000,
  duration: 1800,
  player_slot: 0,
  radiant_win: won,
  kills: 4,
  deaths: 2,
  assists: 6,
  position,
  ...extra,
});

it('sums the shown matches: win rate, main role and average K/D/A', () => {
  const stats = cardStats([match(true, 'POSITION_3'), match(false, 'POSITION_3'), match(true, 'POSITION_4')]);
  expect(stats).toMatchObject({ games: 3, wins: 2, kda: '4 / 2 / 6' });
  expect(stats.main).toMatchObject({ position: 3, games: 2, known: 3 });
  expect(cardStats([])).toMatchObject({ games: 0, wins: 0, kda: '—', main: undefined });
});

it('lists both teams of a match with the player first and others as links', () => {
  const html = renderToStaticMarkup(
    <MatchTeams
      match={match(true, 'POSITION_3', {
        allies: [{ id: 2, name: 'Kestrel', hero: 31, kills: 12, deaths: 3, assists: 6 }],
        enemies: [{ id: 3, hero: 14 }],
      })}
      name="eloquence"
      heroes={heroes}
      open={() => {}}
    />,
  );
  expect(html).toMatch(/Own team · won.*eloquence.*Kestrel.*Opponents.*ID 3/s);
  expect(html.match(/<button/g)).toHaveLength(2);
  expect(html).toContain('12/3/6');
  expect(html).toContain('Open Kestrel');
  const lost = renderToStaticMarkup(
    <MatchTeams match={match(false, 'POSITION_3')} name="x" heroes={heroes} open={() => {}} />,
  );
  expect(lost).toContain('Own team · lost');
  expect(lost).toContain('No other public players');
});
