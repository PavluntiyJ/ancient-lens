import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HeroMatchups } from '../src/ui/DraftPanels';
import { visibleDraftSlots } from '../src/shared/live-draft';
import type { LiveState } from '../src/shared/domain';
import type { DraftData } from '../src/shared/draft';

vi.mock('../src/ui/MatchScreen', () => ({ Portrait: () => <span className="portrait" /> }));
const phase = 'DOTA_GAMERULES_STATE_HERO_SELECTION';
const live: LiveState = {
  status: 'connected',
  receivedAt: 1000,
  mode: 'player',
  matchId: '123',
  gameState: phase,
  draftStatus: 'ready',
  draft: {
    source: 'native',
    observedAt: 1000,
    matchId: '123',
    gameState: phase,
    picks: [{ slot: 0, team: 'radiant', heroId: 1 }],
    hovers: [{ slot: 5, team: 'dire', heroId: 2 }],
    slots: [
      { slot: 0, team: 'radiant', teamSlot: 4 },
      { slot: 5, team: 'dire', teamSlot: 3 },
    ],
  },
};
const data: DraftData = {
  source: 'STRATZ',
  fetchedAt: '',
  positions: [],
  matchups: [1, 2].map((heroId) => ({
    heroId,
    with: [],
    vs: [
      {
        heroId1: heroId,
        heroId2: heroId === 1 ? 2 : 1,
        matchCount: 1000,
        winCount: 500,
        synergy: heroId === 1 ? -6 : 6,
      },
    ],
  })),
};
it('renders a fixed 5 by 5 matrix with two heroes at their team slots', () => {
  const slots = visibleDraftSlots(live, true, 1001);
  const html = renderToStaticMarkup(<HeroMatchups {...slots} heroes={[]} data={data} />);
  expect(html.match(/class="matchup-cell /g)).toHaveLength(25);
  // The cell shows the winning hero; the number lives in the tooltip and the totals.
  expect(html).not.toContain('matchup-value');
  expect(html.match(/class="matchup-cell dire/g)).toHaveLength(1);
  expect(html).toMatch(/class="matrix-total dire"[^>]*>.*Dire.*\+2\.6/);
  expect(html.match(/scope="col"/g)).toHaveLength(5);
  expect(html.match(/scope="row"/g)).toHaveLength(5);
  expect(html).toContain('draft-hover');
  expect(html).toContain('hovered');
  expect(html.indexOf('data-hero-id="2"')).toBeGreaterThan(html.indexOf('matrix-empty'));
});
it('keeps all 25 placeholders when no heroes are known or a hover is banned', () => {
  const empty = renderToStaticMarkup(<HeroMatchups radiant={[]} dire={[]} heroes={[]} />);
  expect(empty.match(/class="matchup-cell /g)).toHaveLength(25);
  const slots = visibleDraftSlots({ ...live, draft: { ...live.draft!, bans: [2] } }, true, 1001);
  const html = renderToStaticMarkup(<HeroMatchups {...slots} heroes={[]} data={data} />);
  expect(html.match(/class="matchup-cell /g)).toHaveLength(25);
  expect(html).not.toMatch(/class="matchup-cell (radiant|dire)/);
  expect(html).not.toContain('data-hero-id="2"');
  expect(empty).toMatch(/class="matrix-total neutral"/);
});
it('shows the winner even for a small advantage, never a placeholder dot', () => {
  const slots = visibleDraftSlots(live, true, 1001);
  const weak = structuredClone(data);
  weak.matchups.forEach((row) => (row.vs[0]!.synergy = row.heroId === 1 ? -0.5 : 0.5));
  const html = renderToStaticMarkup(<HeroMatchups {...slots} heroes={[]} data={weak} />);
  expect(html.match(/class="matchup-cell dire/g)).toHaveLength(1);
  expect(html).not.toContain('matchup-even');
});
it('never shows a sign on an axis total that rounds to zero', () => {
  const slots = visibleDraftSlots(live, true, 1001);
  const tiny = structuredClone(data);
  tiny.matchups.forEach((row) => (row.vs[0]!.synergy = row.heroId === 1 ? -0.04 : 0.04));
  const html = renderToStaticMarkup(<HeroMatchups {...slots} heroes={[]} data={tiny} />);
  expect(html).not.toMatch(/[−+-]0</);
  expect(html.match(/class="matchup-cell neutral/g)).toHaveLength(1);
});
it('describes a pair as even exactly where the tint turns grey', () => {
  const slots = visibleDraftSlots(live, true, 1001);
  const label = (synergy: number) => {
    const input = structuredClone(data);
    // Shrinkage scales the raw value; 1000 games with k=1300 keep 1000/2300 of it.
    input.matchups.forEach((row) => (row.vs[0]!.synergy = row.heroId === 1 ? -synergy : synergy));
    const html = renderToStaticMarkup(<HeroMatchups {...slots} heroes={[]} data={input} />);
    const known = [...html.matchAll(/class="matchup-cell (\w+)[^"]*"[^>]*aria-label="([^"]+)"/g)].find(
      (cell) => cell[1] !== 'unknown',
    )!;
    return known.slice(1);
  };
  const [tone, text] = label(0.19 * 2.3);
  expect(tone).toBe('neutral');
  expect(text).toContain('Even · Dire +0.19');
  const [strongTone, strongText] = label(0.3 * 2.3);
  expect(strongTone).toBe('dire');
  expect(strongText).not.toContain('Even');
});
