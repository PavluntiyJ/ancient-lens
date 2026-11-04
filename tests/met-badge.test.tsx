import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MetBadge } from '../src/ui/Meetings';
import { meetings } from '../src/shared/meetings';
import type { Match } from '../src/shared/domain';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));
vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => null }));

const game = (id: number, radiant_win: boolean | null, side: 'allies' | 'enemies'): Match => ({
  match_id: id,
  hero_id: 1,
  start_time: 1_700_000_000 + id,
  duration: 1800,
  player_slot: 0,
  radiant_win,
  [side]: [{ id: 55 }],
});

it('says wins and losses of meetings only for known results', () => {
  const met = meetings([game(1, true, 'allies'), game(2, null, 'allies'), game(3, false, 'enemies')], '55');
  const html = renderToStaticMarkup(<MetBadge met={met} heroes={[]} />);
  expect(html).toContain('as ally 2 (1–0), as opponent 1 (0–1)');
  // The badge's rate leaves the unknown result out too.
  expect(html).toContain('>50%<');
});
