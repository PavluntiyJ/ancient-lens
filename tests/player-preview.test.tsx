import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerPreview } from '../src/ui/PlayerPreview';
import { meetings } from '../src/shared/meetings';
import type { Hero, Match, PlayerSummary } from '../src/shared/domain';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));
vi.mock('../src/ui/MatchScreen', () => ({
  Avatar: () => <span className="avatar" />,
  Portrait: ({ hero }: { hero?: { id: number } }) => <i data-hero={hero?.id} />,
}));
const heroes: Hero[] = [5, 14].map((id) => ({
  id,
  localized_name: `Hero ${id}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: [],
}));
const game = (id: number, won: boolean, extra: Partial<Match> = {}): Match => ({
  match_id: id,
  hero_id: 14,
  start_time: 1_700_000_000 + id * 3600,
  duration: 1800,
  player_slot: 0,
  radiant_win: won,
  kills: id,
  deaths: 2,
  assists: 6,
  position: 'POSITION_3',
  ...extra,
});
const summary = (matches: Match[], extra: Partial<PlayerSummary> = {}): PlayerSummary => ({
  accountId: '55',
  fetchedAt: '2026-10-27T00:00:00Z',
  source: 'STRATZ',
  days: 14,
  isPublic: true,
  profile: { rank_tier: 54, profile: { account_id: 55 } },
  matches,
  heroes: [],
  limited: false,
  stale: false,
  ...extra,
});

it('shows the six newest matches with result, K/D/A and the period summary', () => {
  const matches = Array.from({ length: 12 }, (_, i) => game(i + 1, i % 3 !== 0));
  const html = renderToStaticMarkup(
    <PlayerPreview name="Kestrel" summary={summary(matches)} met={null} heroes={heroes} />,
  );
  const rows = html.split('<li>').slice(1);
  expect(rows).toHaveLength(6);
  expect(rows[0]).toContain('12/2/6');
  expect(rows[5]).toContain('7/2/6');
  expect(html).toMatch(/Kestrel.*Legend 4/s);
  expect(html).toContain('12 matches · 14 days');
  expect(html).toContain('67%');
  expect(html).toContain('Click for the full card');
  const linked = renderToStaticMarkup(
    <PlayerPreview name="Kestrel" summary={summary(matches)} met={null} heroes={heroes} onMatch={() => {}} />,
  );
  expect(linked).toContain('Click a match for STRATZ, elsewhere for the full card');
  expect(linked).not.toContain('Add note');
  const editable = renderToStaticMarkup(
    <PlayerPreview accountId="55" name="Kestrel" summary={summary(matches)} met={null} heroes={heroes} />,
  );
  expect(editable).toContain('Add note');
});

it('keeps the note and earlier meetings for a private profile', () => {
  const met = meetings([game(1, true, { allies: [{ id: 55, hero: 5 }] })], '55');
  const html = renderToStaticMarkup(
    <PlayerPreview
      name="Kestrel"
      summary={summary([], { isPublic: false })}
      note={{ accountId: '55', name: '', text: 'Feeds mid', tag: 'avoid', updatedAt: '' }}
      met={met}
      heroes={heroes}
    />,
  );
  expect(html).toContain('Feeds mid');
  expect(html).toContain('tag-avoid');
  expect(html).toContain('Met 1: as ally 1–0');
  expect(html).toContain('Match data is hidden');
  expect(html).not.toContain('<li>');
});

it('says so while statistics are not loaded', () => {
  const html = renderToStaticMarkup(<PlayerPreview name="Kestrel" met={null} heroes={heroes} />);
  expect(html).toContain('Statistics are not loaded');
});
