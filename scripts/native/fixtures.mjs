// Fixture data of the native scenarios: an isolated data folder with a state file of an older
// version and cached OpenDota resources, and a fake statistics service whose answers a scenario
// can switch (see `statisticsService`).
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const token = 'a'.repeat(64);

const portraitSlugs = [
  'antimage',
  'axe',
  'bane',
  'bloodseeker',
  'crystal_maiden',
  'drow_ranger',
  'earthshaker',
  'juggernaut',
  'mirana',
  'morphling',
  'nevermore',
  'phantom_lancer',
  'puck',
  'pudge',
  'razor',
  'sand_king',
  'storm_spirit',
  'sven',
  'tiny',
  'vengefulspirit',
  'windrunner',
  'zuus',
  'kunkka',
  'lina',
  'lion',
  'shadow_shaman',
  'slardar',
  'tidehunter',
  'witch_doctor',
  'lich',
  'riki',
  'enigma',
];
export const heroes = Array.from({ length: 32 }, (_, i) => ({
  id: i + 1,
  name: `npc_dota_hero_${portraitSlugs[i]}`,
  localized_name: `Hero ${i + 1}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: ['Initiator'],
}));

/** The isolated data folder: a state file of an older version (a note to migrate, three game
 * measurements) and cached OpenDota resources, so no request leaves the machine. */
export async function fixtureData() {
  const directory = await mkdtemp(join(tmpdir(), 'ancient-native-'));
  const cache = join(directory, 'cache');
  await mkdir(cache);
  await writeFile(
    join(directory, 'state.json'),
    JSON.stringify({
      version: 1,
      accountId: '1',
      token,
      notes: [
        {
          accountId: '1',
          name: 'Migration fixture',
          text: 'Keep this note',
          tag: 'teammate',
          updatedAt: new Date().toISOString(),
        },
      ],
      // Game measurements five minutes after fixture matches 1003, 1002 and 1001 ended.
      mmr: [
        [3000, 3],
        [3025, 2],
        [3010, 1],
      ].map(([value, hours], i) => ({
        id: `mmr-${i}`,
        accountId: '1',
        value,
        source: 'dota-memory',
        confidence: 100,
        createdAt: new Date(Date.now() - hours * 3600000 + 300000).toISOString(),
      })),
    }),
  );
  async function resource(endpoint, data) {
    await writeFile(
      join(cache, `resource-${createHash('sha256').update(endpoint).digest('hex')}.json`),
      JSON.stringify({ endpoint, at: Date.now(), data }),
    );
  }
  await resource('heroes', heroes);
  for (let id = 1; id <= 10; id++)
    await resource(
      `heroes/${id}/matchups`,
      heroes.map((h) => ({ hero_id: h.id, games_played: 100, wins: 40 })),
    );
  await resource('players/1', { rank_tier: 50, profile: { account_id: 1, personaname: 'My fixture profile' } });
  await resource('players/1/wl', { win: 60, lose: 40 });
  await resource('players/1/recentMatches', []);
  await resource('players/1/heroes', []);
  // OpenDota profiles for the country fallback: only player 4 has a location there, and every
  // shown player is cached so the fallback makes no network request.
  for (let id = 2; id <= 10; id++)
    await resource(`players/${id}`, { profile: { account_id: id, loccountrycode: id === 4 ? 'FI' : null } });
  return { directory, cache, releasesPath: join(directory, 'releases.json') };
}

/** The fake statistics service. `fx` holds what it was asked and how it answers next: the
 * request logs are arrays, the switches are fields a scenario sets (a refused warm-up, a slow
 * or malformed draft, a failing or private history, slow summaries). */
export async function statisticsService() {
  const fx = {
    batches: [],
    totalBatches: [],
    draftRequests: 0,
    draftBatches: [],
    // The match screen warms every hero at the draft start (draftWarmBatches) and then asks
    // only for missing heroes. A refused warm-up, as on a STRATZ quota, ends it, so the
    // per-pick request path stays testable; refused requests are not counted as draft requests.
    refuseWarmUp: false,
    refusedDrafts: [],
    delayDraft: false,
    malformedDraft: false,
    neutralDraft: false,
    hoverDraft: false,
    pendingDrafts: [],
    historyRequests: 0,
    // History pages per account: the profile window loads the own account at start.
    historyById: new Map(),
    failHistory: false,
    privateHistory: false,
    delaySummaries: false,
    pendingSummaries: [],
    partyRequests: [],
  };
  const {
    batches,
    totalBatches,
    draftBatches,
    refusedDrafts,
    pendingDrafts,
    historyById,
    pendingSummaries,
    partyRequests,
  } = fx;
  const service = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { ids, days, filter, id, offset, bracket = 'ALL' } = JSON.parse(body);
      // Parties of the roster: none recorded. Without this route the request fell through to
      // the summaries handler and counted as a profile batch once the roster settled.
      if (req.url === '/v1/parties') {
        partyRequests.push(ids);
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            source: 'STRATZ',
            fetchedAt: new Date().toISOString(),
            players: ids.map((accountId) => ({ accountId, matches: [] })),
          }),
        );
        return;
      }
      if (req.url === '/v1/history') {
        fx.historyRequests++;
        historyById.set(String(id), (historyById.get(String(id)) ?? 0) + 1);
        if (fx.failHistory) {
          res.writeHead(503).end('{}');
          return;
        }
        const start = offset ? 24 : 0;
        const matches = fx.privateHistory
          ? []
          : Array.from({ length: 25 }, (_, i) => ({
              match_id: 1000 + start + i,
              hero_id: (i % 2) + 1,
              start_time: Math.floor(Date.now() / 1000) - (start + i) * 3600 - 1800,
              duration: 1800,
              radiant_win: i % 2 === 0,
              player_slot: 0,
              kills: i % 2 ? null : 5,
              deaths: i % 4 === 0 ? null : 2,
              assists: 8,
              position: i % 6 === 0 ? null : `POSITION_${(i % 5) + 1}`,
              game_mode: i % 5 === 0 ? 23 : 22,
              lobby_type: 7,
              // The latest match carries all ten players for the ten-player card.
              ...(start + i === 0 && {
                position: 'POSITION_1',
                average_rank: 65,
                gold_per_min: 450,
                lineup: Array.from({ length: 10 }, (_, slot) => ({
                  radiant: slot < 5,
                  ...(slot === 0 ? { own: true } : slot === 3 ? {} : { id: 500 + slot }),
                  hero_id: slot === 0 ? 1 : (slot % 2) + 1,
                  ...(slot !== 7 && { gold_per_min: slot === 0 ? 450 : 300 + slot * 40 }),
                  position: `POSITION_${(slot % 5) + 1}`,
                })),
              }),
            }));
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            accountId: id,
            source: 'STRATZ',
            fetchedAt: new Date().toISOString(),
            profile: { rank_tier: 65, profile: { account_id: Number(id), personaname: 'My STRATZ profile' } },
            matches,
            hasMore: !offset && !fx.privateHistory,
            nextOffset: offset ? 50 : 25,
            stale: false,
            historyUnavailable: fx.privateHistory,
            warning: fx.privateHistory ? 'STRATZ history is private. Showing previously saved matches.' : null,
          }),
        );
        return;
      }
      if (req.url === '/v1/averages') {
        // Averages of the hero on each position: the latest match's 450 GPM is below 600.
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            source: 'STRATZ',
            fetchedAt: new Date().toISOString(),
            bracket,
            rows: ids.map((heroId) => ({
              heroId,
              position: 1,
              time: 30,
              matchCount: 400,
              kills: 5,
              deaths: 2,
              assists: 8,
              goldPerMinute: 600,
              xp: 18000,
              cs: 150,
              heroDamage: 20000,
              networth: 15000,
              killContribution: 60,
            })),
          }),
        );
        return;
      }
      if (req.url === '/v1/summaries' && fx.delaySummaries)
        await new Promise((resolve) => pendingSummaries.push(resolve));
      if (req.url === '/v1/draft' && fx.refuseWarmUp && ids.length) {
        fx.refuseWarmUp = false;
        refusedDrafts.push(ids);
        res.writeHead(429, { 'content-type': 'application/json' }).end('{"error":"STRATZ quota reached"}');
        return;
      }
      if (req.url === '/v1/draft') {
        fx.draftRequests++;
        draftBatches.push(ids);
        if (fx.delayDraft) await new Promise((resolve) => pendingDrafts.push(resolve));
        const positions = heroes.flatMap((hero) =>
          [1, 2, 3, 4, 5].map((position) => ({
            heroId: hero.id,
            position: `POSITION_${position}`,
            week: 1,
            matchCount: 1000,
            winCount: 500,
          })),
        );
        const matchups = ids.map((id) => ({
          heroId: id,
          vs: heroes.map((hero) => ({
            heroId1: id,
            heroId2: hero.id,
            matchCount: 1000,
            winCount: 400,
            synergy: fx.hoverDraft && hero.id === 2 ? -20 : (id < hero.id ? 1 : -1) * ((id + hero.id) % 2 ? 4 : -6),
          })),
          with: heroes.map((hero) => ({
            heroId1: id,
            heroId2: hero.id,
            matchCount: 1000,
            winCount: 550,
            synergy: fx.hoverDraft ? (id % 2 ? (hero.id % 2 ? 8 : -4) : hero.id % 2 ? -6 : 10) : 2,
          })),
        }));
        // A huge sample keeps shrinkage negligible: the check is about showing a small known value.
        if (fx.neutralDraft)
          matchups.forEach((row) =>
            row.vs.forEach((pair) => {
              pair.synergy = pair.heroId1 < pair.heroId2 ? 0.4 : -0.4;
              pair.matchCount = 100000000;
              pair.winCount = 50000000;
            }),
          );
        if (fx.malformedDraft) matchups[0].vs = null;
        res
          .writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ source: 'STRATZ', bracket, fetchedAt: new Date().toISOString(), positions, matchups }));
        return;
      }
      if (req.url === '/v1/totals') totalBatches.push(ids);
      else batches.push(ids);
      const summaries = [...ids].reverse().map((id) => ({
        accountId: id,
        days,
        filter,
        source: 'STRATZ',
        isPublic: id !== '3',
        fetchedAt: new Date().toISOString(),
        profile: {
          rank_tier: 80,
          leaderboard_rank: Number(id),
          profile: {
            account_id: Number(id),
            personaname: `Fixture ${id}`,
            ...(id === '2' ? { loccountrycode: 'DE' } : {}),
          },
        },
        ...(req.url === '/v1/totals'
          ? { total: { games: (Number(id) <= 3 ? 1000 : 6000) + Number(id), wins: Number(id) <= 3 ? 600 : 2940 } }
          : {}),
        // Three of four matches on one position, for the position share columns.
        matches: Array.from({ length: 4 }, (_, k) => ({
          match_id: Number(id) * 100 + k,
          hero_id: Number(id),
          start_time: Math.floor(Date.now() / 1000) - 86400 * (k + 1),
          duration: 1800,
          player_slot: 0,
          radiant_win: k % 2 === 0,
          position: `POSITION_${k === 3 ? 5 : (Number(id) % 5) + 1}`,
        })),
        heroes: [{ hero_id: Number(id), games: 20, win: Number(id) % 2 ? 12 : 6 }],
        limited: false,
        stale: false,
      }));
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ summaries }));
    } catch (error) {
      res.writeHead(500).end(String(error));
    }
  });
  await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
  return { fx, service };
}
