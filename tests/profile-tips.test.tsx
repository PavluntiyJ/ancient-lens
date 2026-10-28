import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MmrPointTip } from '../src/ui/Tips';
import { matchRanking } from '../src/shared/match-rank';
import type { Hero, Match } from '../src/shared/domain';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));
const lich: Hero = { id: 31, localized_name: 'Lich', primary_attr: 'int', attack_type: 'Ranged', roles: [] };

it('shows a rating measurement with its change, source and match', () => {
  const at = Date.UTC(2026, 9, 20, 18, 30) / 1000;
  const match: Match = {
    match_id: 9,
    hero_id: 31,
    start_time: at - 2400,
    duration: 1800,
    player_slot: 0,
    radiant_win: true,
  };
  const html = renderToStaticMarkup(
    <MmrPointTip point={{ value: 3025, at, source: 'dota-memory', delta: 25 }} match={match} hero={lich} />,
  );
  expect(html).toContain('<b>3,025</b><span class="tip-positive">+25 since the previous</span>');
  expect(html).toContain('<dt>Source</dt><dd>Measured from the game</dd>');
  expect(html).toMatch(
    /<dt>After match<\/dt><dd><span class="tip-match"><span class="portrait"><\/span>Lich<b class="tip-positive">Win<\/b>/,
  );
  const manual = renderToStaticMarkup(<MmrPointTip point={{ value: 3000, at, source: 'manual' }} />);
  expect(manual).toContain('<span class="tip-tag">Manual</span>');
  expect(manual).toContain('first measurement');
  expect(manual).not.toContain('After match');
});
