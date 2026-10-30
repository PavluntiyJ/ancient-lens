import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlayerPreview } from '../src/ui/PlayerPreview';
import { meetings } from '../src/shared/meetings';
import type { Hero, Match, PlayerSummary } from '../src/shared/domain';

vi.mock('../src/ui/App', () => ({ api: {}, errorMessage: String }));
vi.mock('../src/ui/MatchScreen', () => ({
  Avatar: () => <span className="avatar" />,
  CountryFlag: () => null,
  RankMedal: ({ tier }: { tier?: number | null }) => <span data-tier={tier} />,
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

it('lists every period match newest first with result, K/D/A and how long ago, beside the facts', () => {
  const matches = Array.from({ length: 12 }, (_, i) => game(i + 1, i % 3 !== 0));
  const now = (1_700_000_000 + 13 * 3600) * 1000;
  const html = renderToStaticMarkup(
    <PlayerPreview
      name="Kestrel"
      summary={summary(matches)}
      total={{ games: 4512, wins: 2346 }}
      met={null}
      heroes={heroes}
      now={now}
    />,
  );
  const rows = html.split('<li class=').slice(1);
  expect(rows).toHaveLength(12);
  expect(rows[0]).toContain('12/2/6');
  expect(rows[0]).toContain('Won');
  expect(rows[0]).toContain('30 min ago');
  expect(rows[11]).toContain('1/2/6');
  expect(html).toContain('4,512 matches');
  expect(html).toContain('52%');
  expect(html).toContain('data-tier="54"');
  expect(html).toMatch(/<dt>Last 14 days<\/dt><dd>12 · <span class="green">67%<\/span>/);
  // Newest first: match 12 won (12 % 3 !== 0 was index 11), then index 10 won, index 9 lost.
  expect(html).toMatch(/<dt>Streak<\/dt><dd><span class="green">2 wins<\/span>/);
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
  expect(editable).toContain('Dotabuff');
});

it('keeps the note and earlier meetings for a private profile, with unknowns as dashes', () => {
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
  expect(html).not.toContain('tag-avoid');
  expect(html).toMatch(/<dt>With me<\/dt><dd>1 · <span class="green">100%<\/span>/);
  expect(html).toContain('Match data is hidden');
  expect(html).toContain('Private profile');
  expect(html).toMatch(/<dt>Country<\/dt><dd><span class="muted">—<\/span>/);
  // No own matches of theirs, but the match together from the own history is listed.
  expect(html).not.toContain('Recent matches<');
  expect(html).toContain('Matches with / against me');
  const rows = html.split('<li class=').slice(1);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toContain('Ally');
  expect(rows[0]).toContain('1/2/6');
  expect(rows[0]).toContain('We won');
});

it('names this match role and the reason a profile failed', () => {
  const html = renderToStaticMarkup(
    <PlayerPreview
      name="Kestrel"
      role={{ position: 3, guessed: true }}
      error="The service did not return a player profile."
      met={null}
      heroes={heroes}
    />,
  );
  expect(html).toContain('Off Lane · most probable position');
  expect(html).toContain('Could not load: The service did not return a player profile.');
  expect(html).toContain('No profile data');
});
