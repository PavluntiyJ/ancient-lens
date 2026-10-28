import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { OwnRating } from '../src/ui/OwnRating';
import type { LocalState } from '../src/shared/domain';

vi.mock('../src/ui/MatchScreen', () => ({ RankMedal: () => <span className="medal" /> }));
const rank = { tier: 80, leaderboard: null, source: 'test' };
const snapshot = {
  mmr: 6315,
  confidence: 30,
  behaviorScore: 10473,
  communicationScore: 9296,
  confirmedAt: '2026-10-19T00:58:00.000Z',
};
const base: LocalState = { accountId: '123', notes: [], mmr: [], ratingSnapshot: snapshot };
const render = (local: LocalState) => renderToStaticMarkup(<OwnRating local={local} rank={rank} />);

describe('own rating block', () => {
  it('keeps the last saved reading visible and marked while Dota is closed', () => {
    const html = render({
      ...base,
      ownAccount: {
        accountId: '123',
        status: 'waiting-game',
        source: 'steam',
        observedAt: new Date().toISOString(),
        mmr: null,
        confidence: null,
        behaviorScore: null,
        communicationScore: null,
      },
    });
    expect(html).toContain('own-rating saved');
    expect(html).toContain('6,315');
    expect(html).toContain('10,473');
    expect(html).toContain('9,296');
    // Where the numbers come from is on hover; routine states take no room in the header.
    expect(html).toMatch(/title="Saved from Dota 2 · [^"]+"/);
    expect(html).not.toContain('own-rating-status');
    expect(html).not.toContain('Start Dota 2');
    expect(html).not.toContain('Rank unavailable');
  });

  it('prefers a fresh live reading over the saved one', () => {
    const html = render({
      ...base,
      ownAccount: {
        accountId: '123',
        status: 'measured',
        source: 'dota-memory',
        observedAt: new Date().toISOString(),
        mmr: 6340,
        confidence: 31,
        behaviorScore: 10500,
        communicationScore: 9300,
      },
    });
    expect(html).not.toContain('own-rating saved');
    expect(html).toContain('6,340');
    expect(html).not.toContain('6,315');
    // A working reading needs no status line and no manual entry.
    expect(html).not.toContain('updates automatically');
    expect(html).not.toContain('Dota 2 · live');
    expect(html).not.toContain('own-rating-status');
  });

  it('shows the status, and no manual entry, when the rating cannot be read', () => {
    const off = renderToStaticMarkup(
      <OwnRating
        local={{
          accountId: '123',
          notes: [],
          mmr: [],
          ownAccount: {
            accountId: '123',
            status: 'reader-off',
            source: 'steam',
            observedAt: new Date().toISOString(),
            mmr: null,
            confidence: null,
            behaviorScore: null,
            communicationScore: null,
          },
        }}
        rank={rank}
      />,
    );
    // A problem the player has to fix stays visible.
    expect(off).toContain('Dota memory reading is off');
    expect(off).not.toContain('Add MMR');
    // Nothing measured: the medal and rank name stand in for the number.
    expect(off).not.toContain('data-testid="own-mmr"');
    expect(off).toContain('Immortal');
  });

  it('says Uncalibrated instead of a dash while confidence is below 30%, as the game does', () => {
    const html = render({
      ...base,
      mmr: [{ id: 'm1', accountId: '123', source: 'dota-memory', value: 6215, createdAt: '2026-10-19T12:00:00.000Z' }],
      ownAccount: {
        accountId: '123',
        status: 'calibrating',
        source: 'dota-memory',
        observedAt: new Date().toISOString(),
        mmr: null,
        confidence: 28,
        behaviorScore: 10473,
        communicationScore: 9296,
      },
    });
    expect(html).toMatch(/data-testid="own-mmr"[^>]*>Uncalibrated</);
    expect(html).toContain('28%');
    expect(html).not.toContain('Last: 6,215');
    expect(html).not.toContain('Calibrating');
  });

  it('shows dashes without a live or saved reading', () => {
    const html = render({ ...base, ratingSnapshot: null });
    expect(html).toContain('>—<');
    expect(html).not.toContain('Behavior');
  });
});
