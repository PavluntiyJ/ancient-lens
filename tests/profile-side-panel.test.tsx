import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LineupEntry, Match } from '../src/shared/domain';
import { HeroesPanel, MatchDetails } from '../src/ui/profile/ProfileSidePanel';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));
vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const heroes = [
  { id: 33, localized_name: 'Enigma', primary_attr: 'int', attack_type: 'Ranged', roles: [] },
  { id: 62, localized_name: 'Bounty Hunter', primary_attr: 'agi', attack_type: 'Melee', roles: [] },
];
const game = (id: number, hero: number, win: boolean, imp?: number): Match => ({
  match_id: id,
  hero_id: hero,
  start_time: id * 3600,
  duration: 1800,
  player_slot: 0,
  radiant_win: win,
  imp,
});

it('lists heroes as one table with a single header row, most played first', () => {
  const matches = [game(1, 62, true, 20), game(2, 62, true, 10), game(3, 62, false), game(4, 33, false, -7)];
  const html = renderToStaticMarkup(
    <HeroesPanel matches={matches} heroes={heroes} ratings={new Map()} measured={false} onHero={() => {}} />,
  );
  expect(text(html)).toContain('Hero G W – L IMP Win %');
  expect(html.indexOf('Bounty Hunter')).toBeLessThan(html.indexOf('Enigma'));
  expect(text(html)).toContain('Bounty Hunter 3 2 – 1 +15');
  expect(text(html)).not.toContain('games');
  expect(html).not.toContain('bar2');
  const measured = renderToStaticMarkup(
    <HeroesPanel
      matches={matches}
      heroes={heroes}
      ratings={new Map([[1, { mmr: 4025, delta: 25 }]])}
      measured
      onHero={() => {}}
    />,
  );
  expect(text(measured)).toContain('Hero G W – L IMP MMR');
  expect(text(measured)).toContain('+25');
});

it('shows both teams, the own row, MMR and the match links', () => {
  const lineup: LineupEntry[] = Array.from({ length: 10 }, (_, i) => ({
    radiant: i < 5,
    own: i === 7,
    hero_id: i === 7 ? 33 : i === 2 ? 62 : 100 + i,
    name: i === 7 || i === 2 ? undefined : `Player ${i}`,
    kills: i,
    deaths: 3,
    assists: 5,
    net_worth: 15000 + i,
    gold_per_min: 400 + i,
    imp: i * 5 - 20,
  }));
  const match: Match = { ...game(9001, 33, true, 15), player_slot: 128, radiant_win: false, lineup };
  const html = renderToStaticMarkup(
    <MatchDetails match={match} heroes={heroes} rating={{ mmr: 4380, delta: 24 }} onClose={() => {}} />,
  );
  expect(text(html)).toContain('Radiant');
  expect(text(html)).toContain('Dire');
  expect(html.match(/class="profile-player own"/g)?.length).toBe(1);
  expect(html.replace(/<[^>]+>/g, '')).toContain('4,380 (+24)');
  expect(text(html)).toContain('Win');
  for (const site of ['Dotabuff', 'OpenDota', 'STRATZ']) expect(html).toContain(site);
  // A player without a public name goes by the hero, as in the hover cards.
  expect(text(html)).toContain('Bounty Hunter');
  expect(text(html)).not.toContain('Anonymous');
});
