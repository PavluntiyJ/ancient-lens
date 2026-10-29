import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Match } from '../src/shared/domain';
import { ColourLegend, FilterBar, MoreFilters, PositionCards } from '../src/ui/profile/ProfileFilters';
import { defaultProfileView } from '../src/ui/profile/profile-view';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));
vi.mock('../src/ui/ProfileMenu', () => ({ ProfileMenu: ({ label }: { label: string }) => <button>{label}</button> }));

const view = defaultProfileView({ mode: 'normal', rankedOnly: true });
const change = () => {};
const heroes = [
  { id: 33, localized_name: 'Enigma', primary_attr: 'int', attack_type: 'Ranged', roles: [] },
  { id: 62, localized_name: 'Bounty Hunter', primary_attr: 'agi', attack_type: 'Melee', roles: [] },
];

it('shows every active filter as a chip in the bar, Turbo and position included', () => {
  const html = renderToStaticMarkup(
    <FilterBar
      view={{ ...view, includeTurbo: true, position: 3, hero: 33 }}
      change={change}
      heroes={heroes}
      heroIds={[33, 62]}
      patches={[]}
      shown={44}
      loaded={100}
      withoutPosition={9}
    />,
  );
  for (const chip of ['Turbo included', 'Off Lane', 'Enigma'])
    expect(html).toContain(`aria-label="Clear filter: ${chip}"`);
  expect(html).toContain('44 of 100 loaded · 9 without position');
  const plain = renderToStaticMarkup(
    <FilterBar
      view={view}
      change={change}
      heroes={heroes}
      heroIds={[33]}
      patches={[]}
      shown={44}
      loaded={100}
      withoutPosition={0}
    />,
  );
  expect(plain).not.toContain('Clear filter');
  expect(plain).not.toContain('without position');
  // Turbo as set in Settings is the default, not a filter; leaving it is.
  const settingsTurbo = renderToStaticMarkup(
    <FilterBar
      view={{ ...view, includeTurbo: true }}
      change={change}
      heroes={heroes}
      heroIds={[33]}
      patches={[]}
      shown={44}
      loaded={100}
      withoutPosition={0}
      turboDefault
    />,
  );
  expect(settingsTurbo).not.toContain('Clear filter');
  const excluded = renderToStaticMarkup(
    <FilterBar
      view={view}
      change={change}
      heroes={heroes}
      heroIds={[33]}
      patches={[]}
      shown={44}
      loaded={100}
      withoutPosition={0}
      turboDefault
    />,
  );
  expect(excluded).toContain('aria-label="Clear filter: Turbo excluded"');
});

it('keeps rarely used filters in More, without a position select', () => {
  const html = renderToStaticMarkup(<MoreFilters view={view} change={change} patches={[]} />);
  for (const label of [
    'Profile modes',
    'Profile duration',
    'Profile time of day',
    'Profile day of week',
    'Profile patch',
  ])
    expect(html).toContain(`aria-label="${label}"`);
  expect(html).not.toContain('Profile position');
});

it('explains the colours: IMP bands and the win-rate rule', () => {
  const html = renderToStaticMarkup(<ColourLegend />);
  for (const text of ['≤ −41', '−40…−26', '−25…−11', '−10…+10', '+11…+25', '+26…+40', '≥ +41'])
    expect(html).toContain(text);
  expect(html).toContain('above 52%');
  expect(html).toContain('below 48%');
  expect(html).toContain('under 10 games');
});

const game = (id: number, position: number, win: boolean, hero = 33): Match => ({
  match_id: id,
  hero_id: hero,
  start_time: id * 3600,
  duration: 1800,
  player_slot: 0,
  radiant_win: win,
  position: `POSITION_${position}`,
});

it('heads each position card with the MMR change when measured, otherwise the win rate', () => {
  const matches = [
    ...Array.from({ length: 6 }, (_, i) => game(i + 1, 3, i < 4, [33, 62, 7, 8][i % 4])),
    ...Array.from({ length: 10 }, (_, i) => game(i + 20, 4, i < 7)),
  ];
  const ratings = new Map([
    [1, { mmr: 4025, delta: 25 }],
    [2, { mmr: 4050, delta: 25 }],
  ]);
  const measured = renderToStaticMarkup(
    <PositionCards matches={matches} ratings={ratings} view={view} change={change} heroes={heroes} measured />,
  );
  expect(measured).toContain('+50');
  // The big number says what it is.
  expect(measured).toMatch(/\+50<\/span><small>MMR<\/small>/);
  const plain = renderToStaticMarkup(
    <PositionCards matches={matches} ratings={ratings} view={view} change={change} heroes={heroes} measured={false} />,
  );
  // Six games: grey. Ten games at 70%: green.
  expect(plain).toContain('<span class="wr-few">67%</span>');
  expect(plain).toContain('<span class="wr-good">70%</span>');
  expect(plain).not.toContain('+50');
  expect(plain).toMatch(/70%<\/span><small>win rate<\/small>/);
  // Record in words, then at most three heroes, each with its number of games.
  const offLane = plain.slice(plain.indexOf('Off Lane'), plain.indexOf('Soft Support'));
  expect(offLane.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).toContain('4W 2L · 6 games');
  expect(offLane.match(/class="profile-position-hero"/g)?.length).toBe(3);
  expect(offLane.match(/<b>(\d+)<\/b>/g)).toEqual(['<b>2</b>', '<b>2</b>', '<b>1</b>']);
});
