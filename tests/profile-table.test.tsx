import { expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HeroAverageRow, LineupEntry, Match } from '../src/shared/domain';
import { matchRanking } from '../src/shared/match-rank';
import { ProfileTable } from '../src/ui/profile/ProfileTable';
import { defaultProfileView } from '../src/ui/profile/profile-view';
import { StatCard } from '../src/ui/Tips';

vi.mock('../src/ui/MatchScreen', () => ({
  Portrait: () => <span className="portrait" />,
  RankMedal: ({ tier }: { tier?: number | null }) => <span className={`medal medal-${tier}`} />,
}));

const text = (html: string) => html.replace(/<[^>]+>/g, '');
const heroes = [{ id: 33, localized_name: 'Enigma', primary_attr: 'int', attack_type: 'Ranged', roles: [] }];
const lineup: LineupEntry[] = Array.from({ length: 10 }, (_, i) => ({
  radiant: i < 5,
  own: i === 2,
  hero_id: i === 2 ? 33 : 100 + i,
  kills: i === 2 ? 4 : 3,
  deaths: i === 2 ? 11 : i,
  assists: i === 2 ? 2 : 10,
  position: `POSITION_${(i % 5) + 1}`,
}));
const enigma: Match = {
  match_id: 9001,
  hero_id: 33,
  start_time: 1_790_000_000,
  duration: 30 * 60 + 19,
  player_slot: 0,
  radiant_win: false,
  position: 'POSITION_3',
  kills: 4,
  deaths: 11,
  assists: 2,
  team_kills: 20,
  last_hits: 135,
  denies: 12,
  gold_per_min: 399,
  xp_per_min: 325,
  hero_damage: 9800,
  imp: -44,
  average_rank: 75,
  lineup,
};
const average: HeroAverageRow = {
  heroId: 33,
  position: 3,
  time: 30,
  matchCount: 400,
  kills: 6,
  deaths: 5.6,
  assists: 14,
  goldPerMinute: 450,
  xp: 18000,
  cs: 160,
  heroDamage: 21000,
  networth: 15000,
  killContribution: 25,
};
const view = defaultProfileView({ mode: 'normal', rankedOnly: true });
const table = (rows: Match[], extra: Partial<Parameters<typeof ProfileTable>[0]> = {}) =>
  renderToStaticMarkup(
    <ProfileTable
      rows={rows}
      heroes={heroes}
      ratings={new Map()}
      view={view}
      change={() => {}}
      measured={false}
      onSelect={() => {}}
      averages={(hero, bracket) => (hero === 33 && bracket === 'DIVINE_IMMORTAL' ? [average] : undefined)}
      {...extra}
    />,
  );

it('says in one line why a statistic has its colour', () => {
  const html = renderToStaticMarkup(
    <StatCard
      label="Deaths"
      value="11"
      band={1}
      average="5.6"
      heroName="Enigma"
      position={3}
      ranking={matchRanking(enigma, 'deaths')}
      format={String}
      heroOf={(id) => heroes.find((hero) => hero.id === id)}
    />,
  );
  expect(text(html)).toContain('Bad · 11 vs 5.6 avg Enigma Off Lane');
  expect(html.match(/<li[ >]/g)?.length).toBe(10);
  // Title with the value on the right; each player numbered by hero name, the owner as "You".
  expect(html).toContain('tip-title-value');
  expect(text(html)).toMatch(/1\. You|\d\. You/);
  expect(text(html)).toMatch(/\d+\. Enigma|\d+\. Hero #/);
  expect(html).not.toContain('match-rank-bar');
  for (const noise of ['in this match', 'percentile', 'OpenDota', 'of 10']) expect(text(html)).not.toContain(noise);
});

it('colours statistics against the bracket average of the hero on its position', () => {
  const html = table([enigma]);
  // 11 deaths against 5.6: about twice, bad. 2 assists against 14: terrible. KP 30% against
  // 25%: above typical.
  expect(html).toMatch(/class="stat-band-1"[^>]*>11</);
  expect(html).toMatch(/class="stat-band-0"[^>]*>2</);
  expect(html).toMatch(/class="stat-band-4"[^>]*>30%</);
  // Unknown position: the same numbers stay white.
  const unknown = table([{ ...enigma, position: null }]);
  expect(unknown).not.toContain('stat-band-');
});

it('shows the bracket of the match with its medal', () => {
  expect(table([enigma])).toContain('medal-75');
  expect(text(table([enigma]))).toContain('Divine 5');
  // A rank STRATZ rounded to a medal without stars.
  const rounded = text(table([{ ...enigma, average_rank: 70 }]));
  expect(rounded).toContain('Divine');
  expect(rounded).not.toContain('Divine 0');
  const none = table([{ ...enigma, average_rank: undefined }]);
  expect(none).not.toContain('medal-');
  // Before STRATZ ranks it: the median medal seen in the live match.
  const live = table([{ ...enigma, average_rank: undefined, medal_rank: 54 }]);
  expect(live).toContain('medal-54');
  expect(text(live)).toContain('Legend 4');
});

it('colours a just-recorded match from its queue position and live medal before details arrive', () => {
  const html = table([
    {
      ...enigma,
      position: undefined,
      queue_position: 3,
      average_rank: undefined,
      medal_rank: 75,
      lineup: undefined,
      imp: undefined,
      recorded: true,
      local_only: true,
    },
  ]);
  expect(html).toMatch(/class="stat-band-1"[^>]*>11</);
  expect(html).toMatch(/class="stat-band-0"[^>]*>2</);
  expect(html).toContain('medal-75');
});

it('shows MMR as value then change, and only when measured', () => {
  const ratings = new Map([[9001, { mmr: 4380, delta: 24 }]]);
  const html = table([enigma], { ratings, measured: true });
  expect(text(html)).toContain('4,380 (+24)');
  // As in the mockup: the change is green or red inside grey brackets.
  expect(html).toMatch(/<small class="profile-mmr-change">\(<span class="green">\+24<\/span>\)<\/small>/);
  expect(html).toContain('data-column="mmr"');
  expect(table([enigma])).not.toContain('data-column="mmr"');
});

it('renders a match recorded only from the game with dashes and no cards', () => {
  const html = table([
    {
      match_id: 7,
      hero_id: 33,
      start_time: 1_790_000_000,
      duration: 1500,
      player_slot: 0,
      radiant_win: true,
      local_only: true,
    },
  ]);
  const row = html.slice(html.indexOf('<tbody'));
  expect(row.match(/—/g)?.length).toBeGreaterThanOrEqual(8);
  expect(row.match(/data-tip/g)?.length ?? 0).toBeLessThanOrEqual(2);
});

it('hides optional columns and shows Mode only for all modes', () => {
  const html = table([enigma], { view: { ...view, columns: { xpm: false, damage: true, lhdn: true } } });
  expect(html).not.toContain('data-column="xp_per_min"');
  expect(html).toContain('data-column="hero_damage"');
  expect(html).not.toContain('data-column="mode"');
  expect(table([enigma], { view: { ...view, modes: 'all' } })).toContain('data-column="mode"');
});
