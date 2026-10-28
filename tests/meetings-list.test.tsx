import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MeetingList } from '../src/ui/Meetings';
import { meetings } from '../src/shared/meetings';
import type { Match } from '../src/shared/domain';

vi.mock('../src/ui/MatchScreen', () => ({
  Portrait: ({ hero }: { hero?: { id: number } }) => <i data-hero={hero?.id} />,
}));
vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));

const game = (id: number, start: number, extra: Partial<Match>): Match => ({
  match_id: id,
  hero_id: 5,
  start_time: start,
  duration: 1800,
  player_slot: 0,
  radiant_win: true,
  kills: 4,
  deaths: 2,
  assists: 11,
  ...extra,
});

it('lists meetings newest first with both heroes, K/D/A and the own result', () => {
  const met = meetings(
    [
      game(1, 1700000000, { allies: [{ id: 55, hero: 14, kills: 3, deaths: 0, assists: 9 }] }),
      game(2, 1700100000, { enemies: [{ id: 55, hero: 8 }], radiant_win: false }),
    ],
    '55',
  )!;
  const heroes = [5, 8, 14].map((id) => ({
    id,
    localized_name: `H${id}`,
    primary_attr: 'str',
    attack_type: 'Melee',
    roles: [],
  }));
  const html = renderToStaticMarkup(<MeetingList met={met} heroes={heroes} summary="s" onOpen={() => {}} />);
  const rows = html.split('<li>').slice(1);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toContain('class="enemy"');
  expect(rows[0]).toContain('data-hero="8"');
  expect(rows[0]).toContain('?/?/?');
  expect(rows[0]).toContain('I lost');
  expect(rows[0]).toContain('Open match 2 on Dotabuff');
  expect(rows[1]).toContain('class="ally"');
  expect(rows[1]).toContain('3/0/9');
  expect(rows[1]).toContain('4/2/11');
  expect(rows[1]).toContain('We won');
});
