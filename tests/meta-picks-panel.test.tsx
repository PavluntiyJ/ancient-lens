import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetaPicks } from '../src/ui/MetaPicks';
import type { Hero } from '../src/shared/domain';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));
const hero = (id: number): Hero => ({
  id,
  localized_name: `Hero ${id}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: [],
});
it('strikes a banned meta pick through in place', () => {
  const pick = (id: number, banned: boolean) => ({ hero: hero(id), winRate: 55, games: 1000, wins: 550, banned });
  const html = renderToStaticMarkup(
    <MetaPicks rows={{ 1: [pick(1, true), pick(2, false)], 2: [], 3: [], 4: [], 5: [] }} />,
  );
  expect(html.indexOf('data-hero-id="1"')).toBeLessThan(html.indexOf('data-hero-id="2"'));
  expect(html.match(/class="meta-tile banned"/g)).toHaveLength(1);
  expect(html.match(/class="ban-portrait"/g)).toHaveLength(1);
  expect(html).toContain('Hero 1 · banned');
  expect(html).not.toContain('Hero 2 · banned');
});
