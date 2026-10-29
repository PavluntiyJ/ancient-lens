// Opens the real app on invented, deliberately awkward data for UI and UX review: long and
// non-Latin names, private and missing profiles, a smurf, notes of every kind, a long own
// history with gaps, and a draft that advances one step per key press. Isolated data folder
// and a local fixture stats service; never touches Dota, Steam or the personal app data.
// Usage: npm run build && npm run demo
import { nativeDriver, waitFor } from './native-capture.mjs';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rename, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';

// A failed background step is logged; ending the script here would leave the app window open
// and block the next demo, since the app runs once per user.
process.on('unhandledRejection', (error) => console.error(`Demo step failed: ${error}`));

const directory = await mkdtemp(join(tmpdir(), 'ancient-demo-'));
await mkdir(join(directory, 'cache'));

const catalogue = [
  [1, 'antimage', 'Anti-Mage', 'agi'],
  [2, 'axe', 'Axe', 'str'],
  [3, 'bane', 'Bane', 'all'],
  [5, 'crystal_maiden', 'Crystal Maiden', 'int'],
  [6, 'drow_ranger', 'Drow Ranger', 'agi'],
  [7, 'earthshaker', 'Earthshaker', 'str'],
  [8, 'juggernaut', 'Juggernaut', 'agi'],
  [9, 'mirana', 'Mirana', 'all'],
  [10, 'morphling', 'Morphling', 'agi'],
  [11, 'nevermore', 'Shadow Fiend', 'agi'],
  [12, 'phantom_lancer', 'Phantom Lancer', 'agi'],
  [13, 'puck', 'Puck', 'all'],
  [14, 'pudge', 'Pudge', 'str'],
  [17, 'storm_spirit', 'Storm Spirit', 'int'],
  [18, 'sven', 'Sven', 'str'],
  [19, 'tiny', 'Tiny', 'str'],
  [20, 'vengefulspirit', 'Vengeful Spirit', 'all'],
  [21, 'windrunner', 'Windranger', 'all'],
  [22, 'zuus', 'Zeus', 'int'],
  [25, 'lina', 'Lina', 'int'],
  [26, 'lion', 'Lion', 'int'],
  [27, 'shadow_shaman', 'Shadow Shaman', 'int'],
  [29, 'tidehunter', 'Tidehunter', 'str'],
  [30, 'witch_doctor', 'Witch Doctor', 'int'],
  [31, 'lich', 'Lich', 'int'],
  [32, 'riki', 'Riki', 'agi'],
  [35, 'sniper', 'Sniper', 'agi'],
  [36, 'necrolyte', 'Necrophos', 'int'],
  [39, 'queenofpain', 'Queen of Pain', 'int'],
  [41, 'faceless_void', 'Faceless Void', 'agi'],
  [42, 'skeleton_king', 'Wraith King', 'str'],
  [44, 'phantom_assassin', 'Phantom Assassin', 'agi'],
  [46, 'templar_assassin', 'Templar Assassin', 'agi'],
  [47, 'viper', 'Viper', 'agi'],
  [49, 'dragon_knight', 'Dragon Knight', 'str'],
  [53, 'furion', "Nature's Prophet", 'int'],
  [54, 'life_stealer', 'Lifestealer', 'str'],
  [62, 'bounty_hunter', 'Bounty Hunter', 'agi'],
  [64, 'jakiro', 'Jakiro', 'int'],
  [67, 'spectre', 'Spectre', 'agi'],
  [69, 'doom_bringer', 'Doom', 'str'],
  [71, 'spirit_breaker', 'Spirit Breaker', 'str'],
  [74, 'invoker', 'Invoker', 'all'],
  [75, 'silencer', 'Silencer', 'int'],
  [84, 'ogre_magi', 'Ogre Magi', 'str'],
  [86, 'rubick', 'Rubick', 'int'],
  [87, 'disruptor', 'Disruptor', 'int'],
  [93, 'slark', 'Slark', 'agi'],
  [96, 'centaur', 'Centaur Warrunner', 'str'],
  [97, 'magnataur', 'Magnus', 'all'],
  [100, 'tusk', 'Tusk', 'str'],
  [101, 'skywrath_mage', 'Skywrath Mage', 'int'],
  [104, 'legion_commander', 'Legion Commander', 'str'],
  [106, 'ember_spirit', 'Ember Spirit', 'agi'],
  [110, 'phoenix', 'Phoenix', 'all'],
  [114, 'monkey_king', 'Monkey King', 'agi'],
  [119, 'dark_willow', 'Dark Willow', 'int'],
  [120, 'pangolier', 'Pangolier', 'all'],
  [123, 'hoodwink', 'Hoodwink', 'agi'],
  [126, 'void_spirit', 'Void Spirit', 'all'],
  [128, 'snapfire', 'Snapfire', 'all'],
  [129, 'mars', 'Mars', 'str'],
  [135, 'dawnbreaker', 'Dawnbreaker', 'str'],
  [136, 'marci', 'Marci', 'all'],
  [137, 'primal_beast', 'Primal Beast', 'str'],
  [138, 'muerta', 'Muerta', 'int'],
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
const heroName = (id) => heroes.find((hero) => hero.id === id).name;
// Deterministic pseudo-random numbers, so every run shows the same data.
const noise = (...parts) => (createHash('sha256').update(parts.join(':')).digest().readUInt32BE(0) / 2 ** 32) * 2 - 1;
const pick = (list, ...key) => list[Math.floor(Math.abs(noise(...key)) * list.length)];
const now = Math.floor(Date.now() / 1000);
const day = 86400;

const own = '777';
// The other nine players of the match, each a case the screens must survive. `self` marks the
// own seat in the player scenarios; spectating shows `spectatorSelf` there instead.
// Cyrillic names and notes are \u-escaped: the public-source check allows only English copy.
const cast = [
  { id: 1, name: 'Kestrel', country: 'SE', tier: 65, games: 4512, rate: 0.52, role: 5, hero: 5 },
  {
    id: 2,
    name: 'ＸxX_DaRk_LoRd_oF_tHe_AnCiEnTs_XxＸ',
    country: 'UA',
    tier: 11,
    games: 121,
    rate: 0.41,
    role: 1,
    hero: 44,
  },
  {
    id: 3,
    name: '\u0412\u0430\u0441\u044f \u041f\u0443\u043f\u043a\u0438\u043d',
    country: 'RU',
    tier: 53,
    games: 7310,
    rate: 0.49,
    role: 2,
    hero: 11,
  },
  { id: 4, name: 'anonymous', country: null, tier: null, games: 0, rate: 0, role: 4, hero: 26, private: true },
  { id: 5, name: '无敌小学生', country: 'CN', tier: 72, games: 85, rate: 0.79, role: 1, hero: 93 },
  { id: 6, name: 'ravenclaw', country: 'PE', tier: 80, leaderboard: 1, games: 25480, rate: 0.58, role: 2, hero: 74 },
  { id: 7, name: 'lostsignal', country: 'DE', tier: 45, games: 3000, rate: 0.5, role: 3, hero: 129, missing: true },
  { id: 8, name: '🔥 محمد 🔥', country: 'AE', tier: 22, games: 980, rate: 0.47, role: 4, hero: 86 },
  { id: 9, name: 'a', country: 'BR', tier: 34, games: 2210, rate: 0.5, role: 3, hero: 69, idle: true, slow: true },
];
const self = { id: Number(own), name: 'eclipse', country: 'EE', tier: 63, games: 6120, rate: 0.53, role: 3, hero: 96 };
const spectatorSelf = { id: 10, name: 'tallow', country: 'KZ', tier: 64, games: 5120, rate: 0.51, role: 3, hero: 96 };
// Radiant: Kestrel, long name, Cyrillic, private, own seat. Dire: the rest.
const lobby = (seat) => [cast[0], cast[1], cast[2], cast[3], seat, cast[4], cast[5], cast[6], cast[7], cast[8]];
const byId = new Map([...cast, self, spectatorSelf].map((player) => [String(player.id), player]));

async function resource(endpoint, data) {
  const key = createHash('sha256').update(endpoint).digest('hex');
  await writeFile(join(directory, 'cache', `resource-${key}.json`), JSON.stringify({ endpoint, at: Date.now(), data }));
}
await resource('heroes', heroes);
for (const player of byId.values())
  if (!player.country)
    await resource(`players/${player.id}`, { profile: { account_id: player.id, loccountrycode: null } });

// Own history: 150 matches over three pages, with the cases a table has to handle.
const positions = [1, 2, 3, 4, 5];
const history = Array.from({ length: 150 }, (_, k) => {
  const key = ['own', k];
  const turbo = k % 13 === 6;
  const ability = k === 33;
  const unranked = k % 17 === 9;
  const duration = k === 4 ? 241 : k === 12 ? 5534 : 1300 + Math.floor(Math.abs(noise('time', ...key)) * 1900);
  const ago = k === 0 ? 900 + duration : 3600 * 7 * k + Math.floor(Math.abs(noise('gap', ...key)) * 3600 * 5);
  const position = k % 9 === 8 ? null : k % 4 === 0 ? 3 : pick(positions, 'pos', ...key);
  const blank = k === 7 || k === 51;
  const row = {
    match_id: 8_200_000_000 - k * 1371,
    hero_id: k % 3 === 0 ? 96 : pick(ids, 'hero', ...key),
    start_time: now - ago - duration,
    duration,
    player_slot: k % 2 ? 128 : 3,
    radiant_win: k === 4 ? null : (k % 2 ? -1 : 1) * (noise('win', ...key) + 0.06) > 0,
    kills: blank ? null : k === 19 ? 34 : Math.floor(Math.abs(noise('k', ...key)) * 14),
    deaths: blank ? null : k === 23 ? 21 : Math.floor(Math.abs(noise('d', ...key)) * 11),
    assists: blank ? null : 2 + Math.floor(Math.abs(noise('a', ...key)) * 28),
    gold_per_min: blank ? null : 220 + Math.floor(Math.abs(noise('gpm', ...key)) * 600),
    xp_per_min: blank ? null : 300 + Math.floor(Math.abs(noise('xpm', ...key)) * 700),
    last_hits: blank ? null : Math.floor(Math.abs(noise('lh', ...key)) * 520),
    denies: blank ? null : Math.floor(Math.abs(noise('dn', ...key)) * 30),
    net_worth: blank ? null : 3000 + Math.floor(Math.abs(noise('nw', ...key)) * 45000),
    hero_damage: blank ? null : k === 19 ? 128_450 : 4000 + Math.floor(Math.abs(noise('dmg', ...key)) * 60000),
    tower_damage: blank ? null : Math.floor(Math.abs(noise('bld', ...key)) * 14000),
    hero_healing: blank ? null : k % 5 === 0 ? Math.floor(Math.abs(noise('heal', ...key)) * 18000) : 0,
    imp: blank ? null : k === 19 ? 71 : k === 23 ? -68 : Math.round(noise('imp', ...key) * 40),
    position: position ? `POSITION_${position}` : null,
    game_mode: ability ? 18 : turbo ? 23 : 22,
    lobby_type: turbo || unranked || ability ? 0 : 7,
    ...(k % 11 !== 10 && { average_rank: Math.max(10, Math.min(80, 62 + Math.round(noise('rank', ...key) * 9))) }),
  };
  return row;
});
// The cast meets the own account in older matches: a teammate, an enemy, mixed and once only.
const meetings = new Map([
  [1, [2, 9, 15, 40, 88]],
  [3, [5, 14, 61]],
  [5, [3, 30]],
  [6, [120]],
  [8, [27]],
]);
// The seat of each met player in the lineup; the own seat is 3 of its side.
const meetingSlot = { 1: 1, 3: 4, 5: 2, 6: 2, 8: 0 };
// prettier-ignore
const ownStats = ['hero_id', 'kills', 'deaths', 'assists', 'gold_per_min', 'xp_per_min', 'last_hits', 'denies',
  'net_worth', 'hero_damage', 'tower_damage', 'hero_healing', 'imp', 'position'];
const stat = (base, spread, ...key) => base + Math.floor(Math.abs(noise(...key)) * spread);
history.forEach((match, k) => {
  const ownRadiant = match.player_slot < 128;
  const met = [...meetings].flatMap(([id, games]) => (games.includes(k) ? [id] : []));
  match.lineup = Array.from({ length: 10 }, (_, slot) => {
    const radiant = slot < 5;
    if (radiant === ownRadiant && slot % 5 === 3)
      return { radiant, own: true, ...Object.fromEntries(ownStats.map((name) => [name, match[name]])) };
    const key = [match.match_id, slot];
    // Meetings: player 3 is always an enemy, player 1 always a teammate, the others alternate.
    const meet = met.find((id) => {
      const ally = id === 1 || (id !== 3 && k % 2 === 0);
      return (radiant === ownRadiant) === ally && slot % 5 === meetingSlot[id];
    });
    const anonymous = !meet && Math.abs(noise('anon', ...key)) < 0.3;
    const id = meet ?? (anonymous ? undefined : 1000 + Math.floor(Math.abs(noise('id', ...key)) * 90000));
    return {
      radiant,
      ...(id && { id, name: meet ? byId.get(String(meet)).name : `player${id}` }),
      hero_id: ids[Math.floor(Math.abs(noise('lineup-hero', ...key)) * ids.length)],
      kills: stat(0, 14, 'lk', ...key),
      deaths: stat(0, 12, 'ld', ...key),
      assists: stat(1, 25, 'la', ...key),
      gold_per_min: stat(220, 520, 'lgpm', ...key),
      xp_per_min: stat(300, 600, 'lxpm', ...key),
      last_hits: stat(10, 420, 'llh', ...key),
      denies: stat(0, 20, 'ldn', ...key),
      net_worth: stat(4000, 36000, 'lnw', ...key),
      hero_damage: stat(3000, 50000, 'ldmg', ...key),
      tower_damage: stat(0, 9000, 'lbld', ...key),
      hero_healing: stat(0, 4000, 'lheal', ...key),
      imp: Math.round(noise('limp', ...key) * 40),
      position: `POSITION_${(slot % 5) + 1}`,
    };
  });
  const team = (radiant) => match.lineup.filter((player) => player.radiant === radiant);
  const participants = (radiant) =>
    team(radiant).flatMap((player) =>
      player.own || !player.id
        ? []
        : [
            {
              id: player.id,
              name: player.name,
              hero: player.hero_id,
              kills: player.kills,
              deaths: player.deaths,
              assists: player.assists,
            },
          ],
    );
  // Teammates scored at least the kills the own player took part in, so participation stays below 100%.
  const shortfall =
    (match.kills ?? 0) + (match.assists ?? 0) - team(ownRadiant).reduce((sum, player) => sum + player.kills, 0);
  const teammate = team(ownRadiant).find((player) => !player.own);
  if (shortfall > 0) teammate.kills += shortfall + Math.floor(Math.abs(noise('spare', match.match_id)) * 12);
  match.allies = participants(ownRadiant);
  match.enemies = participants(!ownRadiant);
  match.team_kills = team(ownRadiant).reduce((sum, player) => sum + (player.kills ?? 0), 0);
  match.team_deaths = team(ownRadiant).reduce((sum, player) => sum + (player.deaths ?? 0), 0);
});

// Rating journal: one reading after each ranked match, a manual entry and a calibration gap.
const won = (match) => match.radiant_win === match.player_slot < 128;
const ranked = history.filter((match) => match.lobby_type === 7 && match.radiant_win !== null).reverse();
const changes = ranked.map((match, k) => (won(match) ? 1 : -1) * (22 + Math.round(Math.abs(noise('mmr', k)) * 10)));
let value = 4210 - changes.reduce((sum, change) => sum + change, 0);
const mmr = [
  {
    id: randomUUID(),
    accountId: own,
    value: value - 300,
    source: 'manual',
    createdAt: new Date((ranked[0].start_time - 40 * day) * 1000).toISOString(),
  },
];
ranked.forEach((match, k) => {
  value += changes[k];
  // A stretch without readings, as when the reader was off.
  if (k > 30 && k < 42) return;
  mmr.push({
    id: randomUUID(),
    accountId: own,
    value,
    confidence: k < 4 ? 28 + k * 6 : 60,
    source: 'dota-memory',
    createdAt: new Date((match.start_time + match.duration + 180) * 1000).toISOString(),
  });
});

const long =
  '\u041f\u043b\u043e\u0445\u043e \u0441\u0442\u043e\u0438\u0442 \u043b\u0430\u0439\u043d, \u043d\u0430 10-\u0439 \u043c\u0438\u043d\u0443\u0442\u0435 \u0443\u0445\u043e\u0434\u0438\u0442 \u0432 \u043b\u0435\u0441 \u0438 \u0444\u0430\u0440\u043c\u0438\u0442 \u0434\u043e 40-\u0439. \u0420\u0443\u0433\u0430\u0435\u0442\u0441\u044f \u0432 \u0447\u0430\u0442\u0435, \u043c\u044c\u044e\u0442\u0438\u0442\u044c \u0441\u0440\u0430\u0437\u0443. ' +
  'Two games in a row abandoned after first blood. 同じプレイヤー — avoid on mid. '.repeat(1) +
  '\u0415\u0441\u043b\u0438 \u0432 \u043a\u043e\u043c\u0430\u043d\u0434\u0435 — \u0431\u0440\u0430\u0442\u044c \u0441\u0435\u0431\u0435 \u0441\u0430\u043f\u043f\u043e\u0440\u0442\u0430 \u0438 \u0441\u0442\u043e\u044f\u0442\u044c \u0440\u044f\u0434\u043e\u043c. '.repeat(
    18,
  );
const note = (accountId, name, tag, text, daysAgo) => ({
  accountId: String(accountId),
  name,
  text,
  tag,
  updatedAt: new Date((now - daysAgo * day) * 1000).toISOString(),
});
const notes = [
  note(1, 'Kestrel', 'teammate', 'Great pos 5, wards everything, calls smokes.', 3),
  note(3, '\u0412\u0430\u0441\u044f \u041f\u0443\u043f\u043a\u0438\u043d', 'avoid', long.slice(0, 1990), 12),
  note(5, '无敌小学生', 'neutral', 'Smurf? 80 games, plays Slark only, 79% wins.', 1),
  note(8, '🔥 محمد 🔥', 'avoid', 'Griefed twice\nbuys no wards\n\nreported', 40),
  note(4, 'anonymous', 'neutral', 'Private profile but I remember him: good Lion.', 300),
  ...Array.from({ length: 14 }, (_, k) =>
    note(
      5000 + k,
      [
        'zed',
        'Mirage',
        'k1ng',
        'ghost',
        '\u041f\u0435\u043b\u044c\u043c\u0435\u043d\u044c',
        'nova',
        '小龙',
        'Old Man',
        'x',
        'rook',
        'lynx',
        'Ørjan',
        'pip',
        'Sol',
      ][k],
      ['neutral', 'teammate', 'avoid'][k % 3],
      ['ok', 'Good communication, plays for the team.', 'Tilts after first death.', 'Ward bot.'][k % 4],
      k * 9 + 2,
    ),
  ),
];

await writeFile(
  join(directory, 'state.json'),
  JSON.stringify({
    version: 1,
    accountId: own,
    token: 'b'.repeat(64),
    notes,
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
    mmr: 4210,
    confidence: 60,
    behaviorScore: 9870,
    communicationScore: 11200,
  };
  await writeFile(`${feed}.next`, JSON.stringify(sample));
  // Windows refuses the rename while the app reads the file; the next tick writes it again.
  await rename(`${feed}.next`, feed).catch(() => {});
}
await measured();
const feeder = setInterval(() => void measured().catch(() => {}), 2000);

function summary(id, days, filter) {
  const player = byId.get(String(id));
  const n = Number(id);
  const pool = ids.filter((_, k) => (k + n) % 7 === 0);
  const inPeriod = player.private ? 0 : player.idle ? 0 : Math.min(player.games, 3 + (n % 4) * Math.ceil(days / 7) * 3);
  const matches = Array.from({ length: inPeriod }, (_, k) => ({
    match_id: n * 100000 + k,
    hero_id: k % 3 === 0 ? player.hero : pool[k % pool.length],
    start_time: now - Math.floor(((k + 0.5) * days * day) / Math.max(inPeriod, 1)),
    duration: 1700 + (k % 7) * 160,
    player_slot: k % 2 ? 128 : 0,
    radiant_win: noise('r', id, k) + (player.rate - 0.5) * 2 > 0 === !(k % 2),
    position: `POSITION_${k % 6 === 5 ? 1 + ((n + k) % 5) : player.role}`,
    kills: Math.floor(Math.abs(noise('sk', id, k)) * 15),
    deaths: 1 + Math.floor(Math.abs(noise('sd', id, k)) * 11),
    assists: Math.floor(Math.abs(noise('sa', id, k)) * 24),
  }));
  const heroCounts = new Map();
  for (const match of matches) {
    const row = heroCounts.get(match.hero_id) ?? { hero_id: match.hero_id, games: 0, win: 0 };
    row.games++;
    if (match.radiant_win === match.player_slot < 128) row.win++;
    heroCounts.set(match.hero_id, row);
  }
  return {
    accountId: String(id),
    days,
    filter,
    source: 'STRATZ',
    isPublic: !player.private,
    lastMatchAt: player.private ? null : player.idle ? now - 212 * day : (matches[0]?.start_time ?? now) + 1800,
    fetchedAt: new Date().toISOString(),
    profile: {
      rank_tier: player.tier,
      leaderboard_rank: player.leaderboard ?? null,
      profile: { account_id: n, personaname: player.name, ...(player.country && { loccountrycode: player.country }) },
    },
    ...(!player.private && { total: { games: player.games, wins: Math.round(player.games * player.rate) } }),
    matches,
    heroes: [...heroCounts.values()].sort((a, b) => b.games - a.games),
    limited: false,
    stale: false,
  };
}
const heroRole = new Map([...cast, self].map((player) => [player.hero, player.role]));
function draft(requested, bracket = 'ALL') {
  const rows = heroes.flatMap((hero) =>
    positions.map((position) => {
      const games =
        heroRole.get(hero.id) === position ? 30000 : 2000 + Math.floor(Math.abs(noise('g', hero.id, position)) * 9000);
      return {
        heroId: hero.id,
        position: `POSITION_${position}`,
        week: 1,
        matchCount: games,
        winCount: Math.round(games * (0.5 + noise('p', hero.id, position) * 0.05)),
      };
    }),
  );
  const pair = (a, b, kind) => {
    const sign = kind === 'vs' && a > b ? -1 : 1;
    const value = noise(kind, Math.min(a, b), Math.max(a, b)) * 7 * sign;
    const games = 400 + Math.floor(Math.abs(noise('n', kind, a, b)) * 6000);
    return {
      heroId1: a,
      heroId2: b,
      matchCount: games,
      winCount: Math.round(games * (0.5 + value / 100)),
      synergy: value,
    };
  };
  const matchups = requested.map((id) => ({
    heroId: id,
    vs: ids.filter((other) => other !== id).map((other) => pair(id, other, 'vs')),
    with: ids.filter((other) => other !== id).map((other) => pair(id, other, 'with')),
  }));
  return { source: 'STRATZ', bracket, fetchedAt: new Date().toISOString(), positions: rows, matchups };
}
const positionAverages = {
  1: { kills: 7, deaths: 4, assists: 7, goldPerMinute: 620, xp: 22000, cs: 280, heroDamage: 24000 },
  2: { kills: 9, deaths: 5, assists: 9, goldPerMinute: 600, xp: 24000, cs: 250, heroDamage: 26000 },
  3: { kills: 5, deaths: 6, assists: 12, goldPerMinute: 450, xp: 19000, cs: 170, heroDamage: 20000 },
  4: { kills: 4, deaths: 8, assists: 16, goldPerMinute: 330, xp: 15000, cs: 60, heroDamage: 14000 },
  5: { kills: 2, deaths: 8, assists: 17, goldPerMinute: 270, xp: 13000, cs: 35, heroDamage: 9000 },
};
const averages = (requested, bracket) => ({
  source: 'STRATZ',
  fetchedAt: new Date().toISOString(),
  bracket,
  rows: requested.flatMap((heroId) =>
    positions.map((position) => ({
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

const PAGE = 50;
const service = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const input = JSON.parse(body || '{}');
  const send = (value) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
  if (req.url === '/v1/draft') return send(draft(input.ids, input.bracket));
  if (req.url === '/v1/averages') return send(averages(input.ids, input.bracket));
  if (req.url === '/v1/summaries' || req.url === '/v1/totals') {
    // One player loads seconds after the others; one never does.
    if (input.ids.some((id) => byId.get(String(id))?.slow)) await new Promise((done) => setTimeout(done, 6000));
    const known = input.ids.filter((id) => byId.has(String(id)) && !byId.get(String(id)).missing);
    return send({ summaries: known.map((id) => summary(id, input.days, input.filter)) });
  }
  if (req.url === '/v1/history') {
    if (String(input.id) !== own) {
      // Another player's card: a short history of its own.
      const player = byId.get(String(input.id));
      if (!player || player.private || player.missing) return res.writeHead(503).end('{}');
      const { matches, profile } = summary(input.id, 30, 'normal');
      return send({
        accountId: String(input.id),
        source: 'STRATZ',
        fetchedAt: new Date().toISOString(),
        profile,
        matches,
        hasMore: false,
        nextOffset: matches.length,
        stale: false,
      });
    }
    const offset = input.offset ?? 0;
    // Older pages arrive slowly, so the loading row stays visible for a moment.
    if (offset) await new Promise((done) => setTimeout(done, 1500));
    return send({
      accountId: own,
      source: 'STRATZ',
      fetchedAt: new Date().toISOString(),
      profile: {
        rank_tier: self.tier,
        leaderboard_rank: null,
        profile: { account_id: self.id, personaname: self.name, loccountrycode: self.country },
      },
      matches: history.slice(offset, offset + PAGE),
      hasMore: offset + PAGE < history.length,
      nextOffset: offset + PAGE,
      stale: false,
    });
  }
  if (req.url === '/v1/match') return res.writeHead(404).end('{}');
  res.writeHead(404).end();
});
await new Promise((done) => service.listen(0, '127.0.0.1', done));

// Draft of All Pick, step by step: bans, then picks in order, with hovers and lanes.
const draftSteps = (() => {
  const steps = [{ label: 'Draft starts: nobody picked', bans: [], picks: [], hovers: [] }];
  const bans = [1, 67, 14, 39, 54, 12, 71, 22, 101, 18];
  const order = [0, 5, 1, 6, 2, 7, 3, 8, 4, 9];
  bans.forEach(
    (_, k) =>
      k % 2 &&
      steps.push({
        label: `Ban phase: ${k + 1} bans`,
        bans: bans.slice(0, k + 1),
        picks: steps.at(-1).picks,
        hovers: [],
      }),
  );
  order.forEach((slot, k) => {
    const prev = steps.at(-1);
    const hover = { slot, team: slot < 5 ? 'radiant' : 'dire', heroId: lobby(self)[slot].hero };
    steps.push({ label: `Slot ${slot + 1} hovers a hero`, bans, picks: prev.picks, hovers: [hover] });
    steps.push({
      label: `Pick ${k + 1} of 10`,
      bans,
      picks: [...prev.picks, { slot, team: hover.team, heroId: hover.heroId }],
      hovers: [],
    });
  });
  return steps;
})();

let app;
let scenario = 'spectator';
let step = 0;
let matchSerial = 0;
let matchId = '';
let keepAlive;
const newMatch = () => (matchId = String(8_300_000_000 + ++matchSerial));

const slots = Array.from({ length: 10 }, (_, slot) => ({
  slot,
  team: slot < 5 ? 'radiant' : 'dire',
  teamSlot: slot % 5,
}));
// Lane wishes of the draft: the own seat and two others marked lanes, the rest none.
const lanes = [
  { slot: 0, team: 'radiant', flags: 16 },
  { slot: 1, team: 'radiant', flags: 1 | 4 },
  { slot: 4, team: 'radiant', flags: 2 },
  { slot: 6, team: 'dire', flags: 4 },
];
function frame() {
  const at = Date.now();
  const seat = lobby(self);
  if (scenario === 'draft') {
    const state = draftSteps[step];
    const gameState = 'DOTA_GAMERULES_STATE_HERO_SELECTION';
    return {
      status: 'connected',
      receivedAt: at,
      matchId,
      gameState,
      mode: 'player',
      players: [{ key: 'self', team: 'radiant', teamSlot: 4, accountId: own }],
      selfTeamSlot: 4,
      rosterStatus: 'ready',
      draftStatus: 'ready',
      draft: {
        matchId,
        gameState,
        source: 'native',
        observedAt: at,
        picks: state.picks,
        bans: state.bans,
        hovers: state.hovers,
        lanes,
        slots,
      },
    };
  }
  return {
    status: 'connected',
    receivedAt: at,
    matchId,
    gameState: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
    clock: 1234,
    mode: 'player',
    hero: heroName(self.hero),
    kills: 4,
    deaths: 2,
    assists: 11,
    level: 17,
    players: seat.map((player, slot) => ({
      key: player === self ? 'self' : `native.${slot}`,
      team: slot < 5 ? 'radiant' : 'dire',
      teamSlot: slot % 5,
      accountId: String(player.id),
      heroId: player.hero,
      ...(player === self && { name: player.name, hero: heroName(player.hero) }),
    })),
    selfTeamSlot: 4,
    rosterSource: 'native',
    rosterStatus: 'ready',
    draftStatus: 'ready',
  };
}
async function inject() {
  await app.useWindow('main');
  await app.execute(
    'const listeners=window.__internal_unstable_listeners_object_id__?.["live:update"]; const ids=Object.getOwnPropertyNames(listeners ?? {}); window.__internal_unstable_listeners_function_id__({event:"live:update",payload:arguments[0]},ids); return ids.length;',
    [frame()],
  );
}
let info;
async function postSpectator() {
  const payload = {
    auth: { token: 'b'.repeat(64) },
    provider: { appid: 570 },
    map: { matchid: matchId, game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 1754 },
    player: { team2: {}, team3: {} },
    hero: { team2: {}, team3: {} },
  };
  lobby(spectatorSelf).forEach((player, i) => {
    const team = i < 5 ? 'team2' : 'team3';
    payload.player[team][`player${i}`] = { steamid: String(76561197960265728n + BigInt(player.id)), name: player.name };
    payload.hero[team][`player${i}`] = { id: player.hero, name: heroName(player.hero) };
  });
  await fetch(`http://127.0.0.1:${info.gsiPort}/gsi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
// Closing the app window ends the demo: two failed updates in a row mean the app is gone.
let failures = 0;
let finish = () => {};
const tick = () =>
  (scenario === 'spectator' ? postSpectator() : inject()).then(
    () => (failures = 0),
    (error) => {
      if (++failures < 2) return console.error(String(error));
      console.log('\nThe app window was closed; the demo stops.');
      finish();
    },
  );
async function show(next) {
  scenario = next;
  step = 0;
  newMatch();
  clearInterval(keepAlive);
  await tick();
  keepAlive = setInterval(() => void tick(), scenario === 'spectator' ? 5000 : 1500);
  status();
}
const shots = process.env.ANCIENT_DEMO_SHOTS || join(tmpdir(), 'ancient-demo-shots');
let shot = 0;
async function screenshots() {
  await mkdir(shots, { recursive: true });
  shot++;
  for (const name of ['main', 'profile']) {
    await app.useWindow(name);
    await writeFile(join(shots, `${shot}-${scenario}-${name}.png`), await app.screenshot());
  }
  await app.useWindow('main');
  console.log(`Screenshots ${shot}-${scenario}-*.png saved in ${shots}`);
}
function status() {
  const what = {
    spectator: 'Watching a match (GSI spectator): ten players, notes, a smurf, a private and a missing profile',
    game: 'Playing a match (reader roster): the same ten players with your own seat',
    draft: `Draft as a player: ${draftSteps[step].label} (step ${step + 1}/${draftSteps.length})`,
  }[scenario];
  console.log(`\n▶ ${what}`);
}

try {
  app = await nativeDriver(directory, {
    ANCIENT_TEST_ACCOUNT_FEED: feed,
    ANCIENT_STATS_URL: `http://127.0.0.1:${service.address().port}`,
  }).catch((error) => {
    // The app runs once per user: a second start only shows the first window and exits.
    throw new Error(
      `${error.message}
Is Ancient Lens already running (also check the tray)? Close it and start the demo again.`,
    );
  });
  await waitFor(
    () => app.execute('return !!window.ancient && document.body.innerText.includes("Match players")'),
    'The app did not load',
  );
  info = await app.call('getInfo');
  await show('spectator');
  console.log(`
Ancient Lens demo — invented data in ${directory}
Keys in this terminal:
  1  watch a match (spectator)      2  play a match (own seat)      3  draft as a player
  →/n  next draft step              ←/b  previous draft step
  r  same scenario as a new match (the note chime plays again)
  s  save screenshots of both windows
  q  quit (the demo data folder is deleted)`);
  emitKeypressEvents(process.stdin);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  await new Promise((done) => {
    finish = done;
    process.stdin.on('keypress', (_, key = {}) => {
      const name = key.name ?? _;
      if (name === 'q' || (key.ctrl && name === 'c')) return done();
      if (name === '1') void show('spectator');
      if (name === '2') void show('game');
      if (name === '3') void show('draft');
      if (name === 'r') void show(scenario);
      if (name === 's') void screenshots().catch((error) => console.error(String(error)));
      if (scenario === 'draft' && ['right', 'n', 'left', 'b'].includes(name)) {
        step = Math.max(0, Math.min(draftSteps.length - 1, step + (['right', 'n'].includes(name) ? 1 : -1)));
        void inject();
        status();
      }
    });
  });
} finally {
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
  clearInterval(keepAlive);
  clearInterval(feeder);
  await app?.close();
  await new Promise((done) => service.close(done));
  // WebView2 releases its lock file a moment after the app exits.
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }).catch(() =>
    console.log(`Could not delete ${directory}; remove it by hand.`),
  );
}
