import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CounterTip, FrequentHeroTip, MatchupTip, MetaTip, RoleTip, SuggestionTip } from '../src/ui/Tips';
import type { Hero } from '../src/shared/domain';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));
const hero = (id: number, name: string): Hero => ({
  id,
  localized_name: name,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: [],
});
const lich = hero(31, 'Lich'),
  spectre = hero(67, 'Spectre');

it('explains a guessed role row by row', () => {
  const html = renderToStaticMarkup(
    <RoleTip
      role={{ position: 5, guessed: true, player: { games: 59, known: 59 }, hero: { share: 0.69 } }}
      heroName="Lich"
      days={14}
    />,
  );
  expect(html).toContain('Hard Support<span class="tip-tag">Likely</span>');
  expect(html).toContain('<dt>Player, last 14 days</dt><dd>59 of 59 games</dd>');
  expect(html).toContain('<dt>Lich in this role</dt><dd>69% of games</dd>');
  expect(html).toContain('Guessed for the whole team');
  const known = renderToStaticMarkup(<RoleTip role={{ position: 1, guessed: false }} days={14} />);
  expect(known).not.toContain('tip-tag');
  expect(known).toContain('Selected in the draft');
  const hidden = renderToStaticMarkup(<RoleTip role={{ position: 3, guessed: true }} days={7} />);
  expect(hidden).toContain('<dt>Player, last 7 days</dt><dd>Private or no games</dd>');
});

it('shows a matchup as both heroes and the signed advantage', () => {
  const html = renderToStaticMarkup(<MatchupTip radiant={lich} dire={spectre} value={0.42} note="STRATZ" />);
  expect(html).toMatch(/Lich<span class="tip-vs">vs<\/span>.*Spectre/);
  expect(html).toContain('<b class="tip-positive">+0.42 pp</b>for Radiant');
  expect(html).toContain('STRATZ');
  const dire = renderToStaticMarkup(<MatchupTip radiant={lich} dire={spectre} value={-1.5} note="" />);
  expect(dire).toContain('<b class="tip-negative">+1.5 pp</b>for Dire');
  const none = renderToStaticMarkup(<MatchupTip radiant={lich} note="" />);
  expect(none).toContain('Not enough data');
});

it('lists a frequent hero with games, win rate and its spam note', () => {
  const html = renderToStaticMarkup(
    <FrequentHeroTip hero={lich} games={20} wins={11} pool="Recent spam: 5 of the last 5 games" />,
  );
  expect(html).toContain('<dt>Games</dt><dd>20</dd>');
  expect(html).toContain('<dt>Win rate</dt><dd><span class="tip-positive">55%</span></dd>');
  expect(html).toContain('Recent spam: 5 of the last 5 games');
});

it('breaks a suggestion score into its parts', () => {
  const html = renderToStaticMarkup(
    <SuggestionTip
      row={{ hero: lich, score: 1.13, base: 51.2, counter: 0.8, synergy: 0.5, games: 12000, coverage: 4, expected: 5 }}
      weight={60}
    />,
  );
  expect(html).toContain('<b class="tip-positive">+1.13</b>advantage');
  expect(html).toContain('<dt>Against opponents</dt><dd>+0.8</dd>');
  expect(html).toContain('<dt>With allies (60%)</dt><dd>+0.5</dd>');
  expect(html).toContain('<dt>Known pairs</dt><dd>4 of 5</dd>');
});

it('marks a banned meta pick and shows a counter against its enemy', () => {
  const meta = renderToStaticMarkup(
    <MetaTip pick={{ hero: lich, winRate: 53.5, games: 9000, wins: 4815, banned: true }} note="STRATZ" />,
  );
  expect(meta).toContain('Lich<span class="tip-tag">Banned</span>');
  expect(meta).toContain('<dt>Matches in this role</dt><dd>9,000</dd>');
  const counter = renderToStaticMarkup(<CounterTip hero={lich} enemy={spectre} advantage={1.25} multiple />);
  expect(counter).toContain('<b class="tip-positive">+1.25 pp</b>against Spectre');
  expect(counter).toContain('Also counters other enemy heroes');
});
