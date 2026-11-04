import { describe, expect, it } from 'vitest';
import fixtures from './fixtures/item-drafts.json';
import { itemContext, parseItemData, rankItems, type ItemContext } from '../src/shared/item-build';
import type { LiveState } from '../src/shared/domain';

const data = () => parseItemData(structuredClone(fixtures.stats['8']), 8);
const draft = (index = 0): ItemContext => fixtures.drafts[index];

describe('historical item recommendations', () => {
  it('changes recommendations when Necrophos leaves the enemy draft without refetching the sample', () => {
    const stats = data();
    expect(rankItems(stats, draft())[0].item.name).toBe('skadi');
    expect(rankItems(stats, draft())[0].enemyCoverage).toBe(3);
    const changed = rankItems(stats, draft(1));
    expect(changed[0].item.name).toBe('monkey_king_bar');
    expect(changed.some((r) => r.item.name === 'nullifier')).toBe(false);
  });
  it('limits both positive and negative ally contributions to half of the enemy signal', () => {
    const stats = data();
    for (const win of [50, 10]) {
      stats.pairs
        .filter((p) => p.relation === 'ally')
        .forEach((p) => {
          p.withWins = win;
        });
      for (const option of rankItems(stats, draft())) {
        expect(Math.abs(option.ally)).toBeLessThanOrEqual(Math.abs(option.enemy) * 0.5);
        expect(option.score).toBeGreaterThan(0);
      }
    }
  });
  it('does not create recommendations from ally evidence alone or count duplicate picks twice', () => {
    const ctx = { ...draft(), enemies: [69] };
    expect(rankItems(data(), ctx)).toEqual([]);
    expect(rankItems(data(), { ...draft(), enemies: [] })).toEqual([]);
    const before = rankItems(data(), draft());
    expect(rankItems(data(), { ...draft(), enemies: [...draft().enemies, 36] })).toEqual(before);
  });
  it('reduces partial coverage and refuses sparse/absent groups instead of inventing win rates', () => {
    const stats = data();
    const one = rankItems(stats, { heroId: 8, allies: [], enemies: [36] });
    const five = rankItems(stats, { heroId: 8, allies: [], enemies: [36, 17, 13, 41, 69] });
    expect(five[0].enemy).toBeCloseTo(one[0].enemy / 5);
    expect(five[0].enemyCoverage).toBe(1);
    stats.pairs[0].withGames = 9;
    stats.pairs[0].withWins = 8;
    expect(rankItems(stats, draft()).some((r) => r.item.name === 'nullifier')).toBe(false);
    expect(rankItems(parseItemData(fixtures.stats['106'], 106), draft(2))).toEqual([]);
    expect(rankItems(data(), { ...draft(), heroId: 106 })).toEqual([]);
  });
  it('subtracts the general purchase advantage rather than simply choosing the highest item win rate', () => {
    const stats = data();
    // Exactly the same 60%/45.7% purchase contrast inside and outside the matchup.
    stats.pairs = [
      { itemId: 225, otherHeroId: 36, relation: 'enemy', games: 1000, wins: 500, withGames: 300, withWins: 180 },
    ];
    // No outside comparator is available, so there is no matchup evidence.
    expect(rankItems(stats, draft())).toEqual([]);
    stats.pairs[0] = { ...stats.pairs[0], games: 500, wins: 250, withGames: 150, withWins: 90 };
    expect(rankItems(stats, draft())).toEqual([]);
  });
  it('rejects impossible counts, wrong heroes, duplicate pairs and unsafe image slugs', () => {
    expect(() => parseItemData(fixtures.stats['8'], 106)).toThrow();
    for (const change of [
      (d: ReturnType<typeof data>) => {
        d.items[0].name = '../bad';
      },
      (d: ReturnType<typeof data>) => {
        d.pairs[0].withWins = 81;
      },
      (d: ReturnType<typeof data>) => {
        d.pairs[0].games = 999;
      },
      (d: ReturnType<typeof data>) => {
        d.pairs.push(d.pairs[0]);
      },
    ]) {
      const bad = data();
      change(bad);
      expect(() => parseItemData(bad, 8)).toThrow();
    }
  });
});

it('binds to YOU and the confirmed own pick, including anonymous drafts; ignores hovers and spectators', () => {
  const now = 1000;
  const live: LiveState = {
    status: 'connected',
    receivedAt: now,
    mode: 'player',
    matchId: 'item-fixture',
    gameState: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
    draftStatus: 'ready',
    selfTeamSlot: 0,
    players: [{ key: 'self', team: 'dire' }],
    draft: {
      source: 'native',
      matchId: 'item-fixture',
      observedAt: now,
      gameState: 'DOTA_GAMERULES_STATE_HERO_SELECTION',
      slots: [
        { slot: 5, team: 'dire', teamSlot: 0 },
        { slot: 0, team: 'radiant', teamSlot: 0 },
      ],
      picks: [
        { slot: 5, team: 'dire', heroId: 8 },
        { slot: 0, team: 'radiant', heroId: 36 },
      ],
    },
  };
  expect(itemContext(live, '1001', true, now)).toEqual({ heroId: 8, enemies: [36], allies: [] });
  expect(itemContext({ ...live, mode: 'spectator' }, '1001', true, now)).toBeUndefined();
  expect(itemContext(live, '1001', false, now)).toBeUndefined();
  live.draft!.picks.shift();
  live.draft!.hovers = [{ slot: 5, team: 'dire', heroId: 8 }];
  expect(itemContext(live, '1001', true, now)).toBeUndefined();
});

it('keeps the standard build independent of matchup coverage, including sparse Ember data', () => {
  const stats = data();
  const original = structuredClone(stats.standardBuilds);
  rankItems(stats, draft());
  rankItems(stats, draft(1));
  expect(stats.standardBuilds).toEqual(original);
  const sparse = parseItemData(fixtures.stats['106'], 106);
  expect(sparse.standardBuilds[0].items).toHaveLength(6);
  expect(rankItems(sparse, draft(2))).toEqual([]);
});
it('offers different utility items to the same offlaner as the enemy draft changes', () => {
  const stats = parseItemData(fixtures.stats['2'], 2);
  expect(rankItems(stats, draft(3))[0].item.name).toBe('pipe');
  expect(rankItems(stats, draft(4))[0].item.name).toBe('lotus_orb');
  expect(stats.standardBuilds[0].items.map((i) => i.name)).toContain('blink');
});

it('accepts up to three distinct observed sets and rejects invented alternative counts', () => {
  expect(data().standardBuilds).toHaveLength(3);
  for (const change of [
    (d: ReturnType<typeof data>) => {
      d.standardBuilds[1] = structuredClone(d.standardBuilds[0]);
    },
    (d: ReturnType<typeof data>) => {
      d.standardBuilds[1].matches = 1;
    },
    (d: ReturnType<typeof data>) => {
      d.standardBuilds[0].wins = d.standardBuilds[0].matches + 1;
    },
    (d: ReturnType<typeof data>) => {
      d.standardBuilds[1].matches = d.sampleMatches;
    },
    (d: ReturnType<typeof data>) => {
      d.standardBuilds[0].items = d.standardBuilds[0].items.slice(0, 3);
    },
  ]) {
    const bad = data();
    change(bad);
    expect(() => parseItemData(bad, 8)).toThrow();
  }
  const only = data();
  only.standardBuilds = only.standardBuilds.slice(0, 1);
  expect(parseItemData(only, 8).standardBuilds).toHaveLength(1);
});
