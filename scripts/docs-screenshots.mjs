// Regenerates README/docs screenshots on Linux or Windows from demo data.
// Real hero catalogue (portraits from Valve's CDN), invented player names, a local
// fixture stats service and an isolated data folder. Never touches Dota or Steam.
// Usage: npm run build && node scripts/docs-screenshots.mjs
import { nativeCapture, waitFor } from './native-capture.mjs';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rename, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve('docs/images');
await mkdir(out, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'ancient-docs-'));
await mkdir(join(directory, 'cache'));

const catalogue = [
  [2, 'axe', 'Axe', 'str'],
  [5, 'crystal_maiden', 'Crystal Maiden', 'int'],
  [8, 'juggernaut', 'Juggernaut', 'agi'],
  [11, 'nevermore', 'Shadow Fiend', 'agi'],
  [14, 'pudge', 'Pudge', 'str'],
  [17, 'storm_spirit', 'Storm Spirit', 'int'],
  [19, 'tiny', 'Tiny', 'str'],
  [26, 'lion', 'Lion', 'int'],
  [27, 'shadow_shaman', 'Shadow Shaman', 'int'],
  [29, 'tidehunter', 'Tidehunter', 'str'],
  [30, 'witch_doctor', 'Witch Doctor', 'int'],
  [35, 'sniper', 'Sniper', 'agi'],
  [41, 'faceless_void', 'Faceless Void', 'agi'],
  [44, 'phantom_assassin', 'Phantom Assassin', 'agi'],
  [49, 'dragon_knight', 'Dragon Knight', 'str'],
  [53, 'furion', "Nature's Prophet", 'int'],
  [69, 'doom_bringer', 'Doom', 'str'],
  [74, 'invoker', 'Invoker', 'all'],
  [86, 'rubick', 'Rubick', 'int'],
  [87, 'disruptor', 'Disruptor', 'int'],
  [93, 'slark', 'Slark', 'agi'],
  [96, 'centaur', 'Centaur Warrunner', 'str'],
  [97, 'magnataur', 'Magnus', 'all'],
  [100, 'tusk', 'Tusk', 'str'],
  [104, 'legion_commander', 'Legion Commander', 'str'],
  [106, 'ember_spirit', 'Ember Spirit', 'agi'],
  [114, 'monkey_king', 'Monkey King', 'agi'],
  [119, 'dark_willow', 'Dark Willow', 'int'],
  [120, 'pangolier', 'Pangolier', 'all'],
  [126, 'void_spirit', 'Void Spirit', 'all'],
  [128, 'snapfire', 'Snapfire', 'all'],
  [129, 'mars', 'Mars', 'str'],
  [135, 'dawnbreaker', 'Dawnbreaker', 'str'],
  [136, 'marci', 'Marci', 'all'],
  [137, 'primal_beast', 'Primal Beast', 'str'],
];
const heroes = catalogue.map(([id, name, localized, attr]) => ({
  id,
  name: `npc_dota_hero_${name}`,
  localized_name: localized,
  primary_attr: attr,
  attack_type: 'Melee',
  roles: ['Carry'],
}));
const ids = heroes.map((hero) => hero.id);
// Deterministic pseudo-random numbers so the images only change with the UI.
const noise = (...parts) => (createHash('sha256').update(parts.join(':')).digest().readUInt32BE(0) / 2 ** 32) * 2 - 1;

const radiant = [69, 74, 8, 26, 87];
const dire = [129, 11, 93, 86, 30];
// Each demo player's usual role, matching the hero they play: Doom/Mars offlane, Invoker/
// Shadow Fiend mid, Juggernaut/Slark carry, Lion/Rubick soft support, Disruptor/Witch Doctor
// hard support. The role guess and the Lanes page read these.
const roles = [3, 2, 1, 4, 5, 3, 2, 1, 4, 5];
const heroRole = new Map([...radiant, ...dire].map((hero, i) => [hero, roles[i]]));
const names = ['Kestrel', 'nightjar', 'Vexa', 'moss', 'Lumen', 'orbit', 'quietfox', 'Bramble', 'Ziggurat', 'tallow'];
// Steam profile countries; players without one show no flag, as in a real lobby.
const countries = ['SE', 'UA', 'DE', null, 'PL', null, 'FI', 'GB', null, 'KZ'];
const tiers = [75, 80, 64, 71, 55, 80, 73, 62, 74, 65];
const own = '777';

async function resource(endpoint, data) {
  const key = createHash('sha256').update(endpoint).digest('hex');
  await writeFile(join(directory, 'cache', `resource-${key}.json`), JSON.stringify({ endpoint, at: Date.now(), data }));
}
await resource('heroes', heroes);
// The OpenDota country fallback for players without one, cached so it needs no request.
for (let n = 1; n <= 10; n++)
  if (!countries[n - 1]) await resource(`players/${n}`, { profile: { account_id: n, loccountrycode: null } });

// Own rating journal: one game measurement after each ranked match, ending at 6586.
const now = Math.floor(Date.now() / 1000);
const history = Array.from({ length: 30 }, (_, k) => {
  const hero = ids[Math.floor(Math.abs(noise('hero', k)) * 7)];
  const duration = 1500 + Math.floor(Math.abs(noise('time', k)) * 1500);
  const turbo = k % 11 === 5;
  const kills = 2 + Math.floor(Math.abs(noise('k', k)) * 12);
  return {
    match_id: 8_100_000_000 + k,
    hero_id: hero,
    start_time: now - 3600 * 9 * (k + 1) - duration,
    duration,
    player_slot: k % 2 ? 128 : 0,
    radiant_win: (k % 2 ? -1 : 1) * (noise('win', k) + 0.25) > 0,
    kills,
    deaths: 1 + Math.floor(Math.abs(noise('d', k)) * 9),
    assists: 6 + Math.floor(Math.abs(noise('a', k)) * 20),
    gold_per_min: 380 + Math.floor(Math.abs(noise('gpm', k)) * 300),
    xp_per_min: 480 + Math.floor(Math.abs(noise('xpm', k)) * 320),
    last_hits: 40 + Math.floor(Math.abs(noise('lh', k)) * 300),
    denies: Math.floor(Math.abs(noise('dn', k)) * 14),
    net_worth: 9000 + Math.floor(Math.abs(noise('nw', k)) * 25000),
    hero_damage: 9000 + Math.floor(Math.abs(noise('dmg', k)) * 40000),
    tower_damage: Math.floor(Math.abs(noise('bld', k)) * 6000),
    hero_healing: Math.floor(Math.abs(noise('heal', k)) * 3000),
    imp: Math.round(noise('imp', k) * 30),
    position: `POSITION_${1 + Math.floor(Math.abs(noise('pos', k)) * 5)}`,
    game_mode: turbo ? 23 : 22,
    lobby_type: turbo ? 0 : 7,
    average_rank: k % 7 === 3 ? 80 : 73 + (k % 3),
  };
});
// All ten players of each match, for the ten-player card of a statistic (STRATZ history).
const stat = (base, spread, ...key) => base + Math.floor(Math.abs(noise(...key)) * spread);
for (const match of history) {
  const own = match.player_slot < 128;
  match.lineup = Array.from({ length: 10 }, (_, slot) => {
    const radiant = slot < 5;
    if (radiant === own && slot % 5 === 0)
      return {
        radiant,
        own: true,
        ...Object.fromEntries(
          [
            'hero_id',
            'kills',
            'deaths',
            'assists',
            'gold_per_min',
            'xp_per_min',
            'last_hits',
            'denies',
            'net_worth',
            'hero_damage',
            'tower_damage',
            'hero_healing',
            'imp',
            'position',
          ].map((key) => [key, match[key]]),
        ),
      };
    const key = [match.match_id, slot];
    return {
      radiant,
      hero_id: ids[Math.floor(Math.abs(noise('lineup-hero', ...key)) * ids.length)],
      kills: stat(1, 12, 'lk', ...key),
      deaths: stat(1, 9, 'ld', ...key),
      assists: stat(3, 20, 'la', ...key),
      gold_per_min: stat(300, 380, 'lgpm', ...key),
      xp_per_min: stat(380, 420, 'lxpm', ...key),
      last_hits: stat(20, 320, 'llh', ...key),
      denies: stat(0, 14, 'ldn', ...key),
      net_worth: stat(6000, 26000, 'lnw', ...key),
      hero_damage: stat(6000, 40000, 'ldmg', ...key),
      tower_damage: stat(0, 6000, 'lbld', ...key),
      hero_healing: stat(0, 3000, 'lheal', ...key),
      imp: Math.round(noise('limp', ...key) * 30),
      position: `POSITION_${(slot % 5) + 1}`,
    };
  });
  const team = (radiant) => match.lineup.filter((player) => player.radiant === radiant);
  // The first five own matches include Kestrel, sometimes as an ally, sometimes an enemy.
  // Keep the participant lists consistent with the ten-player statistic card.
  if (history.indexOf(match) < 5) {
    const player = match.lineup[1];
    player.id = 1;
    player.name = names[0];
    const participant = {
      id: player.id,
      name: player.name,
      hero: player.hero_id,
      kills: player.kills,
      deaths: player.deaths,
      assists: player.assists,
    };
    match.allies = player.radiant === own ? [participant] : [];
    match.enemies = player.radiant !== own ? [participant] : [];
  }
  match.team_kills = team(own).reduce((sum, player) => sum + player.kills, 0);
  match.team_deaths = team(own).reduce((sum, player) => sum + player.deaths, 0);
}
const won = (match) => match.radiant_win === match.player_slot < 128;
const ranked = history.filter((match) => match.lobby_type === 7).reverse();
const changes = ranked.map((match, k) => (won(match) ? 1 : -1) * (24 + Math.round(Math.abs(noise('mmr', k)) * 8)));
let value = 6586 - changes.reduce((sum, change) => sum + change, 0);
const mmr = [
  {
    id: randomUUID(),
    accountId: own,
    value,
    confidence: 61,
    source: 'dota-memory',
    createdAt: new Date((ranked[0].start_time - 600) * 1000).toISOString(),
  },
];
ranked.forEach((match, k) => {
  value += changes[k];
  const at = match.start_time + match.duration + 180;
  mmr.push({
    id: randomUUID(),
    accountId: own,
    value,
    confidence: 60,
    source: 'dota-memory',
    createdAt: new Date(at * 1000).toISOString(),
  });
});
await writeFile(
  join(directory, 'state.json'),
  JSON.stringify({
    version: 1,
    accountId: own,
    token: 'b'.repeat(64),
    notes: [
      {
        accountId: '1',
        name: names[0],
        text: 'Calls objectives and shares the next smoke timing.',
        tag: 'neutral',
        updatedAt: new Date(now * 1000).toISOString(),
      },
    ],
    mmr,
    nativeRosterReader: 'on',
  }),
);
const feed = join(directory, 'account-feed.json');
async function measured() {
  const sample = {
    accountId: own,
    status: 'measured',
    source: 'dota-memory',
    observedAt: new Date().toISOString(),
    mmr: 6586,
    confidence: 60,
    behaviorScore: 12000,
    communicationScore: 12000,
  };
  await writeFile(`${feed}.next`, JSON.stringify(sample));
  await rename(`${feed}.next`, feed);
}
await measured();
const feeder = setInterval(() => void measured(), 2000);

function summary(id, days, filter) {
  const n = Number(id);
  const pool = ids.filter((_, k) => (k + n) % 4 === 0);
  const top = [0, 1, 2].map((k) => ({
    hero_id: pool[k],
    games: 4 + Math.floor(Math.abs(noise('g', id, k)) * 10),
    win: 0,
  }));
  top.forEach((row, k) => (row.win = Math.round(row.games * (0.5 + noise('w', id, k) * 0.25))));
  const hero = [...radiant, ...dire][n - 1];
  top.push({ hero_id: hero, games: 3 + (n % 5), win: Math.min(3 + (n % 5), 1 + (n % 4)) });
  const matches = Array.from({ length: 12 }, (_, k) => ({
    match_id: n * 1000 + k,
    hero_id: k < 4 ? hero : pool[k % 3],
    start_time: now - 86400 * (k + 1),
    duration: 1900,
    player_slot: 0,
    radiant_win: noise('r', id, k) > 0,
    kills: stat(2, 10, 'recent-k', id, k),
    deaths: stat(1, 8, 'recent-d', id, k),
    assists: stat(4, 15, 'recent-a', id, k),
    // Mostly the usual role, sometimes another one.
    position: `POSITION_${k % 6 === 5 ? 1 + ((n + k) % 5) : roles[n - 1]}`,
  }));
  const games = 1800 + Math.floor(Math.abs(noise('total', id)) * 6000);
  return {
    accountId: id,
    days,
    filter,
    source: 'STRATZ',
    fetchedAt: new Date().toISOString(),
    profile: {
      rank_tier: tiers[n - 1],
      leaderboard_rank: tiers[n - 1] === 80 ? 400 + n * 97 : null,
      profile: {
        account_id: n,
        personaname: names[n - 1],
        ...(countries[n - 1] && { loccountrycode: countries[n - 1] }),
      },
    },
    total: { games, wins: Math.round(games * (0.5 + noise('wr', id) * 0.04)) },
    matches,
    heroes: top,
    limited: false,
    stale: false,
  };
}
function draft(requested, bracket = 'ALL') {
  const positions = heroes.flatMap((hero) =>
    [1, 2, 3, 4, 5].map((position) => {
      // The ten heroes of the demo match are mostly played in their own role.
      const games = heroRole.get(hero.id) === position ? 30000 : heroRole.has(hero.id) ? 1500 : 6000;
      return {
        heroId: hero.id,
        position: `POSITION_${position}`,
        week: 1,
        matchCount: games,
        winCount: Math.round(games * (0.5 + noise('p', hero.id, position) * 0.04)),
      };
    }),
  );
  const pair = (a, b, kind) => {
    const sign = kind === 'vs' && a > b ? -1 : 1;
    const value = noise(kind, Math.min(a, b), Math.max(a, b)) * 6 * sign;
    return {
      heroId1: a,
      heroId2: b,
      matchCount: 5000,
      winCount: Math.round(5000 * (0.5 + value / 100)),
      synergy: value,
    };
  };
  const matchups = requested.map((id) => ({
    heroId: id,
    vs: ids.filter((other) => other !== id).map((other) => pair(id, other, 'vs')),
    with: ids.filter((other) => other !== id).map((other) => pair(id, other, 'with')),
  }));
  return { source: 'STRATZ', bracket, fetchedAt: new Date().toISOString(), positions, matchups };
}
// Typical per-game numbers of a position in the demo bracket, for the profile colours.
const positionAverages = {
  1: { kills: 7, deaths: 4, assists: 7, goldPerMinute: 620, xp: 22000, cs: 280, heroDamage: 24000 },
  2: { kills: 9, deaths: 5, assists: 9, goldPerMinute: 600, xp: 24000, cs: 250, heroDamage: 26000 },
  3: { kills: 5, deaths: 6, assists: 12, goldPerMinute: 450, xp: 19000, cs: 170, heroDamage: 20000 },
  4: { kills: 4, deaths: 8, assists: 16, goldPerMinute: 330, xp: 15000, cs: 60, heroDamage: 14000 },
  5: { kills: 2, deaths: 8, assists: 17, goldPerMinute: 270, xp: 13000, cs: 35, heroDamage: 9000 },
};
const averages = (ids, bracket) => ({
  source: 'STRATZ',
  fetchedAt: new Date().toISOString(),
  bracket,
  rows: ids.flatMap((heroId) =>
    [1, 2, 3, 4, 5].map((position) => ({
      heroId,
      position,
      time: 35,
      matchCount: 500,
      networth: 15000,
      killContribution: 60,
      ...positionAverages[position],
    })),
  ),
});

const service = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body || '{}');
  const send = (value) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  if (req.url === '/v1/draft') return send(draft(input.ids, input.bracket));
  if (req.url === '/v1/averages') return send(averages(input.ids, input.bracket));
  if (req.url === '/v1/summaries')
    return send({ summaries: input.ids.map((id) => summary(id, input.days, input.filter)) });
  if (req.url === '/v1/history')
    return send({
      accountId: own,
      source: 'STRATZ',
      fetchedAt: new Date().toISOString(),
      profile: {
        rank_tier: 80,
        leaderboard_rank: null,
        profile: { account_id: 777, personaname: 'eclipse', loccountrycode: 'EE' },
      },
      matches: history,
      hasMore: false,
      nextOffset: history.length,
      stale: false,
    });
  res.writeHead(404).end();
});
await new Promise((r) => service.listen(0, '127.0.0.1', r));
let app;
let keepAlive;
try {
  app = await nativeCapture(directory, {
    ANCIENT_TEST_ACCOUNT_FEED: feed,
    ANCIENT_STATS_URL: `http://127.0.0.1:${service.address().port}`,
  });
  await app.resize(1740, 1240);
  const info = await app.call('getInfo');
  // Prime the own-history cache before the match screen asks for saved meetings only.
  await app.call('getHistory', own, 0);
  // Spectator GSI: ten players with picked heroes.
  const payload = {
    auth: { token: 'b'.repeat(64) },
    provider: { appid: 570 },
    map: { matchid: '8123456789', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 754 },
    player: { team2: {}, team3: {} },
    hero: { team2: {}, team3: {} },
  };
  [...radiant, ...dire].forEach((heroId, i) => {
    const team = i < 5 ? 'team2' : 'team3';
    payload.player[team][`player${i}`] = { steamid: String(76561197960265728n + BigInt(i + 1)), name: names[i] };
    payload.hero[team][`player${i}`] = { id: heroId, name: heroes.find((hero) => hero.id === heroId).name };
  });
  const post = () =>
    fetch(`http://127.0.0.1:${info.gsiPort}/gsi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  await post();
  keepAlive = setInterval(() => void post(), 5000);
  await waitFor(
    () =>
      app.execute(
        'return document.body.innerText.includes("Profiles · 10/10 loaded") && !!document.querySelector(".suggestion-tile")',
      ),
    'Demo match did not load',
  );
  await app.capture(join(out, 'match-screen.png'));
  await app.execute(
    'document.querySelector(".match-player").dispatchEvent(new MouseEvent("mouseover",{bubbles:true,relatedTarget:document.body}))',
  );
  await waitFor(
    () => app.execute('return !!document.querySelector(".player-preview .preview-together")'),
    'Player hover card with earlier meetings did not open',
  );
  await app.execute('document.querySelector(".tooltip").style.background = "#141c2a"');
  await app.capture(join(out, 'player-card.png'), '.tooltip');
  await app.execute('document.body.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}))');
  // The third analysis panel needs a wider window than the main screenshot.
  await app.resize(3200, 1900);
  await waitFor(
    () => app.execute('return !!document.querySelector(`[aria-label^="Third panel"]`)'),
    'Third analysis panel did not appear',
  );
  await app.click('Left panel: Lanes');
  await app.click('Right panel: Picks for Radiant');
  await app.click('Third panel: Counter picks against Dire');
  await waitFor(
    () => app.execute('return document.querySelectorAll(".analysis-strip.three .analysis-panel").length === 3'),
    'Three analysis panels did not remain visible after layout settled',
  );
  // The fit zoom responds over several frames after resize and panel changes.
  let previousLayout;
  let stableLayouts = 0;
  await waitFor(async () => {
    const layout = await app.execute(
      'return JSON.stringify([...document.querySelectorAll(".match-fit,.analysis-panel,.analysis-content")].map(el=>{const r=el.getBoundingClientRect(); return [r.width,r.height,el.scrollWidth,el.scrollHeight]}))',
    );
    stableLayouts = layout === previousLayout ? stableLayouts + 1 : 0;
    previousLayout = layout;
    return stableLayouts >= 3;
  }, 'Analysis layout did not settle');
  await waitFor(
    () =>
      app.execute(
        'return [...document.querySelectorAll(".analysis-content")].every(el=>el.scrollWidth<=el.clientWidth+1 && el.scrollHeight<=el.clientHeight+1)',
      ),
    'Analysis content would be clipped in the documentation image',
  );
  await app.capture(join(out, 'draft-panels.png'), '.analysis-strip');
  await app.resize(1600, 1240);
  // The profile has a window of its own, open from the start.
  await app.useWindow('profile');
  await app.resize(1600, 1240);
  await waitFor(
    () =>
      app.execute(
        'return document.querySelector("[data-testid=own-mmr]")?.textContent === "6,586" && !!document.querySelector(".profile-table tbody tr")',
      ),
    'Demo profile did not load',
  );
  await app.capture(join(out, 'profile.png'));
  // Hover card of one statistic across the ten players (GPM of the latest match).
  await app.execute(
    'const cell=document.querySelector(`.profile-table tbody tr:first-child td[data-column="gold_per_min"] [data-tip]`); cell.dispatchEvent(new MouseEvent("mouseover",{bubbles:true,relatedTarget:document.body}))',
  );
  await waitFor(
    () => app.execute('return document.querySelectorAll(".tooltip .match-rank li").length === 10'),
    'Ten-player card did not open',
  );
  // Opaque for the image: the translucent card would show the table behind it.
  await app.execute('document.querySelector(".tooltip").style.background = "#141c2a"');
  await app.capture(join(out, 'match-card.png'), '.tooltip');
  await app.execute('document.body.dispatchEvent(new MouseEvent("mousedown",{bubbles:true}))');
  await app.useWindow('main');
  await app.click('Settings');
  await app.capture(join(out, 'memory-consent.png'), '.reader-settings');
  console.log(`Screenshots written to ${out}`);
} finally {
  clearInterval(keepAlive);
  clearInterval(feeder);
  await app?.close();
  await new Promise((done) => service.close(done));
  // WebView2 releases its profile files shortly after the app exits.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
