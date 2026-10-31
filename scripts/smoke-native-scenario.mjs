// One native scenario for both systems: the real app window (WebKitGTK on Linux, WebView2 on
// Windows) and Rust IPC, with isolated data, fixture statistics and authenticated HTTP GSI.
// `native-capture.mjs` drives WebKitWebDriver on Linux and the WebView2 debugging protocol on
// Windows behind the same calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nativeDriver } from './native-capture.mjs';

const platform = process.platform === 'win32' ? 'windows' : 'linux';
const directory = await mkdtemp(join(tmpdir(), 'ancient-native-'));
const cache = join(directory, 'cache');
await mkdir(cache);
const token = 'a'.repeat(64);
// The release list the isolated app reads instead of GitHub; missing at start, like no network.
const releasesPath = join(directory, 'releases.json');
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
const heroes = Array.from({ length: 32 }, (_, i) => ({
  id: i + 1,
  name: `npc_dota_hero_${portraitSlugs[i]}`,
  localized_name: `Hero ${i + 1}`,
  primary_attr: 'str',
  attack_type: 'Melee',
  roles: ['Initiator'],
}));
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
const batches = [];
const totalBatches = [];
let draftRequests = 0;
const draftBatches = [];
// The match screen warms every hero at the draft start (draftWarmBatches) and then asks
// only for missing heroes. A refused warm-up, as on a STRATZ quota, ends it, so the
// per-pick request path stays testable; refused requests are not counted as draft requests.
let refuseWarmUp = false;
const refusedDrafts = [];
let delayDraft = false;
let malformedDraft = false;
let neutralDraft = false;
let hoverDraft = false;
const pendingDrafts = [];
let historyRequests = 0;
// History pages per account: the profile window loads the own account at start.
const historyById = new Map();
let failHistory = false;
let privateHistory = false;
let delaySummaries = false;
const pendingSummaries = [];
const partyRequests = [];
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
      historyRequests++;
      historyById.set(String(id), (historyById.get(String(id)) ?? 0) + 1);
      if (failHistory) {
        res.writeHead(503).end('{}');
        return;
      }
      const start = offset ? 24 : 0;
      const matches = privateHistory
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
          hasMore: !offset && !privateHistory,
          nextOffset: offset ? 50 : 25,
          stale: false,
          historyUnavailable: privateHistory,
          warning: privateHistory ? 'STRATZ history is private. Showing previously saved matches.' : null,
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
    if (req.url === '/v1/summaries' && delaySummaries) await new Promise((resolve) => pendingSummaries.push(resolve));
    if (req.url === '/v1/draft' && refuseWarmUp && ids.length) {
      refuseWarmUp = false;
      refusedDrafts.push(ids);
      res.writeHead(429, { 'content-type': 'application/json' }).end('{"error":"STRATZ quota reached"}');
      return;
    }
    if (req.url === '/v1/draft') {
      draftRequests++;
      draftBatches.push(ids);
      if (delayDraft) await new Promise((resolve) => pendingDrafts.push(resolve));
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
          synergy: hoverDraft && hero.id === 2 ? -20 : (id < hero.id ? 1 : -1) * ((id + hero.id) % 2 ? 4 : -6),
        })),
        with: heroes.map((hero) => ({
          heroId1: id,
          heroId2: hero.id,
          matchCount: 1000,
          winCount: 550,
          synergy: hoverDraft ? (id % 2 ? (hero.id % 2 ? 8 : -4) : hero.id % 2 ? -6 : 10) : 2,
        })),
      }));
      // A huge sample keeps shrinkage negligible: the check is about showing a small known value.
      if (neutralDraft)
        matchups.forEach((row) =>
          row.vs.forEach((pair) => {
            pair.synergy = pair.heroId1 < pair.heroId2 ? 0.4 : -0.4;
            pair.matchCount = 100000000;
            pair.winCount = 50000000;
          }),
        );
      if (malformedDraft) matchups[0].vs = null;
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
let app;
async function waitFor(check, message, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(message);
}
const execute = (script, args = []) => app.execute(script, args);
/** Points the driver at the match window (`main`) or the profile window; both load one page. */
const useWindow = (name) => app.useWindow(name);
const call = (name, ...args) => app.call(name, ...args);
const screenshot = async (name) => writeFile(`test-results/native-${platform}-${name}.png`, await app.screenshot());
/** Moves the WebDriver pointer onto the centre of an element (hover states, cards), or off to
 * a corner. Viewport coordinates, because the zoomed match screen moves element-origin moves.
 * WebKitWebDriver hangs on pointer actions while the window lacks focus (another app is in
 * front); hover checks then dispatch the pointer events React listens to instead. */
let pointed = null;
let syntheticPointer = false;
async function pointAt(element) {
  const [x, y] = element
    ? await execute(
        'const r=arguments[0].getBoundingClientRect(); return [Math.round(r.left+r.width/2), Math.round(r.top+r.height/2)]',
        [element],
      )
    : [2, 2];
  if (!(await app.realPointer())) {
    if (!syntheticPointer) console.log('Window not focused: hover checks use dispatched pointer events.');
    syntheticPointer = true;
    await execute(
      `const [from, to, x, y] = arguments;
      const mouse = (type, target, related) => target?.dispatchEvent(new MouseEvent(type, {bubbles: true, clientX: x, clientY: y, relatedTarget: related ?? null}));
      const pointer = (type, target, related) => target?.dispatchEvent(new PointerEvent(type, {bubbles: true, clientX: x, clientY: y, pointerType: 'mouse', relatedTarget: related ?? null}));
      pointer('pointerout', from, to); mouse('mouseout', from, to);
      pointer('pointerover', to, from); mouse('mouseover', to, from);
      pointer('pointermove', to); mouse('mousemove', to);`,
      [pointed, element ?? null, x, y],
    );
    pointed = element ?? null;
    return;
  }
  pointed = element ?? null;
  await app.point(x, y);
}
/** Every header ⓘ of a table opens its own card under the real pointer, one card at a time. */
async function checkHeaderInfo(table, count) {
  const headers = await execute('return [...document.querySelectorAll(arguments[0] + " .column-info")]', [table]);
  assert.equal(headers.length, count, `${table} header explanations`);
  for (const header of headers) {
    await execute('arguments[0].scrollIntoView({block:"center",inline:"center",behavior:"instant"})', [header]);
    await pointAt(header);
    await waitFor(
      () =>
        execute(
          'return document.querySelector(".tooltip .tip-title")?.textContent === arguments[0].getAttribute("aria-label")',
          [header],
        ),
      `Header card did not open: ${table}`,
    );
    assert.equal(await execute('return document.querySelectorAll(".tooltip").length'), 1);
    assert.ok(await execute('return !!document.querySelector(".tooltip .tip-source")'));
  }
  await pointAt();
}
// The interface scale lives in Settings only; the match screen stays mounted meanwhile.
async function setScale(scale) {
  await clickButton('Settings');
  await clickButton(`${scale}%`, '.scale-options button');
  await waitFor(
    () => execute('return Number(document.querySelector(".app-shell").style.zoom) === arguments[0] / 100', [scale]),
    `Scale ${scale}% did not apply`,
  );
  await clickButton('Match and draft');
}
async function clickButton(text, selector = 'button') {
  const element = await execute(
    'return [...document.querySelectorAll(arguments[1])].find(b => (b.textContent.trim() === arguments[0] || b.getAttribute("aria-label") === arguments[0]))',
    [text, selector],
  );
  assert.ok(element, `Missing button: ${text}`);
  // WebKit may click a partially visible button inside the window resize edge.
  await execute('arguments[0].scrollIntoView({block: "center", inline: "nearest", behavior: "instant"})', [element]);
  await app.clickElement(element);
}
try {
  app = await nativeDriver(directory, {
    ANCIENT_GSI_DRAFT_DIAGNOSTICS: '1',
    ANCIENT_STATS_URL: `http://127.0.0.1:${service.address().port}`,
    ANCIENT_TEST_RELEASES: releasesPath,
  });
  // The configured window size, also where the desktop is smaller (the Windows CI screen):
  // layout checks below assume the match screen fits without scrolling.
  await app.resize(1740, 1100);
  await useWindow('main');
  await waitFor(
    () => execute('return !!window.ancient && document.body.innerText.includes("Match players")'),
    'Native UI did not load',
  );
  await execute(
    'window.smokeErrors = []; addEventListener("error", e => window.smokeErrors.push(e.message)); addEventListener("unhandledrejection", e => window.smokeErrors.push(String(e.reason)));',
  );
  // Draft request counts below assume one rank bracket for the whole match; automatic
  // brackets are covered by tests/rank-bracket.test.ts.
  await execute(
    'localStorage.setItem("ancient-rank-bracket", "ALL"); window.dispatchEvent(new Event("stats-preferences"));',
  );
  const info = await call('getInfo');
  assert.equal(info.runtime, 'Tauri + Rust');
  assert.equal(info.dataPath, directory);
  assert.ok(info.gsiPort > 0 && info.gsiPort !== 32123);
  const state = await call('getState');
  assert.equal(state.nativeRosterReader, 'off');
  assert.equal(state.notes[0].text, 'Keep this note');
  assert.ok(!JSON.stringify(state).includes(token));
  assert.equal(state.updateCheck, true);
  assert.equal(state.autoHide, true);
  assert.equal(state.keysOverGame, true);
  assert.equal(info.keysOverGame, platform === 'windows');
  assert.equal(info.keysListening, true);
  assert.equal(info.autoHide, !info.wayland);
  assert.equal(state.skippedVersion, null);
  assert.deepEqual(await call('getRelease'), { current: info.version, latest: null });
  const matchFits = () =>
    execute(`
    const page = document.querySelector('.match-page');
    const host = page.getBoundingClientRect();
    const fit = document.querySelector('.match-fit');
    const content = fit.getBoundingClientRect();
    const panels = [...document.querySelectorAll('.analysis-panel')].map(el => el.getBoundingClientRect());
    // Below the 90% floor the page scrolls instead of shrinking further.
    if (page.classList.contains('match-scroll')) return host.height > 0 && Math.abs(Number(fit.style.zoom) - 0.9) < 0.002;
    return host.height > 0 && content.bottom <= host.bottom + 2 && content.right <= host.right + 2
      && panels.every(box => box.bottom <= innerHeight && box.top >= host.top);
  `);
  await waitFor(matchFits, 'Waiting screen does not fit the window');
  const payload = {
    auth: { token },
    provider: { appid: 570 },
    map: { matchid: 'native-fixture', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 123 },
    player: { team2: {}, team3: {} },
    hero: { team2: {}, team3: {} },
  };
  for (let i = 0; i < 10; i++) {
    const team = i < 5 ? 'team2' : 'team3';
    const key = `player${i}`;
    payload.player[team][key] = { steamid: String(76561197960265728n + BigInt(i + 1)), name: `Fixture ${i + 1}` };
    payload.hero[team][key] = { id: i + 1, name: heroes[i].name };
  }
  const post = (value, headers = {}) =>
    fetch(`http://127.0.0.1:${info.gsiPort}/gsi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(value),
    });
  assert.equal((await post({ ...payload, auth: { token: 'wrong' } })).status, 403);
  assert.equal((await post(payload, { origin: 'https://untrusted.example' })).status, 403);
  const diagnosticPath = join(directory, 'gsi-draft-diagnostics.jsonl');
  await assert.rejects(access(diagnosticPath), 'Rejected packets reached diagnostics');
  payload.draft = {
    team2: { pick0_id: 1, ban0_id: 2, steamid: '76561197960265729', name: 'PrivateFixture', token },
    team3: { picks: [{ hero_id: 3 }], bans: [] },
  };
  assert.equal((await post(payload)).status, 200);
  const diagnostic = await readFile(diagnosticPath, 'utf8');
  const draftShape = JSON.parse(diagnostic.trim().split('\n').at(-1));
  assert.equal(draftShape.teams.team2.picks.withHeroId, 1);
  assert.equal(draftShape.teams.team2.bans.withHeroId, 1);
  assert.equal(draftShape.teams.team3.picks.withHeroId, 1);
  assert.equal((await call('getLive')).draft, undefined, 'Raw GSI draft leaked into UI');
  for (const secret of [token, '76561197960265729', 'PrivateFixture', 'steamid', 'name'])
    assert.ok(!diagnostic.includes(secret));
  await waitFor(
    () => execute('return document.body.innerText.includes("Profiles · 10/10 loaded")'),
    'Ten profiles did not load',
  );
  assert.equal(batches.length, 2);
  assert.ok(batches.every((ids) => ids.length === 5));
  // Parties: one request for the settled roster of ten.
  await waitFor(() => partyRequests.length === 1, 'Parties were not requested');
  assert.equal(partyRequests[0].length, 10);
  // Player and hero position columns: 3 of 4 known matches on the main position.
  await waitFor(
    () => execute('return document.querySelectorAll(".position-share").length === 20'),
    'Position share columns missing',
  );
  assert.ok((await execute('return document.querySelector(".position-share").textContent')).includes('75%'));
  await waitFor(
    () => execute('return [...document.querySelectorAll(".all-time")].every(cell => cell.textContent.includes("%"))'),
    'Lifetime totals did not arrive',
  );
  // Lifetime totals for all ten players, in batches of up to five. How the batches split
  // depends on timing (the profile window may ask for its own account, here player 1, first).
  const totalsSeen = JSON.stringify(totalBatches);
  assert.ok(
    totalBatches.every((ids) => ids.length <= 5),
    `Totals batches: ${totalsSeen}`,
  );
  assert.deepEqual(
    [...new Set(totalBatches.flat())].sort((a, b) => a - b),
    Array.from({ length: 10 }, (_, i) => String(i + 1)),
    `Totals batches: ${totalsSeen}`,
  );
  console.log(`Totals batches: ${totalsSeen}`);
  const rows = await execute(
    'return [...document.querySelectorAll("tr")].filter(r => r.querySelector(".all-time")).map(r => ({name: [...r.querySelectorAll("button")].find(b => b.textContent.startsWith("Fixture"))?.textContent, total: r.querySelector(".all-time").textContent}))',
  );
  assert.equal(rows.length, 10);
  // Spectator GSI keys carry the player IDs, so every avatar gets its scoreboard colour.
  assert.deepEqual(
    await execute(
      'return [...document.querySelectorAll(".match-table .player-avatar")].map(a => a.classList.contains("slot-frame") ? getComputedStyle(a).getPropertyValue("--slot-colour").trim() : null)',
    ),
    ['#3375ff', '#66ffbf', '#bf00bf', '#f3f00b', '#ff6b00', '#fe86c2', '#a1b447', '#65d9f7', '#008321', '#a46900'],
  );
  for (let id = 1; id <= 10; id++)
    assert.ok(
      rows
        .find((r) => r.name === `Fixture ${id}`)
        ?.total.replace(/[\s,]/g, '')
        .includes(String((id <= 3 ? 1000 : 6000) + id)),
      `Wrong identity mapping for ${id}`,
    );
  await waitFor(
    () => execute('return document.querySelectorAll(".suggestion-tile").length === 12'),
    'Draft suggestions did not load',
  );
  assert.equal(await execute('return document.querySelectorAll("[role=alert]").length'), 0);
  assert.equal(await execute('return document.querySelectorAll(".suggestion-category").length'), 2);
  await waitFor(matchFits, 'Populated match does not fit');
  // Explicit opt-in exercises failure diagnostics in a real isolated native session.
  if (process.env.ANCIENT_NATIVE_DIAGNOSTIC_FAILURE === '1') {
    throw new Error('Controlled native failure for diagnostic verification');
  }
  const assertPanelContentsFit = async () => {
    const overflow = await execute(`
      return [...document.querySelectorAll('.analysis-content')].flatMap(content => {
        const box = content.getBoundingClientRect();
        return [...content.querySelectorAll('.suggestion-tile, .suggestion-category h3, .page-arrow, .meta-tile, .meta-roles, .matrix-panel, .counter-legend')]
          .filter(el => { const r = el.getBoundingClientRect(); return r.top < box.top - 1 || r.bottom > box.bottom + 1 || r.left < box.left - 1 || r.right > box.right + 1; })
          .map(el => ({ page: content.closest('.analysis-panel').dataset.page, element: el.className, top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, bounds: [box.top, box.bottom] }));
      });
    `);
    assert.deepEqual(overflow, [], 'Carousel content is clipped');
    assert.ok(
      await execute(`
      return [...document.querySelectorAll('.counter-rows')].every(list => {
        list.scrollTop = list.scrollHeight;
        const last = list.lastElementChild?.getBoundingClientRect();
        const box = list.getBoundingClientRect();
        const reachable = !last || last.bottom <= box.bottom + 1;
        list.scrollTop = 0;
        return reachable;
      });
    `),
      'Last counter row cannot be reached',
    );
  };
  const panelGeometry = () =>
    execute(`
    return [...document.querySelectorAll('.match-roster, .analysis-panel')].map(el => {
      const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
    });
  `);
  const stablePanels = await panelGeometry();
  for (const label of ['Left panel', 'Right panel']) {
    for (const direction of ['next', 'previous']) {
      const count = await execute(
        'return document.querySelectorAll(`[aria-label="${arguments[0]}: panels"] button`).length',
        [label],
      );
      for (let page = 0; page < count; page++) {
        await post(payload);
        await clickButton(`${label}: ${direction} panel`);
        await new Promise((resolve) => setTimeout(resolve, 150));
        await waitFor(matchFits, `${label} overflows after paging`);
        assert.ok(
          await execute(
            'return [...document.querySelectorAll(".analysis-content")].every(el=>el.scrollWidth<=el.clientWidth+1)',
          ),
          'Carousel has horizontal overflow',
        );
        await assertPanelContentsFit();
        const changed = await panelGeometry();
        assert.ok(
          changed.every((rect, i) => rect.every((value, j) => Math.abs(value - stablePanels[i][j]) <= 1)),
          `${label} jumps on ${direction}: ${JSON.stringify({ stablePanels, changed })}`,
        );
      }
    }
  }
  // 49% over ~6000 games is neutral under the four-tone lifetime rule.
  assert.equal(await execute('return document.querySelectorAll(".all-time .win-rate.neutral").length'), 7);
  assert.equal(await execute('return document.querySelectorAll(".match-footnote, .rail-caption").length'), 0);
  assert.equal(await execute('return document.querySelectorAll(".match-table .player-sites a").length'), 0);
  await checkHeaderInfo('.match-table', 8);
  // Player 2's country comes with its STRATZ summary, player 4's from the OpenDota fallback.
  await waitFor(
    () =>
      execute(
        'const flags=[...document.querySelectorAll(".match-table .country-flag")]; return flags.length === 2 && flags.every(img => img.complete && img.naturalWidth > 0)',
      ),
    'Country flags did not load',
  );
  assert.deepEqual(
    await execute(
      'return [...document.querySelectorAll(".match-table .country-flag")].map(img => [img.getAttribute("src"), img.title]).sort()',
    ),
    [
      ['./flags/DE.svg', 'Country: Germany · Steam profile via STRATZ'],
      ['./flags/FI.svg', 'Country: Finland · Steam profile via OpenDota'],
    ],
  );
  assert.ok(
    await execute('return document.querySelector(".app-toolbar").getBoundingClientRect().height <= 33'),
    'Title bar is not compact',
  );
  assert.equal(await execute('return document.querySelectorAll(".window-controls button").length'), 3);
  await assert.rejects(() => call('windowAction', 'unsupported'));
  await assert.rejects(() => call('resizeWindow', 'unsupported'));
  assert.equal(await execute('return document.querySelectorAll(".window-resize-edge").length'), 8);
  // A maximized window only differs where the screen has room beyond the configured
  // 1740×1100 window; on a smaller screen both actions run without the size check.
  const windowSize = () => execute('return [innerWidth, innerHeight]');
  const sameSize = (a, b) => a.every((value, i) => Math.abs(value - b[i]) <= 2);
  const restoredSize = await windowSize();
  const room = await execute('return screen.availWidth > 1760 && screen.availHeight > 1120');
  await execute('document.querySelector(`[aria-label="Maximize or restore window"]`).click();');
  if (room)
    await waitFor(
      async () => !sameSize(await windowSize(), restoredSize),
      'Maximize button did not change the native window',
    );
  await call('windowAction', 'maximize');
  if (room) await waitFor(async () => sameSize(await windowSize(), restoredSize), 'Native window did not restore');
  else
    console.log(
      `Maximize size not checked: screen ${await execute('return [screen.availWidth, screen.availHeight]')}.`,
    );
  assert.equal(await execute('return document.querySelectorAll(".hero-performance.positive").length'), 5);
  assert.equal(await execute('return document.querySelectorAll(".hero-performance.negative").length'), 5);
  assert.ok(
    await execute(`
    const el = document.querySelector('.hero-performance.positive');
    const saved = el.style.getPropertyValue('--hero-strength');
    el.style.setProperty('--hero-strength', '0.2');
    const weak = getComputedStyle(el.querySelector('.portrait')).backgroundColor;
    el.style.setProperty('--hero-strength', '0.8');
    const strong = getComputedStyle(el.querySelector('.portrait')).backgroundColor;
    el.style.setProperty('--hero-strength', saved);
    return weak !== strong;
  `),
    'Hero intensity is ignored by CSS',
  );
  // Profile links now live in the interactive player hover card, including Steam.
  await pointAt(await execute('return document.querySelector(".match-player")'));
  await waitFor(
    () => execute('return document.querySelectorAll(".player-preview .player-sites a").length === 4'),
    'Player hover card did not expose all four profile links',
  );
  await waitFor(
    () =>
      execute(
        'return [...document.querySelectorAll(".player-preview .player-site img")].every(img => img.complete && img.naturalWidth > 0)',
      ),
    'Local site icons failed to load',
  );
  assert.equal(
    await execute(
      'return [...document.querySelectorAll(".player-preview .player-sites a")].every(a => a.textContent.trim() && a.getAttribute("aria-label"))',
    ),
    true,
  );
  assert.ok(
    await execute(`
    const el = document.querySelector('.player-site');
    const before = [getComputedStyle(el).filter, getComputedStyle(el).opacity];
    el.focus();
    const after = [getComputedStyle(el).filter, getComputedStyle(el).opacity];
    el.blur();
    return before[0] === 'none' && before[1] === '1' && JSON.stringify(before) === JSON.stringify(after);
  `),
    'Site icon colors change on focus',
  );
  assert.equal(
    await execute('return document.querySelector(".player-preview .site-dotabuff").getAttribute("href")'),
    'https://www.dotabuff.com/players/1',
  );
  assert.equal(await call('openPlayerSite', '76561197960265729', 'stratz'), 'https://stratz.com/players/1');
  assert.equal(await call('openPlayerSite', '1', 'steam'), 'https://steamcommunity.com/profiles/76561197960265729');
  await assert.rejects(() => call('openMatchSite', '1', 'steam'));
  await assert.rejects(() => call('openPlayerSite', '1', 'https://untrusted.example'));
  await execute(
    'window.linkOpened = null; const original = window.ancient.openPlayerSite; window.ancient.openPlayerSite = async (...args) => { const url = await original(...args); window.linkOpened = url; return url; }; document.querySelector(".player-preview .site-opendota").click();',
  );
  await waitFor(
    () => execute('return window.linkOpened === "https://www.opendota.com/players/1"'),
    'Direct link did not reach native opener',
  );
  await pointAt();
  await execute('document.body.dispatchEvent(new MouseEvent("mousedown", {bubbles:true}))');
  await waitFor(
    () => execute('return document.querySelectorAll(".smurf-badge").length === 1'),
    'Lifetime smurf heuristic did not settle',
  );
  assert.equal(
    await execute(
      'return document.querySelector(".smurf-badge").closest(".player-name").querySelector("button").textContent',
    ),
    'Fixture 2',
    'Self/private profiles must not be labelled',
  );
  assert.ok(
    await execute(
      'return (document.querySelector(".smurf-badge").title || document.querySelector(".smurf-badge").dataset.title).includes("a heuristic, not proof")',
    ),
  );
  await clickButton('Fixture 2');
  assert.equal(
    await execute('return document.querySelector("dialog[open]")?.textContent.includes("Full profile")'),
    false,
  );
  // The player card loads the player's own history page; the profile below counts its own.
  await waitFor(
    () => execute('return document.querySelectorAll("dialog[open] .card-match-row").length === 25'),
    'Player card history did not load',
  );
  assert.equal(historyById.get('2'), 1, 'The player card loads one history page');
  await clickButton('Close');
  await execute('document.querySelector(".suggestion-tile img")?.dispatchEvent(new Event("error"));');
  await waitFor(
    () => execute('return !!document.querySelector(".suggestion-tile .portrait-fallback")?.textContent'),
    'Missing image left an anonymous suggestion',
  );
  const carouselCalls = draftRequests;
  const tileIds = (name) =>
    execute(
      'return [...document.querySelectorAll(`.suggestion-category[aria-label="${arguments[0]}"] .suggestion-tile`)].map(e=>e.dataset.heroId)',
      [name],
    );
  const firstCore = await tileIds('Core');
  const firstSupport = await tileIds('Support');
  await clickButton('Next Core heroes');
  const secondCore = await tileIds('Core');
  assert.equal(secondCore.length, 6);
  assert.ok(
    secondCore.every((id) => !firstCore.includes(id)),
    'Hero pages overlap',
  );
  assert.deepEqual(await tileIds('Support'), firstSupport, 'Core paging changed Support');
  await clickButton('Next Support heroes');
  assert.deepEqual(await tileIds('Core'), secondCore, 'Support paging changed Core');
  assert.equal(await execute('return document.querySelector(`[aria-label="Next Core heroes"]`).disabled'), true);
  const altArrow = (key) =>
    execute(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key:arguments[0],code:arguments[0],altKey:true,bubbles:true,cancelable:true}));',
      [key],
    );
  // The lane is shared by both panels and cycles with Alt+↑/↓. Shortcuts match `event.code`.
  for (const lane of ['Safe Lane', 'Off Lane', 'Mid Lane', 'All Lanes']) {
    await altArrow('ArrowDown');
    assert.equal(await execute('return document.querySelector(".lane-heading").textContent'), lane);
    assert.equal(
      await execute('return document.querySelectorAll(".suggestion-category").length'),
      lane === 'Mid Lane' ? 1 : 2,
    );
    const names =
      lane === 'Safe Lane'
        ? ['Safe Lane', 'Hard Support']
        : lane === 'Off Lane'
          ? ['Off Lane', 'Soft Support']
          : lane === 'Mid Lane'
            ? ['Mid Lane']
            : ['Core', 'Support'];
    assert.deepEqual(
      await execute(
        'return [...document.querySelectorAll(".suggestion-category")].map(el=>el.getAttribute("aria-label"))',
      ),
      names,
    );
    await waitFor(
      () =>
        execute(
          'return [...document.querySelectorAll(".suggestion-category h3 .role-icon")].every(img=>img.complete && img.naturalWidth===100)',
        ),
      'Draft role icons did not load',
    );
  }
  await altArrow('ArrowUp');
  assert.equal(await execute('return document.querySelector(".lane-heading").textContent'), 'Mid Lane');
  await execute(
    'const select=document.querySelector(".lane-select"); select.value = "0"; select.dispatchEvent(new Event("change", {bubbles:true}));',
  );
  await waitFor(
    () => execute('return document.querySelector(".lane-heading").textContent === "All Lanes"'),
    'Lane select did not change the lane',
  );
  assert.deepEqual(await tileIds('Core'), firstCore, 'Changing lane should reset hero pages');
  await execute(
    'const select=document.querySelector(`select[aria-label="Statistics period"]`); select.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowDown",code:"ArrowDown",altKey:true,bubbles:true}));',
  );
  assert.equal(
    await execute('return document.querySelector(".lane-heading").textContent'),
    'All Lanes',
    'Shortcut interfered with a form control',
  );
  await clickButton('Settings');
  await altArrow('ArrowDown');
  await clickButton('Match and draft');
  assert.equal(
    await execute('return document.querySelector(".lane-heading").textContent'),
    'All Lanes',
    'Hidden carousel consumed shortcut',
  );
  assert.equal(draftRequests, carouselCalls, 'Paging or lanes refetched draft data');
  assert.equal(await execute('return document.querySelectorAll(".matchup-cell").length'), 25);
  assert.ok(
    await execute(
      'return document.querySelectorAll(".matchup-cell.radiant").length > 0 && document.querySelectorAll(".matchup-cell.dire").length > 0',
    ),
  );
  assert.equal(await execute('return document.body.innerText.includes("Bans are not")'), false);
  // Left panel: matchups; right panel: suggestions of a side. Panels move independently.
  const panelPage = (label) =>
    execute('return document.querySelector(`.analysis-panel[aria-label="${arguments[0]}"]`)?.dataset.page', [label]);
  assert.equal(await panelPage('Left panel'), 'matchups');
  assert.equal(await panelPage('Right panel'), 'suggest-radiant');
  const matrixBefore = await execute('return document.querySelector(".advantage-matrix").innerHTML');
  const callsBefore = draftRequests;
  const switched = Date.now();
  await clickButton('Right panel: Picks for Dire');
  assert.equal(await panelPage('Right panel'), 'suggest-dire');
  assert.equal(await panelPage('Left panel'), 'matchups', 'Right panel moved the left one');
  assert.equal(
    await execute('return document.querySelector(".advantage-matrix").innerHTML'),
    matrixBefore,
    'Matchup team colors changed with recommendation side',
  );
  await clickButton('Right panel: Picks for Radiant');
  assert.ok(Date.now() - switched < 2000, 'Side switching should not wait for network');
  assert.equal(draftRequests, callsBefore, 'Side switching refetched draft data');
  // Shift+→ moves only the right panel; Alt+→ only the left one; both wrap.
  const arrow = (key, modifier) =>
    execute(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key:arguments[0],code:arguments[0],[arguments[1]]:true,bubbles:true,cancelable:true}));',
      [key, modifier],
    );
  await arrow('ArrowRight', 'shiftKey');
  assert.equal(await panelPage('Right panel'), 'suggest-dire');
  await arrow('ArrowLeft', 'altKey');
  assert.equal(await panelPage('Left panel'), 'counters-radiant', 'Left panel did not wrap backwards');
  await arrow('ArrowRight', 'altKey');
  assert.equal(await panelPage('Left panel'), 'matchups');
  // Lane summary: three lanes of both sides' heroes, in the panel's own height.
  const panelHeight = () =>
    execute(
      'return Math.round(document.querySelector(`.analysis-panel[aria-label="Right panel"]`).getBoundingClientRect().height)',
    );
  const suggestionHeight = await panelHeight();
  await clickButton('Right panel: Lanes');
  await waitFor(
    () => execute('return document.querySelectorAll(`.analysis-panel[data-page="lanes"] .lane-row`).length === 3'),
    'Lane page did not render',
  );
  assert.equal(await panelHeight(), suggestionHeight, 'Lane page changed the panel height');
  assert.deepEqual(
    await execute(
      'return [...document.querySelectorAll(".lane-row")].map(row => [row.dataset.lane, row.querySelectorAll(".lane-hero").length]).concat([[document.querySelectorAll(".lane-total").length]])',
    ),
    [['safe', 4], ['mid', 2], ['off', 4], [3]],
  );
  await clickButton('Right panel: Counter picks against Dire');
  await waitFor(
    () => execute('return !!document.querySelector(`.analysis-panel[data-page="counters-dire"] .counter-panel`)'),
    'Counter page did not open',
  );
  assert.deepEqual(
    await execute('return [...document.querySelectorAll(".counter-row")].map(row=>Number(row.dataset.enemyId))'),
    [6, 7, 8, 9, 10],
  );
  assert.ok(
    await execute(
      'return [...document.querySelectorAll(".counter-row")].every(row=>row.querySelectorAll(".counter-tile").length===10)',
    ),
  );
  assert.ok(
    await execute('return [...document.querySelectorAll(".counter-tile")].every(tile=>Number(tile.dataset.heroId)>10)'),
  );
  assert.ok(
    await execute(
      'return !!document.querySelector(".counter-tile.multiple") && document.querySelector(".counter-legend").textContent.includes("against multiple heroes")',
    ),
  );
  assert.ok(
    await execute(
      'const panel=document.querySelector(".counter-panel").getBoundingClientRect(); const card=document.querySelector(`.analysis-panel[data-page="counters-dire"]`).getBoundingClientRect(); return panel.right <= card.right + 1 && panel.bottom <= card.bottom + 1',
    ),
    'Counter list overflows its panel',
  );
  await clickButton('Right panel: Counter picks against Radiant');
  await waitFor(
    () => execute('return document.querySelector(".counter-row")?.dataset.enemyId === "1"'),
    'Counter side did not change',
  );
  await clickButton('Right panel: Counter picks against Dire');
  await mkdir('test-results', { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await screenshot('counters');
  await clickButton('Right panel: Picks for Radiant');
  assert.equal(draftRequests, callsBefore, 'Counter tab requested new draft data');
  await clickButton('Right panel: Meta');
  await waitFor(
    () => execute('return !!document.querySelector(`.analysis-panel[data-page="meta"] .meta-panel`)'),
    'Meta tab did not open',
  );
  for (const role of ['Safe Lane', 'Mid Lane', 'Off Lane', 'Soft Support', 'Hard Support']) {
    await execute(
      'document.querySelector(`.analysis-panel[aria-label^=Right] .meta-roles button[aria-label="${arguments[0]}"]`).click()',
      [role],
    );
    await waitFor(
      () =>
        execute(
          'return document.querySelector(".analysis-panel[aria-label^=Right] .meta-roles [aria-pressed=true]")?.getAttribute("aria-label") === arguments[0]',
          [role],
        ),
      'Meta role did not switch',
    );
    assert.equal(
      await execute('return document.querySelector(".analysis-panel[aria-label^=Right] .meta-panel h3").textContent'),
      role,
    );
    assert.deepEqual(
      await execute(
        'return [...document.querySelectorAll(".analysis-panel[aria-label^=Right] .meta-tile")].map(el=>Number(el.dataset.heroId))',
      ),
      [11, 12, 13, 14, 15, 16],
    );
    assert.ok(
      await execute(
        'return [...document.querySelectorAll(".analysis-panel[aria-label^=Right] .meta-tile b")].every(el=>el.textContent==="50%")',
      ),
    );
  }
  await waitFor(
    () =>
      execute(
        'return [...document.querySelectorAll(".analysis-panel[aria-label^=Right] .meta-roles .role-icon")].every(img=>img.complete && img.naturalWidth===100)',
      ),
    'Meta role icons failed to load',
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  await screenshot('meta');
  await clickButton('Right panel: Picks for Radiant');
  assert.equal(draftRequests, callsBefore, 'Meta tab or role switching requested draft data');
  // A slow period refresh must retain rows and identify the old selection.
  delaySummaries = true;
  await execute(
    'const select = document.querySelector(`select[aria-label="Statistics period"]`); select.value = "30"; select.dispatchEvent(new Event("change", {bubbles:true}));',
  );
  await waitFor(
    () => execute('return document.querySelectorAll(".previous-selection").length === 10'),
    'Prior period was not retained and marked',
  );
  assert.equal(
    await execute('return [...document.querySelectorAll(".all-time")].every(cell => cell.textContent.includes("%"))'),
    true,
  );
  await waitFor(async () => pendingSummaries.length === 2, 'Refresh batches were not dispatched');
  delaySummaries = false;
  pendingSummaries.splice(0).forEach((resolve) => resolve());
  await waitFor(
    () =>
      execute(
        'return document.querySelectorAll(".previous-selection").length === 0 && ![...document.querySelectorAll("[role=status]")].some(e=>e.textContent === "Updating…")',
      ),
    'Period did not refresh',
  );
  await mkdir('test-results', { recursive: true });
  await screenshot('match');
  // Player-mode GSI supplies only self: unavailable rows must not look like pending API calls.
  const selfPayload = {
    ...payload,
    player: { steamid: String(76561197960265729n), name: 'Fixture 1', team_name: 'dire' },
    hero: { id: 1, name: heroes[0].name },
  };
  assert.equal((await post(selfPayload)).status, 200);
  await waitFor(
    () =>
      execute(
        'return document.body.innerText.includes("Players available: 1/10") && document.querySelector(".draft-scope")?.textContent.includes("1/10")',
      ),
    'Player-mode coverage was not shown',
  );
  await waitFor(
    () => execute('return document.querySelectorAll(".suggestion-tile").length === 12'),
    'Partial draft recommendations missing',
  );
  await assertPanelContentsFit();
  for (const scale of [80, 90, 100, 110, 120]) {
    await setScale(scale);
    for (const lane of [0, 1, 2, 3]) {
      await post(selfPayload);
      await execute(
        'const select=document.querySelector(`select[aria-label="Recommendation lane"]`); select.value=String(arguments[0]); select.dispatchEvent(new Event("change", {bubbles:true}));',
        [lane],
      );
      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitFor(matchFits, 'Partial draft does not fit');
      await assertPanelContentsFit();
    }
  }
  await setScale(100);
  await execute(
    'const select=document.querySelector(`select[aria-label="Recommendation lane"]`); select.value="0"; select.dispatchEvent(new Event("change", {bubbles:true}));',
  );
  assert.equal(await execute('return document.querySelectorAll("tr.unavailable").length'), 9);
  assert.deepEqual(
    await execute(
      'return [...document.querySelectorAll(`[aria-label="Left panel: panels"] button`)].map(b=>b.getAttribute("aria-label"))',
    ),
    [
      'Left panel: Hero matchups',
      'Left panel: Lanes',
      'Left panel: Picks for your team',
      'Left panel: Picks for Radiant',
      'Left panel: Meta',
      'Left panel: Counter picks against Radiant',
    ],
    'Own side should come first and a player should only get counters to the enemy',
  );
  assert.equal(
    await execute(
      'return [...document.querySelectorAll("tr.unavailable .all-time")].every(cell => cell.textContent === "—")',
    ),
    true,
  );
  assert.equal(
    await execute(
      'return [...document.querySelectorAll("tr.unavailable")].every(row => row.textContent.includes("Not provided by the game") && !row.textContent.includes("Waiting for player"))',
    ),
    true,
  );
  assert.equal(await execute('return document.querySelectorAll("tr.unavailable .rank-medal").length'), 0);
  await waitFor(() => execute('return !!document.querySelector(".reader-notice")'), 'Disabled reader banner missing');
  await execute('document.querySelector(".reader-notice summary").click()');
  const riskText = await execute('return document.querySelector(".reader-notice p").textContent');
  assert.ok(riskText.includes('The anti-cheat response is unknown'));
  await clickButton('Enable in Settings');
  await waitFor(
    () => execute('return !!document.querySelector(".reader-settings")'),
    'Banner did not navigate to settings',
  );
  assert.equal(await execute('return document.querySelector(".reader-settings .muted").textContent'), riskText);
  assert.equal(
    await execute('return document.querySelector(".reader-settings input").checked'),
    false,
    'Banner enabled reading without consent',
  );
  await clickButton('Match and draft');
  await waitFor(
    () => execute('return document.querySelector("nav button.active")?.textContent === "Match and draft"'),
    'Match did not reopen after reader settings',
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  await screenshot('player');
  assert.equal((await post(payload)).status, 200);
  await waitFor(
    () =>
      execute(
        'return document.querySelectorAll("tr.unavailable").length === 0 && !document.querySelector(".draft-scope")',
      ),
    'Full spectator roster did not recover',
  );
  await waitFor(
    () =>
      execute('return !!document.querySelector(".suggestion-tile") && !document.querySelector(".carousel-loading")'),
    'Debounced spectator draft did not settle before settings checks',
  );
  assert.equal(
    await execute('return !!document.querySelector(".reader-notice")'),
    false,
    'Spectator saw reader banner',
  );
  await clickButton('Settings');
  await waitFor(() => execute('return document.body.innerText.includes("Include Turbo")'), 'Settings did not load');
  await waitFor(
    () => execute('return document.querySelector(".provider-settings h2")?.textContent.includes("STRATZ")'),
    'Provider settings did not load',
  );
  assert.equal(await execute('return document.querySelectorAll("input[type=password]").length'), 0);
  assert.equal(await execute('return document.querySelector(".stats-preferences input").checked'), false);
  const beforeTurboBatches = batches.length;
  const toggle = await execute('return document.querySelector(".stats-preferences input")');
  await app.clickElement(toggle);
  await waitFor(
    () => execute('return localStorage.getItem("ancient-include-turbo") === "true"'),
    'Turbo setting was not saved',
  );
  // Settings polish: section list, keycaps, labelled synergy stops, ranked-only, tray state.
  assert.deepEqual(
    await execute('return [...document.querySelectorAll(".settings-sections button")].map(b=>b.textContent)'),
    [
      'Dota 2',
      'STRATZ',
      'Memory reading',
      'Match statistics',
      'Appearance',
      'Shortcuts',
      'Sound',
      'Window',
      'Your data',
      'Updates',
    ],
  );
  await clickButton('Window');
  await waitFor(
    () =>
      execute(
        'const r=document.getElementById("settings-window").getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight + 1',
      ),
    'Section list did not scroll to the window settings',
  );
  const appInfo = await call('getInfo');
  if (appInfo.shortcut)
    assert.ok(
      await execute('return document.querySelectorAll("#settings-window kbd").length >= 2'),
      'Shortcut keycaps',
    );
  const windowOption = (label) =>
    execute(
      'const box = [...document.querySelectorAll("#settings-window label")].find(l => l.textContent.includes(arguments[0]))?.querySelector("input[type=checkbox]"); return box ? {disabled: box.disabled, checked: box.checked} : null',
      [label],
    );
  assert.equal(
    (await windowOption('keeps Ancient Lens in the tray'))?.disabled,
    appInfo.tray ? false : true,
    'Tray option must be disabled exactly when no tray host exists',
  );
  assert.deepEqual(
    await windowOption('Minimize when you switch to another app'),
    { disabled: !appInfo.autoHide, checked: !!appInfo.autoHide },
    'Hiding for another app must be on, and disabled exactly where the desktop cannot report the active window',
  );
  assert.deepEqual(
    await windowOption('Window keys only while Dota is in front'),
    { disabled: !appInfo.keysOverGame, checked: !!appInfo.keysOverGame },
    'Keys over the game must be on, and disabled exactly where the keys cannot be released',
  );
  assert.deepEqual(
    await execute(
      'return [...document.getElementById("synergy-weight").parentElement.querySelectorAll(".range-stops button")].map(b=>b.textContent)',
    ),
    ['0%', '25%', '50%', '75%', '100%'],
  );
  assert.equal(await execute('return document.getElementById("synergy-weight").disabled'), false);
  await execute(
    '[...document.getElementById("synergy-weight").parentElement.querySelectorAll(".range-stops button")].find(b=>b.textContent==="25%").click()',
  );
  await waitFor(
    () =>
      execute(
        'return localStorage.getItem("ancient-synergy-weight") === "25" && document.getElementById("synergy-weight").value === "25"',
      ),
    'Synergy stop was not saved',
  );
  await execute(
    '[...document.getElementById("synergy-weight").parentElement.querySelectorAll(".range-stops button")].find(b=>b.textContent==="50%").click()',
  );
  // Minimum win rate for suggestions: off by default at 50%, stops only while enabled.
  const minWinRate = (script) =>
    execute(
      `const box=document.querySelector("[aria-label='Minimum hero win rate for suggestions']").parentElement;${script}`,
    );
  assert.deepEqual(
    await minWinRate(
      'return [box.querySelector("input[type=checkbox]").checked, box.querySelector("input[type=range]").disabled, [...box.querySelectorAll(".range-stops button")].map(b=>b.textContent)]',
    ),
    [false, true, ['40%', '45%', '50%', '55%']],
  );
  await minWinRate('box.querySelector("input[type=checkbox]").click()');
  await waitFor(
    () => execute('return localStorage.getItem("ancient-min-win-rate") === "on:50"'),
    'Minimum win rate was not enabled',
  );
  await minWinRate('[...box.querySelectorAll(".range-stops button")].find(b=>b.textContent==="45%").click()');
  await waitFor(
    () => execute('return localStorage.getItem("ancient-min-win-rate") === "on:45"'),
    'Minimum win rate stop was not saved',
  );
  await minWinRate('box.querySelector("input[type=checkbox]").click()');
  await waitFor(
    () => execute('return localStorage.getItem("ancient-min-win-rate") === "off:45"'),
    'Minimum win rate was not disabled',
  );
  await execute(
    'localStorage.removeItem("ancient-min-win-rate"); window.dispatchEvent(new Event("stats-preferences"))',
  );
  const ranked = await execute(
    'return [...document.querySelectorAll(".stats-preferences label")].find(l=>l.textContent.includes("Ranked statistics only")).querySelector("input")',
  );
  await app.clickElement(ranked);
  await waitFor(
    () => execute('return localStorage.getItem("ancient-ranked-only") === "true"'),
    'Ranked-only setting was not saved',
  );
  await app.clickElement(ranked);
  await waitFor(
    () => execute('return localStorage.getItem("ancient-ranked-only") === "false"'),
    'Ranked-only setting was not restored',
  );
  await execute('document.querySelector("main")?.scrollTo(0, 0); window.scrollTo(0, 0);');

  await waitFor(
    async () =>
      batches.length >= beforeTurboBatches + 2 &&
      (await execute(
        'return !document.querySelector(".match-toolbar [role=status]") && !document.querySelector(".previous-selection")',
      )),
    'Turbo refresh did not finish before scale checks',
  );
  const scaleBatches = batches.length;
  const scaleDraftRequests = draftRequests;
  const toolbarHeights = [];
  for (const scale of [80, 90, 100, 110, 120]) {
    await clickButton(`${scale}%`, '.scale-options button');
    await waitFor(
      () =>
        execute(
          'return Number(document.querySelector(".app-shell").style.zoom) === arguments[0] / 100 && document.querySelector(".scale-options button[aria-pressed=true]").textContent === `${arguments[0]}%`',
          [scale],
        ),
      'Scale controls did not stay in sync',
    );
    assert.equal(await execute('return JSON.parse(localStorage.getItem("ancient-display")).scale'), scale);
    await clickButton('Match and draft');
    await waitFor(
      () => execute('return document.querySelector("nav button.active")?.textContent === "Match and draft"'),
      'Match tab did not render',
    );
    const geometry = await execute(
      'const shell = document.querySelector(".app-shell").getBoundingClientRect(); return {right:shell.right,width:innerWidth,toolbar:document.querySelector(".app-toolbar").getBoundingClientRect().height,bottom:document.querySelector(".match-roster").getBoundingClientRect().bottom,stripTop:document.querySelector(".analysis-strip").getBoundingClientRect().top,overflow:document.documentElement.scrollWidth > innerWidth + 2};',
    );
    await waitFor(matchFits, `Match does not fit at ${scale}%`).catch(async (error) => {
      const boxes = await execute(
        'const box = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && [Math.round(r.top), Math.round(r.bottom), Math.round(r.right)]; }; return {page: box(".match-page"), fit: box(".match-fit"), zoom: document.querySelector(".match-fit").style.zoom, scroll: document.querySelector(".match-page").className, panels: [...document.querySelectorAll(".analysis-panel")].map(el => { const r = el.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; }), innerHeight, thead: box(".match-table thead"), headRows: [...document.querySelectorAll(".match-table thead tr")].map(r => Math.round(r.getBoundingClientRect().height)), tall: [...document.querySelectorAll(".match-table thead .column-info")].map(c => Math.round(c.getBoundingClientRect().height)), panelCss: (() => { const st = getComputedStyle(document.querySelector(".analysis-panel")); return [st.height, st.minHeight]; })(), roster: box(".match-roster"), strip: box(".analysis-strip"), parts: [...document.querySelectorAll(".analysis-panel")].map(p => [p.dataset.page, ...[...p.children].map(c => c.className + ":" + Math.round(c.getBoundingClientRect().height))])}',
      );
      throw new Error(`${error.message}: ${JSON.stringify(boxes)}`);
    });
    assert.ok(geometry.right <= geometry.width + 2, `Scale ${scale}% escapes the window`);
    assert.equal(
      geometry.overflow,
      false,
      `Scale ${scale}% causes horizontal page overflow: ${JSON.stringify(geometry)}`,
    );
    // Both carousels stay directly below the roster and inside the viewport.
    assert.ok(
      geometry.stripTop >= geometry.bottom && geometry.stripTop - geometry.bottom <= 20,
      `Scale ${scale}% separates the carousels from the roster: ${JSON.stringify(geometry)}`,
    );
    for (const page of ['Counter picks against Dire', 'Meta', 'Lanes', 'Picks for Radiant']) {
      await clickButton(`Right panel: ${page}`);
      await waitFor(matchFits, `${page} does not fit at ${scale}%`);
      await assertPanelContentsFit();
      assert.ok(
        await execute(
          'const card=document.querySelector(`.analysis-panel[aria-label="Right panel"]`); const content=card.querySelector(".analysis-content").getBoundingClientRect(); const box=card.getBoundingClientRect(); return content.right <= box.right + 1 && content.bottom <= box.bottom + 1',
        ),
        `${page} overflows its panel at ${scale}%`,
      );
    }
    toolbarHeights.push(geometry.toolbar);
    if (scale === 80 || scale === 120) {
      await new Promise((resolve) => setTimeout(resolve, 250)); // Let WebKit present the new scale before capture.
      await screenshot(`scale-${scale}`);
    }
    await clickButton('Settings');
    await waitFor(() => execute('return !!document.querySelector(".scale-options")'), 'Scale settings did not render');
  }
  assert.ok(
    toolbarHeights[4] > toolbarHeights[0] * 1.4,
    'Scale must change rendered controls, while rows adapt to available height',
  );
  assert.equal(batches.length, scaleBatches, 'Scaling must not reload player statistics');
  assert.equal(draftRequests, scaleDraftRequests, 'Scaling must not recalculate remote draft data');
  await clickButton('90%', '.scale-options button');
  await waitFor(
    () =>
      execute(
        'return document.querySelector(".app-shell").style.zoom === "0.9" && document.querySelector(".scale-options button[aria-pressed=true]").textContent === "90%"',
      ),
    'Scale buttons did not update the window',
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  await screenshot('scale-settings');
  await execute('document.querySelector(".display-settings fieldset input").click();');
  await waitFor(
    () => execute('return getComputedStyle(document.querySelector(".rank-cell")).display === "none"'),
    'Rank column did not hide',
  );
  await clickButton('Reset appearance');
  await waitFor(
    () => execute('return getComputedStyle(document.querySelector(".rank-cell")).display === "table-cell"'),
    'Display reset did not restore rank column',
  );
  await clickButton('Match and draft');
  // Native window sizes need a desktop-sized screen; the Windows CI runner has 1024×768.
  const desktopScreen = await execute('return screen.availWidth >= 1740 && screen.availHeight >= 1100');
  // The smallest window: the window manager stops a Linux window at its minimum. Windows applies
  // a window's minimum only while the user resizes it, so there the window is set to the
  // minimum the app computes for this screen.
  const minimum = await call('setWindowMinSize', 100);
  const smallest = platform === 'linux' ? [800, 600] : [minimum.width, minimum.height];
  if (desktopScreen) {
    const resizeFits = [];
    for (const [width, height] of [smallest, [1280, 800], [1740, 1100]]) {
      await app.resize(width, height);
      await waitFor(matchFits, `Match does not fit ${width}×${height}`);
      if (width === smallest[0]) {
        // The window stops at the size that shows the whole match screen at 100%: no scrolling.
        await waitFor(
          () =>
            execute(
              'return innerWidth >= 1029 && innerHeight >= 919 && !document.querySelector(".match-page").classList.contains("match-scroll") && document.documentElement.scrollWidth <= innerWidth + 2',
            ),
          'Window shrank below the match minimum or the match scrolls',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      await assertPanelContentsFit();
      resizeFits.push(await execute('return Number(document.querySelector(".match-fit").style.zoom)'));
      await screenshot(`fit-${width}`);
    }
    assert.ok(resizeFits[2] > resizeFits[0], 'Match did not grow back after enlarging the window');
    await app.resize(1710, 927);
    await waitFor(() => execute('return innerHeight <= 940 && innerWidth <= 1720'), 'Native window did not resize');
    await waitFor(matchFits, 'Match does not fit screenshot-sized window');
    const fitted = await execute(
      'const panels=[...document.querySelectorAll(".analysis-panel")].map(p=>p.getBoundingClientRect()); return {roster:document.querySelector(".match-roster").getBoundingClientRect().bottom,tops:panels.map(p=>p.top),lefts:panels.map(p=>p.left),overflow:document.documentElement.scrollWidth > innerWidth+2}',
    );
    assert.ok(
      !fitted.overflow &&
        Math.abs(fitted.tops[0] - fitted.tops[1]) < 3 &&
        fitted.lefts[1] > fitted.lefts[0] &&
        fitted.tops[0] >= fitted.roster,
      `Screenshot-sized window does not fit: ${JSON.stringify(fitted)}`,
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    await screenshot('fit-927');
  } else {
    // The window still cannot shrink below the minimum the app computes for this screen.
    await app.resize(...smallest);
    await waitFor(
      () =>
        execute('return innerWidth >= arguments[0] - 2 && innerHeight >= arguments[1] - 2', [
          minimum.width,
          minimum.height,
        ]),
      `Window shrank below its minimum ${JSON.stringify(minimum)}`,
    );
    await waitFor(matchFits, 'Match does not fit the smallest window');
    await assertPanelContentsFit();
    console.log(
      `Window size checks limited to the minimum: screen ${await execute('return [screen.availWidth, screen.availHeight]')}.`,
    );
    await app.resize(1710, 927);
  }
  // The header icon brings up the profile window, which has the profile alone.
  await clickButton('My profile');
  await useWindow('profile');
  await execute(
    'window.smokeErrors = []; addEventListener("error", e => window.smokeErrors.push(e.message)); addEventListener("unhandledrejection", e => window.smokeErrors.push(String(e.reason)));',
  );
  await app.resize(1710, 927);
  assert.equal(await execute('return document.querySelector(".compact-brand")?.textContent'), 'My profile');
  assert.equal(await execute('return document.querySelectorAll("nav[aria-label=Sections]").length'), 0);
  assert.equal(
    await execute(
      'return [...document.querySelectorAll("nav button")].some(b => ["Player profile", "My rating"].includes(b.textContent.trim()))',
    ),
    false,
  );
  assert.equal(
    (await call('getState')).accountId,
    '1',
    'Spectating or opening another player must not replace my account',
  );
  const profileRows = () => execute('return document.querySelectorAll(".profile-table tbody tr").length');
  await waitFor(
    async () =>
      (await execute('return document.querySelector(".own-profile .profile-name-text")?.textContent')) ===
        'My STRATZ profile' && (await profileRows()) === 25,
    'STRATZ profile did not load',
  );
  assert.equal(historyById.get('1'), 1, 'Showing the profile window must not reload its history');
  // GPM of the latest match against the bracket average of its hero on the safe lane (600),
  // with the ten players of the match in its card.
  const gpmCell = await execute(
    'const cell=document.querySelector(`.profile-table tbody tr:first-child td[data-column="gold_per_min"] [data-tip]`); cell?.scrollIntoView({block:"center",inline:"center",behavior:"instant"}); return cell',
  );
  assert.ok(gpmCell, 'GPM of a match with a lineup has no card');
  await waitFor(
    () =>
      execute(
        'return document.querySelector(`.profile-table tbody tr:first-child td[data-column="gold_per_min"] span`)?.className === "stat-band-2"',
      ),
    'GPM was not coloured against the bracket average',
  );
  await pointAt(gpmCell);
  await waitFor(
    () => execute('return document.querySelectorAll(".tooltip .match-rank li").length === 10'),
    'Ten-player card did not open on hover',
  );
  assert.deepEqual(
    await execute(
      'return [document.querySelectorAll(".tooltip").length, document.querySelector(".tooltip .tip-verdict")?.textContent, [...document.querySelectorAll(".tooltip .match-rank b")].map(b=>b.textContent), document.querySelector(".tooltip .match-rank li.own b")?.textContent]',
    ),
    [
      1,
      'Below typical · 450 vs 600 avg Hero 1 Safe Lane',
      ['660', '620', '540', '500', '460', '450', '420', '380', '340', '—'],
      '450',
    ],
  );
  await pointAt();
  await waitFor(() => execute('return !document.querySelector(".tooltip")'), 'Ten-player card stayed open');
  // The Bracket column was removed in #25.
  assert.ok(
    await execute('return !document.querySelector(`.profile-table [data-column="bracket"]`)'),
    'The removed bracket column is back',
  );
  // MMR chart: hovering opens the card of a measured match; Enter opens its details.
  const plot = await execute(
    'const plot=document.querySelector(".mmr-plot"); plot?.scrollIntoView({block:"center",behavior:"instant"}); return plot',
  );
  if (plot) {
    await pointAt(plot);
    await waitFor(
      () => execute('return !!document.querySelector(".tooltip .tip-match")'),
      'MMR point card did not open',
    );
    await pointAt();
    await app.type(plot, '');
    await waitFor(
      () => execute('return !!document.querySelector(".profile-aside.open .profile-match")'),
      'A chart point did not open its match',
    );
    await clickButton('Close match details');
    await execute('document.activeElement.blur()');
  }
  assert.ok(
    (await execute('return document.querySelector(".profile-score").textContent')).includes('1 W'),
    'Current streak is missing from the summary',
  );
  const pick = (group, label) =>
    execute(
      'const b=[...document.querySelectorAll(`[aria-label="${arguments[0]}"] button`)].find(b=>b.textContent===arguments[1]); b.click();',
      [group, label],
    );
  for (const [label, count] of [
    ['Wins', 13],
    ['Losses', 12],
    ['All', 25],
  ]) {
    await pick('Result', label);
    await waitFor(async () => (await profileRows()) === count, `Result ${label} did not re-select history`);
    assert.ok(
      (await execute('return document.querySelector(".profile-score").textContent')).includes('1 W'),
      'Outcome filter changed the current streak',
    );
  }

  // Filters re-select loaded history; every active filter is a chip that clears itself.
  const choose = (label, value) =>
    execute(
      'const select=document.querySelector(`[aria-label="${arguments[0]}"]`); select.value=arguments[1]; select.dispatchEvent(new Event("change",{bubbles:true}));',
      [label, value],
    );
  const chips = () => execute('return [...document.querySelectorAll(".filter-chip")].map(c=>c.textContent)');
  const requestsBeforeFilters = historyRequests;
  const tableTop = () => execute('return document.querySelector(".profile-table").getBoundingClientRect().top');
  // An open menu floats over the page inside the window: its centre is the menu itself, and the
  // page does not grow (a menu left in the page flow lands below the window and adds a scrollbar).
  const pageHeight = () => execute('return document.documentElement.scrollHeight');
  const menuShown = (label) =>
    waitFor(
      () =>
        execute(
          'const menu=document.querySelector(`.profile-menu[aria-label="${arguments[0]}"]`); if(!menu) return false; const r=menu.getBoundingClientRect(); if(getComputedStyle(menu).visibility!=="visible" || r.width<40 || r.height<40 || r.top<0 || r.left<0 || r.bottom>innerHeight || r.right>innerWidth) return false; return menu.contains(document.elementFromPoint(r.left+r.width/2, r.top+r.height/2))',
          [label],
        ),
      `The ${label} menu did not open inside the window`,
      5000,
    );
  const before = await tableTop();
  const height = await pageHeight();
  await clickButton('Filter Safe Lane');
  await clickButton('More');
  await menuShown('More');
  assert.equal(await pageHeight(), height, 'Opening More made the page taller');
  assert.ok(Math.abs((await tableTop()) - before) < 1, 'Opening More moved the table');
  await choose('Profile duration', 'medium');
  await waitFor(async () => (await profileRows()) === 5, 'Position filter did not re-select history');
  assert.deepEqual(await chips(), ['Safe Lane', '25–40 min']);
  await choose('Profile duration', 'short');
  await waitFor(async () => (await profileRows()) === 0, 'Duration filter did not re-select history');
  await clickButton('Close more');
  if (
    await execute(
      'return [...document.querySelectorAll(".profile-menu-trigger")].some(b=>b.textContent.trim()==="Columns" && b.offsetParent)',
    )
  ) {
    await clickButton('Columns');
    await menuShown('Columns');
    assert.equal(await pageHeight(), height, 'Opening Columns made the page taller');
    await clickButton('Close columns');
  }
  await execute('document.querySelector(`[aria-label="Clear filter: Under 25 min"]`).click()');
  await waitFor(async () => (await chips()).join() === 'Safe Lane', 'Chip × did not clear its filter');
  await execute('document.querySelector(`[aria-label="Clear filter: Safe Lane"]`).click()');
  await waitFor(async () => (await profileRows()) === 25, 'Clearing the last chip did not restore the history');
  assert.deepEqual(await chips(), []);
  assert.equal(historyRequests, requestsBeforeFilters, 'Filters must not reload history');
  assert.equal(await execute('return document.querySelectorAll(".profile-position").length'), 5);
  await waitFor(
    () =>
      execute(
        'const icons=[...document.querySelectorAll(".profile-position .role-icon")]; return icons.length===5 && icons.every(img=>img.complete && img.naturalWidth===100)',
      ),
    'Profile role icons did not load',
  );
  // Match details replace the Heroes panel and close again.
  await execute('document.querySelector(".profile-table tbody tr").click()');
  await waitFor(
    () => execute('return document.querySelector(".profile-aside .profile-match")?.textContent.includes("Radiant")'),
    'Match details did not open',
  );
  await clickButton('Close match details');
  await waitFor(
    () => execute('return !!document.querySelector(".profile-aside .profile-heroes")'),
    'Heroes did not return',
  );

  assert.ok(
    await execute('return document.querySelector(".profile-table").getBoundingClientRect().top < 560'),
    'Profile header pushes match history too far down',
  );
  await clickButton('Load older matches');
  await waitFor(
    () => execute('return document.querySelector(".profile-more")?.textContent.includes("49 saved matches")'),
    'History pages were not merged without duplicates',
  );
  assert.equal((await call('getHistory', '1', 0, true)).matches.length, 49);
  assert.equal(await profileRows(), 49);
  // One page scroll: the filter bar and the table header stick under each other.
  assert.ok(
    await execute(
      'const main=document.querySelector("main"); main.scrollTop=600; const bar=document.querySelector(".profile-bar").getBoundingClientRect(), th=document.querySelector(".profile-table th").getBoundingClientRect(), top=main.getBoundingClientRect().top; return Math.abs(bar.top-top)<2 && Math.abs(th.top-bar.bottom)<3',
    ),
    'Filter bar and table header did not stick',
  );
  await execute('document.querySelector("main").scrollTo(0,0); window.scrollTo(0,0);');
  await new Promise((resolve) => setTimeout(resolve, 250));
  await screenshot('profile');
  privateHistory = true;
  const privateResponse = await call('getHistory', '1', 0, false, true);
  assert.ok(privateResponse?.warning?.includes('STRATZ history is private'), 'Private response status was lost');
  await clickButton('Refresh');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await waitFor(
    () => execute('return !document.querySelector(".own-profile .loading-icon")'),
    'Private refresh did not finish',
  );
  // Saved matches stay on screen; the provider note takes no room while they show.
  assert.equal(await execute('return document.querySelectorAll(".profile-table tbody tr").length'), 49);
  assert.ok(
    !(await execute('return document.querySelector(".own-profile").textContent.includes("STRATZ history is private")')),
    'Private history note shown over saved matches',
  );
  failHistory = true;
  const failedResponse = await call('getHistory', '1', 0, false, true);
  assert.ok(
    JSON.stringify(failedResponse).includes('503') && failedResponse.matches.length === 49,
    'Cached history was not used after network failure',
  );
  await clickButton('Refresh');
  await new Promise((resolve) => setTimeout(resolve, 300));
  await waitFor(
    () => execute('return !document.querySelector(".own-profile .loading-icon")'),
    'Failed refresh did not finish',
  );
  assert.equal(await execute('return document.querySelectorAll(".profile-table tbody tr").length'), 49);
  assert.equal(await call('getHistory', '3', 0, true), null, 'Another account must not inherit cached history');
  // Account 2 was opened in the player card: its cache is its own page, not account 1's.
  const otherHistory = await call('getHistory', '2', 0, true);
  assert.ok(
    otherHistory?.accountId === '2' && otherHistory.matches.length === 25,
    'Player card history mixed accounts',
  );
  const savedHistory = JSON.parse(await readFile(join(cache, 'history-STRATZ-1.json'), 'utf8'));
  assert.equal(savedHistory.matches.length, 49);
  assert.equal(savedHistory.source, 'STRATZ');

  assert.deepEqual(await execute('return window.smokeErrors'), []);
  await useWindow('main');

  // Deliver draft fixtures to the native event listener; keep frontend emit ACL closed.
  // The memory reader/worker are exercised separately by Rust fixtures, never Dota.
  await clickButton('Match and draft');
  const draftMatches = new Set();
  async function emitDraft(
    matchId,
    picks,
    gameState = 'DOTA_GAMERULES_STATE_HERO_SELECTION',
    bans = [],
    hovers = [],
    lanes = [],
    draftStatus = 'ready',
    { warmUp = false, ...extra } = {},
  ) {
    if (!draftMatches.has(matchId)) {
      draftMatches.add(matchId);
      refuseWarmUp = !warmUp;
    }
    const now = Date.now();
    const slots = Array.from({ length: 10 }, (_, slot) => ({
      slot,
      team: slot < 5 ? 'radiant' : 'dire',
      teamSlot: ((slot % 5) + 2) % 5,
    }));
    const frame = {
      status: 'connected',
      receivedAt: now,
      matchId,
      gameState,
      mode: 'player',
      players: [{ key: 'self', team: 'dire' }],
      selfTeamSlot: 3,
      draftStatus,
      draft: { matchId, gameState, source: 'native', observedAt: now, picks, bans, hovers, lanes, slots },
      ...extra,
    };
    const count = await execute(
      'const listeners=window.__internal_unstable_listeners_object_id__?.["live:update"]; const ids=Object.getOwnPropertyNames(listeners ?? {}); window.__internal_unstable_listeners_function_id__({event:"live:update",payload:arguments[0]},ids); return ids.length;',
      [frame],
    );
    assert.ok(count > 0, 'Native live event listener was not registered');
  }
  const beforeAnonymous = batches.length;
  const beforeTotals = totalBatches.length;
  const beforeDraft = draftRequests;
  const picks = [
    { slot: 0, team: 'radiant', heroId: 11 },
    { slot: 5, team: 'dire', heroId: 12 },
  ];
  await emitDraft('800001', picks, undefined, [], [], [], 'ready', {
    players: [{ key: 'self', team: 'dire', accountId: '42', name: 'Hidden self' }],
  });
  await waitFor(
    () =>
      execute(
        'return document.querySelectorAll(".suggestion-tile").length > 0 && document.querySelectorAll(".matchup-cell").length === 25 && document.querySelectorAll(".matchup-cell .portrait").length === 1',
      ),
    'Anonymous picks did not load recommendations/matchups',
  );
  assert.equal(await execute('return document.querySelectorAll(".match-table .player-sites a").length'), 0);
  // Linux draft slots give the colour of each row's player ID; rows without a slot get none.
  assert.ok(
    await execute(
      'const colours=["#3375ff","#66ffbf","#bf00bf","#f3f00b","#ff6b00","#fe86c2","#a1b447","#65d9f7","#008321","#a46900"]; const rows=[...document.querySelectorAll(".match-table tbody tr[data-team-slot]")]; return rows.length === 10 && rows.every(r => { const a=r.querySelector(".player-avatar"); const slot=r.dataset.slot; return slot === undefined ? !a.classList.contains("slot-frame") : getComputedStyle(a).getPropertyValue("--slot-colour").trim() === colours[Number(slot)]; })',
    ),
    `Slot colours do not follow the Linux draft slots: ${JSON.stringify(
      await execute(
        'return [...document.querySelectorAll(".match-table tbody tr[data-team-slot]")].map(r => [r.dataset.slot, r.querySelector(".player-avatar")?.className, r.querySelector(".player-avatar") && getComputedStyle(r.querySelector(".player-avatar")).getPropertyValue("--slot-colour")])',
      ),
    )}`,
  );
  assert.equal(await execute('return document.querySelectorAll(".anonymous-draft-row").length'), 10);
  assert.equal(
    await execute(
      'return document.querySelectorAll(".match-table .win-rate, .match-table .player-link, .match-table .rank-medal").length',
    ),
    0,
  );
  assert.equal(
    await execute('return document.querySelector(".match-table").textContent.includes("Hidden self")'),
    false,
  );
  assert.ok(
    await execute(
      'return !!document.querySelector(`.team-radiant [data-team-slot="2"] .selected-hero[data-hero-id="11"]`)',
    ),
  );
  assert.equal(
    await execute('return document.querySelector(`.team-dire [data-team-slot="3"] .player-name`).textContent'),
    'You',
  );
  assert.equal(
    await execute(
      'return !!document.querySelector(".draft-intentions") || document.body.innerText.includes("Player intentions")',
    ),
    false,
  );
  // Relative to the panel content: the grid must not depend on how many heroes are known,
  // while the whole screen may zoom when a status line above the roster comes and goes.
  const matrixShape = () =>
    execute(
      'const m=document.querySelector(".advantage-matrix"); const w=m.closest(".analysis-content").getBoundingClientRect().width; const matrix=m.getBoundingClientRect(); const cell=document.querySelector(".matchup-cell").getBoundingClientRect(); return [matrix.width,matrix.height,cell.width,cell.height].map(v=>v/w)',
    );
  // A new zoom lets the panels take spare height, and the content widens with them while the
  // matrix headers keep their pixel size, so the ratios drift by a little under 0.01.
  const sameShape = async (expected, message) => {
    const actual = await matrixShape();
    assert.ok(
      actual.every((value, i) => Math.abs(value - expected[i]) <= 0.02),
      `${message}: ${actual} vs ${expected}`,
    );
  };
  const twoHeroShape = await matrixShape();
  assert.equal(draftRequests, beforeDraft + 1);
  assert.equal(refusedDrafts.length, 1, 'The warm-up of the first draft match was not attempted');
  assert.deepEqual(draftBatches.at(-1), [11, 12]);
  delayDraft = true;
  picks[1].heroId = 13;
  await emitDraft('800001', picks);
  await waitFor(
    // Only the hero this match has not asked for yet is requested.
    () => Promise.resolve(pendingDrafts.length === 1 && draftBatches.at(-1)?.join(',') === '13'),
    'Changed pick did not reach draft provider',
  );
  // While the new hero loads, the panels keep the match's data instead of a loading state.
  assert.ok(
    await execute('return document.querySelectorAll(".suggestion-tile").length > 0'),
    'Panels dropped the match data while a new hero loaded',
  );
  malformedDraft = true;
  delayDraft = false;
  pendingDrafts.splice(0).forEach((resolve) => resolve());
  await waitFor(
    () => execute('return document.querySelector(".draft-carousel [role=alert]")?.textContent.includes("draft data")'),
    'Malformed service response was not rejected',
  );
  assert.equal(
    await execute('return document.querySelectorAll(".suggestion-tile, .matchup-cell .portrait").length'),
    0,
    'Failed replacement kept old recommendations',
  );
  malformedDraft = false;
  neutralDraft = true;
  // Retry the same current picks through the existing refresh control.
  await clickButton('Refresh match statistics');
  await waitFor(
    () => execute('return document.querySelectorAll(".suggestion-tile").length > 0'),
    'Changed pick did not produce recommendations',
  );
  assert.deepEqual(draftBatches.at(-1), [13], 'Refresh retried more than the failed hero');
  // Two heroes not asked for yet both come back neutral: a small advantage keeps its winner.
  picks[0].heroId = 16;
  picks[1].heroId = 17;
  await emitDraft('800001', picks);
  await waitFor(
    () =>
      execute(
        'return [...document.querySelectorAll(".matchup-cell")].some(el=>el.querySelector(".portrait") && el.getAttribute("aria-label").includes("Radiant +0.4"))',
      ),
    'A small known advantage still shows its winner',
  );
  assert.deepEqual(draftBatches.at(-1), [16, 17]);
  assert.ok(
    await execute(
      'return [...document.querySelectorAll(".matchup-average")].every(node=>/^(—|0|[+−][0-9]+(\\.[0-9])?)$/.test(node.textContent))',
    ),
    'Axis totals are signed numbers without a unit',
  );
  neutralDraft = false;
  // Native bans: no strip of their own; excluded from suggestions, struck through in meta, no refetch.
  const bannedCandidate = await execute('return Number(document.querySelector(".suggestion-tile")?.dataset.heroId)');
  const banRequests = draftRequests;
  await emitDraft('800001', picks, undefined, [bannedCandidate]);
  await waitFor(
    () =>
      execute(
        'return !document.querySelector(".draft-bans") && !document.querySelector(`.suggestion-tile[data-hero-id="${arguments[0]}"]`)',
        [bannedCandidate],
      ),
    'Native ban was not shown or still suggested',
  );
  assert.equal(draftRequests, banRequests, 'Bans must not refetch draft statistics');
  await emitDraft('800001', picks);
  await waitFor(
    () =>
      execute('return !!document.querySelector(`.suggestion-tile[data-hero-id="${arguments[0]}"]`)', [bannedCandidate]),
    'Removed ban stayed applied',
  );
  const repeatedDraft = draftRequests;
  await emitDraft('800001', picks);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(draftRequests, repeatedDraft, 'Same picks refetched draft statistics');
  await emitDraft('800001', []);
  await waitFor(
    () =>
      execute(
        'return !document.querySelector(".suggestion-tile") && !document.querySelector(".matchup-cell .portrait") && document.querySelectorAll(".matchup-cell").length === 25',
      ),
    'Removed picks remained in UI',
  );
  await sameShape(twoHeroShape, 'Empty matrix changed size');
  await clickButton('Right panel: Meta');
  await waitFor(
    () => execute('return document.querySelectorAll(".meta-tile").length > 0'),
    'Meta must load before any pick or hover',
  );
  // Positions stay in the match's draft store, so clearing the picks needs no request.
  const emptyDraftCalls = draftRequests;
  await emitDraft('800001', []);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(draftRequests, emptyDraftCalls, 'Empty draft refetched on the same event');
  await clickButton('Right panel: Picks for Radiant');
  delayDraft = true;
  await emitDraft('800001', [
    { slot: 0, team: 'radiant', heroId: 14 },
    { slot: 5, team: 'dire', heroId: 15 },
  ]);
  await waitFor(() => Promise.resolve(pendingDrafts.length === 1), 'Delayed draft request did not start');
  await emitDraft('800002', []);
  delayDraft = false;
  pendingDrafts.splice(0).forEach((resolve) => resolve());
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await execute('return document.querySelectorAll(".suggestion-tile, .matchup-cell .portrait").length'),
    0,
    'Old match response revived draft',
  );
  // A new match without picks asks for positions alone (an empty request).
  assert.deepEqual(draftBatches.at(-1), [], 'Empty draft never requested positions');
  await emitDraft('0', [], 'DOTA_GAMERULES_STATE_INIT');
  assert.equal(batches.length, beforeAnonymous, 'Anonymous picks triggered profile requests');
  assert.equal(totalBatches.length, beforeTotals, 'Anonymous picks triggered lifetime requests');
  console.log(
    'Anonymous draft passed: picks/swap/removal, no profile requests, deduplication and late-match response rejection.',
  );

  hoverDraft = true;
  const hoverPicks = [
    { slot: 0, team: 'radiant', heroId: 11 },
    { slot: 5, team: 'dire', heroId: 12 },
  ];
  const hover = (heroId) => [{ slot: 6, team: 'dire', heroId }];
  await emitDraft('810001', hoverPicks, undefined, [], hover(13), [{ slot: 6, team: 'dire', flags: 4 }]);
  await waitFor(
    () =>
      execute(
        'return !!document.querySelector(".suggestion-tile") && !!document.querySelector(`.selected-hero[data-hero-id="13"] .draft-hover`)',
      ),
    'Hover did not load draft',
  );
  assert.equal(await execute('return document.querySelector(".draft-scope").textContent'), 'Known picks: 2/10');
  await assertPanelContentsFit();
  assert.equal(
    await execute('return document.querySelector(".match-role[data-lanes] .role-icon").getAttribute("src")'),
    './roles/midlane.png',
  );
  assert.ok(
    await execute(
      'return document.querySelectorAll(".matchup-provisional").length > 0 && [...document.querySelectorAll(".matrix-axis")].some(el=>(el.title || el.dataset.title).includes("hovered"))',
    ),
  );
  // Self is Dire: the only counter page is against the enemy (Radiant).
  await clickButton('Right panel: Counter picks against Radiant');
  await waitFor(
    () =>
      execute(
        'return !!document.querySelector(`.counter-row[data-enemy-id="11"]`) && !document.querySelector(`.counter-row[data-enemy-id="13"]`)',
      ),
    'Counters must list enemy heroes only, not an own-team hover',
  );
  await clickButton('Right panel: Picks for your team');
  const hoverStyle = await execute(
    'const el=document.querySelector(`.selected-hero[data-hero-id="13"] .portrait`); const style=getComputedStyle(el); return {filter:style.filter,opacity:Number(style.opacity)}',
  );
  assert.ok(
    hoverStyle.filter.includes('grayscale(1)') && hoverStyle.opacity < 1,
    'Hover portrait is not grey and translucent',
  );
  const oldSuggestions = await execute(
    'return [...document.querySelectorAll(".suggestion-tile")].map(el=>el.getAttribute("aria-label")).join("|")',
  );
  const beforeHovers = draftRequests;
  // Hovers changing faster than the 100 ms debounce send one request, for the last hero.
  for (const heroId of [15, 17, 14])
    await emitDraft('810001', hoverPicks, undefined, [], hover(heroId), [{ slot: 6, team: 'dire', flags: 24 }]);
  await waitFor(
    () => execute('return !!document.querySelector(`.selected-hero[data-hero-id="14"] .draft-hover`)'),
    'Hover did not update immediately',
  );
  // A hover change keeps the match's data on screen until the new hero arrives.
  assert.ok(
    await execute('return document.querySelectorAll(".suggestion-tile").length > 0'),
    'Panels dropped the match data on a hover change',
  );
  // Panels never empty now, so wait for the debounced request itself.
  await waitFor(() => Promise.resolve(draftRequests > beforeHovers), 'Debounced hover never loaded');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(draftRequests, beforeHovers + 1);
  // Only the last hover is requested, and only because this match has not asked for it.
  assert.deepEqual(draftBatches.at(-1), [14]);
  assert.notEqual(
    await execute(
      'return [...document.querySelectorAll(".suggestion-tile")].map(el=>el.getAttribute("aria-label")).join("|")',
    ),
    oldSuggestions,
    'Ally hover did not change scores',
  );
  assert.equal(
    await execute('return document.querySelector(".match-role[data-lanes]").dataset.lanes.split(",").length'),
    2,
  );
  assert.ok(
    await execute(
      'return document.querySelector(".match-role[data-lanes]").getAttribute("aria-label").includes("selected in the draft")',
    ),
  );
  await screenshot('hover');
  await app.resize(1200, 927);
  await waitFor(() => execute('return innerWidth <= 1210'), 'Hover window did not resize');
  assert.ok(
    await execute(
      'const matrix=document.querySelector(".matrix-panel").closest(".analysis-panel").getBoundingClientRect(); const carousel=document.querySelector(".draft-carousel").closest(".analysis-panel").getBoundingClientRect(); return Math.abs(matrix.top-carousel.top)<3 && carousel.left>matrix.left',
    ),
    'Fixed matrix and recommendations are misaligned in a narrow window',
  );
  await app.resize(1710, 927);
  const beforeLane = draftRequests;
  await emitDraft('810001', hoverPicks, undefined, [], hover(14), [{ slot: 6, team: 'dire', flags: 2 }]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(draftRequests, beforeLane, 'Lane icon refetched hero statistics');
  const beforeHeroTwo = draftRequests;
  await emitDraft('810001', [hoverPicks[0]], undefined, [], hover(2), [{ slot: 6, team: 'dire', flags: 2 }]);
  // The old scores stay up while hero 2 loads; page only once its reply has been applied.
  await waitFor(
    () => Promise.resolve(draftBatches.at(-1)?.join(',') === '2' && draftRequests > beforeHeroTwo),
    'Hover 2 was not requested',
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  // Shrinkage reorders candidates, so search every page (and return to the first).
  const candidateOnAnyPage = async (heroId) => {
    let found = false;
    const categories = await execute(
      'return [...document.querySelectorAll(".suggestion-category")].map(el=>el.getAttribute("aria-label"))',
    );
    for (const category of categories) {
      const hasHero = () =>
        execute(
          'return !!document.querySelector(`.suggestion-category[aria-label="${arguments[0]}"] .suggestion-tile[data-hero-id="${arguments[1]}"]`)',
          [category, heroId],
        );
      found = (await hasHero()) || found;
      const next = `Next ${category} heroes`;
      if (await execute('return !document.querySelector(`button[aria-label="${arguments[0]}"]`)?.disabled', [next])) {
        const before = await tileIds(category);
        await execute(
          'document.querySelector(`button[aria-label="${arguments[0]}"]`).scrollIntoView({block:"nearest"})',
          [next],
        );
        await clickButton(next);
        await waitFor(
          async () => JSON.stringify(await tileIds(category)) !== JSON.stringify(before),
          'Hero page did not change',
        );
        found = (await hasHero()) || found;
        await clickButton(`Previous ${category} heroes`);
        await waitFor(
          async () => JSON.stringify(await tileIds(category)) === JSON.stringify(before),
          'Hero page did not reset',
        );
      }
    }
    return found;
  };
  await waitFor(() => candidateOnAnyPage(2), 'Hovered hero was excluded from candidates');
  assert.equal(await execute('return document.querySelector(".draft-scope").textContent'), 'Known picks: 1/10');
  await clickButton('Right panel: Meta');
  await waitFor(
    () => execute('return !!document.querySelector(`.meta-tile[data-hero-id="2"]`)'),
    'Meta excluded an unconfirmed hover',
  );
  await clickButton('Right panel: Picks for your team');
  const beforeConfirm = draftRequests;
  await emitDraft('810001', [hoverPicks[0], ...hover(2)], undefined, [], hover(2));
  await waitFor(
    () =>
      execute(
        'return !!document.querySelector(".suggestion-tile") && !document.querySelector(`.suggestion-tile[data-hero-id="2"]`) && !document.querySelector(".draft-hover")',
      ),
    'Confirm did not exclude the hero or clear hover',
  );
  assert.equal(draftRequests, beforeConfirm, 'Confirming the same hero refetched aggregates');
  assert.equal(
    await execute('return !!document.querySelector(`.meta-tile[data-hero-id="2"]`)'),
    false,
    'Meta retained a confirmed pick',
  );
  await emitDraft('810001', [hoverPicks[0]], undefined, [2], hover(2));
  await waitFor(
    () =>
      execute(
        'return !!document.querySelector(`.selected-hero[data-hero-id="2"] .draft-hover`) && !!document.querySelector(".banned-hover") && !document.querySelector(`.suggestion-tile[data-hero-id="2"]`)',
      ),
    'Banned hover must remain grey in its player row',
  );
  await clickButton('Right panel: Meta');
  await waitFor(
    () =>
      execute(
        'return !!document.querySelector(`.analysis-panel[aria-label^=Right] .meta-tile.banned[data-hero-id="2"] .ban-portrait`)',
      ),
    'Meta did not strike the banned hero through in place',
  );
  await clickButton('Right panel: Counter picks against Radiant');
  assert.equal(
    await execute('return !!document.querySelector(`.counter-tile[data-hero-id="2"]`)'),
    false,
    'Counter picks retained a banned hero',
  );
  await clickButton('Right panel: Picks for your team');
  await emitDraft(
    '810001',
    [],
    undefined,
    [],
    [
      { slot: 0, team: 'radiant', heroId: 19 },
      { slot: 6, team: 'dire', heroId: 20 },
    ],
  );
  await waitFor(
    () =>
      execute(
        'return document.querySelectorAll(".matchup-cell .portrait").length === 1 && !!document.querySelector(".suggestion-tile")',
      ),
    'Hover-only teams did not produce matchups',
  );
  assert.equal(await execute('return document.querySelector(".draft-scope").textContent'), 'Known picks: 0/10');
  delayDraft = true;
  await emitDraft('810001', [], undefined, [], hover(21));
  await waitFor(() => Promise.resolve(pendingDrafts.length === 1), 'Delayed hover request did not start');
  await emitDraft('810002', []);
  delayDraft = false;
  pendingDrafts.splice(0).forEach((resolve) => resolve());
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(
    await execute('return document.querySelectorAll(".suggestion-tile, .draft-hover, .match-role[data-lanes]").length'),
    0,
    'Late hover revived the old match',
  );
  await emitDraft('810002', [], undefined, [], hover(22), [{ slot: 6, team: 'dire', flags: 4 }], 'disabled');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(
    await execute('return document.querySelectorAll(".suggestion-tile, .draft-hover, .match-role[data-lanes]").length'),
    0,
    'Disabled reader displayed intentions',
  );
  const beforeLargeDraft = draftRequests;
  const fullPicks = Array.from({ length: 10 }, (_, slot) => ({
    slot,
    team: slot < 5 ? 'radiant' : 'dire',
    heroId: slot + 1,
  }));
  await emitDraft(
    '810003',
    fullPicks,
    undefined,
    [],
    [
      { slot: 0, team: 'radiant', heroId: 11 },
      { slot: 5, team: 'dire', heroId: 12 },
    ],
  );
  await waitFor(
    () =>
      execute(
        'return document.querySelectorAll(".matchup-cell .portrait").length === 25 && !!document.querySelector(".suggestion-tile")',
      ),
    'Picks and hovers exceeding ten IDs did not load',
  );
  assert.equal(draftRequests, beforeLargeDraft + 2);
  assert.deepEqual(
    draftBatches.slice(-2).sort((a, b) => a[0] - b[0]),
    [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [11, 12],
    ],
  );
  // Warm-up: a new draft fetches every catalogue hero once in batches of ten; picks and
  // hovers covered by it then need no request of their own.
  const beforeWarmUp = draftRequests;
  const catalogue = heroes.map((hero) => hero.id);
  const warmBatches = Array.from({ length: Math.ceil(catalogue.length / 10) }, (_, i) =>
    catalogue.slice(i * 10, i * 10 + 10),
  );
  await emitDraft('810004', [{ slot: 0, team: 'radiant', heroId: 11 }], undefined, [], [], [], 'ready', {
    warmUp: true,
  });
  await waitFor(
    () => Promise.resolve(draftRequests - beforeWarmUp >= warmBatches.length),
    'Draft warm-up did not fetch every hero',
  );
  await waitFor(() => execute('return !!document.querySelector(".suggestion-tile")'), 'Warmed draft did not load');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(draftBatches.slice(beforeWarmUp), warmBatches, 'Warm-up batches or an extra request');
  await emitDraft(
    '810004',
    [
      { slot: 0, team: 'radiant', heroId: 11 },
      { slot: 5, team: 'dire', heroId: 25 },
    ],
    undefined,
    [],
    [{ slot: 1, team: 'radiant', heroId: 31 }],
  );
  await waitFor(
    () => execute('return !!document.querySelector(`.selected-hero[data-hero-id="31"]`)'),
    'Warmed pick and hover were not shown',
  );
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(draftRequests, beforeWarmUp + warmBatches.length, 'A warmed pick or hover requested draft data');
  assert.equal(await execute('return document.querySelectorAll(".matchup-cell").length'), 25);
  await sameShape(twoHeroShape, 'Full matrix changed size');
  const identity = fullPicks.map((pick) => ({
    key: pick.slot === 6 ? 'self' : `native.${pick.slot}`,
    team: pick.team,
    heroId: pick.heroId,
    name: `Visible ${pick.slot}`,
  }));
  await emitDraft('810003', fullPicks, 'DOTA_GAMERULES_STATE_STRATEGY_TIME', [], [], [], 'ready', {
    players: identity,
  });
  await waitFor(
    () =>
      execute(
        'return document.querySelector(`.team-dire [data-team-slot="3"] .player-link`)?.textContent === "Visible 6"',
      ),
    'Strategy identity moved to a different slot',
  );
  assert.ok(
    await execute(
      'return !!document.querySelector(`.team-dire [data-team-slot="3"] .selected-hero[data-hero-id="7"]`)',
    ),
  );
  assert.ok(
    await execute(
      'return document.querySelector(`.team-radiant [data-team-slot="2"] .player-link`)?.textContent === "Visible 0"',
    ),
  );
  assert.equal(batches.length, beforeAnonymous, 'Hover created profile requests');
  assert.equal(totalBatches.length, beforeTotals, 'Hover created lifetime requests');
  await emitDraft('0', [], 'DOTA_GAMERULES_STATE_INIT');
  hoverDraft = false;
  console.log(
    'Hover draft passed: debounce, changed scores, candidate eligibility, lane flags, provisional matrix, confirmation, bans and stale/disabled rejection.',
  );

  await clickButton('Settings');
  const readerToggle = 'document.querySelector(`input[aria-label="Allow Dota memory reading"]`)';
  assert.equal(await execute(`return ${readerToggle}.checked`), false);
  await execute(`${readerToggle}.click()`);
  await waitFor(
    () => execute(`return ${readerToggle}.checked && !${readerToggle}.disabled`),
    'Reader opt-in was not saved',
  );
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).nativeRosterReader, 'on');
  await screenshot('reader');
  const readerPayload = {
    auth: { token },
    provider: { appid: 570 },
    map: { matchid: '987654', game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION' },
    player: { team_name: 'dire' },
    hero: { id: 0 },
  };
  await post(readerPayload);
  await waitFor(async () => (await call('getLive')).draftStatus === 'test-mode', 'Isolated worker did not start');
  await execute(`${readerToggle}.click()`);
  await waitFor(() => execute(`return !${readerToggle}.checked && !${readerToggle}.disabled`), 'Reader did not stop');
  const afterStop = await call('getLive');
  assert.equal(afterStop.rosterStatus, 'disabled');
  assert.equal(afterStop.draftStatus, undefined);
  assert.equal(afterStop.draft, undefined);
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).nativeRosterReader, 'off');
  await clickButton('Match and draft');
  await execute(
    'const ids=Object.getOwnPropertyNames(window.__internal_unstable_listeners_object_id__["live:update"]); window.__internal_unstable_listeners_function_id__({event:"live:update",payload:arguments[0]},ids);',
    [{ ...afterStop, draftStatus: 'permission' }],
  );
  await waitFor(
    () =>
      execute(
        'return [...document.querySelectorAll("[role=alert]")].some(node=>node.textContent.includes("The system denied access to Dota memory"))',
      ),
    'Draft permission error was hidden in hero selection',
  );
  await post({ ...readerPayload, map: { matchid: '0', game_state: 'DOTA_GAMERULES_STATE_INIT' } });
  console.log('Reader opt-in passed: legacy off, UI toggle, persistence, isolated start/stop and permission message.');

  // Player mode: the own side is labelled, and a reconnect keeps the match until it is reset.
  const playing = {
    auth: { token },
    provider: { appid: 570 },
    map: { matchid: 'native-player', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 300 },
    player: { steamid: String(76561197960265728n + 1n), name: 'Fixture 1', team_name: 'radiant' },
    hero: { id: 1, name: heroes[0].name },
  };
  const menu = { auth: { token }, provider: { appid: 570 } };
  const shows = (text) => execute('return document.body.innerText.includes(arguments[0])', [text]);
  const hasButton = (label) =>
    execute(
      'return [...document.querySelectorAll("button")].some(b => b.textContent.trim() === arguments[0] || b.getAttribute("aria-label") === arguments[0])',
      [label],
    );
  assert.equal((await post(playing)).status, 200);
  await waitFor(
    () => execute('return !!document.querySelector(".team-radiant .own-team-label")'),
    'Own side not labelled',
  );
  assert.equal((await post(menu)).status, 200);
  await waitFor(() => shows('Connection to match #native-player interrupted'), 'No reconnect notice');
  assert.ok(await hasButton('Fixture 1'), 'A reconnect wait cleared the match');
  await screenshot('reconnect');
  assert.equal((await post(playing)).status, 200);
  await waitFor(() => execute('return !document.querySelector(".reconnect-notice")'), 'Reconnect notice stayed');
  assert.equal((await post(menu)).status, 200);
  await waitFor(() => execute('return !!document.querySelector(".reconnect-notice")'), 'No second reconnect notice');
  await clickButton('Reset match');
  await waitFor(() => execute('return !document.querySelector(".reconnect-notice")'), 'Reset kept the notice');
  assert.equal(await hasButton('Fixture 1'), false, 'Reset kept the match');
  // The own assigned role (lane flags from the native draft) picks the lane once per match.
  const laneValue = () => execute('return document.querySelector(".lane-select")?.value');
  await emitDraft('auto-lane', [], undefined, [], [], [{ slot: 6, team: 'dire', flags: 2 }]); // position 3
  await waitFor(async () => (await laneValue()) === '2', 'The own role did not pick the Off Lane');
  await execute(
    'const select=document.querySelector(".lane-select"); select.value = "0"; select.dispatchEvent(new Event("change", {bubbles:true}));',
  );
  await emitDraft('auto-lane', [], undefined, [], [], [{ slot: 6, team: 'dire', flags: 16 }]);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await laneValue(), '0', 'A later role overrode the chosen lane');
  await emitDraft('0', [], 'DOTA_GAMERULES_STATE_INIT');
  // Shortcuts: one key cannot serve two actions.
  const pressKey = (code, modifiers) =>
    execute(
      'window.dispatchEvent(new KeyboardEvent("keydown", {key: arguments[0], code: arguments[0], ...arguments[1], bubbles: true, cancelable: true}));',
      [code, modifiers],
    );
  const shortcutRow = (label) =>
    `[...document.querySelectorAll(".shortcut-row")].find(row => row.textContent.includes(${JSON.stringify(label)}))`;
  const keycaps = (label) =>
    execute(`return ${shortcutRow(label)}.querySelector(".keycaps").getAttribute("aria-label")`);
  await clickButton('Settings');
  await clickButton('Change Previous recommendation lane');
  await pressKey('ArrowDown', { altKey: true });
  await waitFor(() => shows('Already used for “Next recommendation lane”.'), 'Duplicate in-page key accepted');
  if (platform === 'windows') {
    // The two show/hide keys are registered with Windows; app:info proves the native
    // registration changed, not merely the displayed keycap. On Linux the desktop portal
    // assigns them, and the isolated session has none.
    await clickButton('Change Show or hide the match window');
    await pressKey('F10', { ctrlKey: true, altKey: true });
    await waitFor(async () => (await keycaps('Show or hide the match window')) === 'Ctrl + Alt + F10', 'Key not shown');
    await waitFor(async () => {
      const keys = await call('getInfo');
      return keys.shortcutKey === 'Ctrl+Alt+F10' && keys.shortcut === true;
    }, 'Match window key was not registered');
    await waitFor(() => shows('Shortcut saved and registered.'), 'No registration message');
    assert.equal((await call('getState')).shortcuts.global, 'Ctrl+Alt+F10');
    await clickButton('Change Show or hide the profile window');
    await pressKey('F10', { ctrlKey: true, altKey: true });
    await waitFor(() => shows('Already used for “Show or hide the match window”.'), 'Profile key took the match key');
    await clickButton('Change Show or hide the profile window');
    await pressKey('F11', { ctrlKey: true, altKey: true });
    await waitFor(async () => {
      const keys = await call('getInfo');
      return keys.profileShortcutKey === 'Ctrl+Alt+F11' && keys.profileShortcut === true;
    }, 'Profile window key was not registered');
    await clickButton('Reset shortcuts');
    await waitFor(async () => {
      const keys = await call('getInfo');
      return keys.shortcutKey === 'Alt+Numpad5' && keys.profileShortcutKey === 'Alt+Numpad6';
    }, 'Shortcuts were not reset');
  }
  await clickButton('Match and draft');
  // New-version notice from the fixture release list. The missing list at start stayed
  // silent, as an offline check does.
  const releaseNotice = () => execute('return document.querySelector(".release-notice")?.textContent ?? null');
  assert.equal(await releaseNotice(), null);
  const [major, minor, patch] = info.version.split('.').map(Number);
  const nextVersion = `${major}.${minor}.${patch + 1}`;
  const laterVersion = `${major}.${minor + 1}.0`;
  const publish = (version) =>
    writeFile(
      releasesPath,
      JSON.stringify([
        { tag_name: 'v99.0.0', draft: true, prerelease: false },
        { tag_name: `v${version}`, draft: false, prerelease: true, published_at: new Date().toISOString() },
        { tag_name: `v${info.version}`, draft: false, prerelease: true },
        { tag_name: 'nightly', draft: false, prerelease: true },
      ]),
    );
  // Turning the check off and on again in Settings runs it at once.
  const checkReleases = async () => {
    await clickButton('Settings');
    await clickButton('Updates');
    for (const on of [false, true]) {
      await execute('document.querySelector("#settings-updates input[type=checkbox]").click()');
      await waitFor(async () => (await call('getState')).updateCheck === on, `Update check did not turn ${on}`);
    }
    await clickButton('Match and draft');
  };
  await publish(nextVersion);
  await checkReleases();
  await waitFor(
    async () => (await releaseNotice())?.includes(`Ancient Lens ${nextVersion} (prerelease) is out`),
    'New-version notice did not appear',
  );
  assert.ok((await releaseNotice()).includes(`you have ${info.version}`));
  await screenshot('release-notice');
  const releaseUrl = `https://github.com/PavluntiyJ/ancient-lens/releases/tag/v${nextVersion}`;
  assert.equal((await call('getRelease')).latest.url, releaseUrl);
  // Isolated runs return the release page instead of opening a browser.
  assert.equal(await call('openRelease'), releaseUrl);
  await clickButton("What's new", '.release-notice button');
  await clickButton('Skip this version', '.release-notice button');
  await waitFor(async () => (await releaseNotice()) === null, 'Skip this version did not hide the notice');
  assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).skippedVersion, nextVersion);
  // A newer release is announced again; Later hides it for this session only.
  await publish(laterVersion);
  await checkReleases();
  await waitFor(
    async () => (await releaseNotice())?.includes(`Ancient Lens ${laterVersion}`),
    'Notice for a newer release did not appear',
  );
  await clickButton('Later', '.release-notice button');
  await waitFor(async () => (await releaseNotice()) === null, 'Later did not hide the notice');
  assert.equal((await call('getState')).skippedVersion, nextVersion);
  assert.equal((await call('getRelease')).latest.version, laterVersion);
  await call('addMmr', 5000);
  await call('saveNote', { accountId: '2', name: 'Second', text: 'Native IPC persistence', tag: 'neutral' });
  const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  assert.equal(saved.token, token);
  assert.equal(saved.mmr.at(-1).value, 5000);
  assert.equal(saved.notes.length, 2);
  assert.equal(
    JSON.parse(await readFile(join(directory, 'state.pre-tauri.json'), 'utf8')).notes[0].text,
    'Keep this note',
  );
  // Each key toggles its own window; no further window is created. On Wayland whether the
  // first press hides or raises depends on focus under the driver, so two presses end visible.
  for (const name of ['main', 'profile']) {
    const first = await call('toggleWindow', name);
    if (!first) assert.equal(await call('toggleWindow', name), true);
  }
  assert.equal(await app.windowCount(), 2);
  // Both hidden at once; each comes back on its own, and the header icon shows the profile.
  // On Wayland a press may raise instead of hide, depending on focus, so only the end
  // state above is checked there.
  if (!info.wayland) {
    // Activating another program hides both windows; the game and the app's own windows keep
    // them up. Isolated runs do not watch the active window, so the activation is reported
    // here, through the same code as the system's notification.
    const report = (args) =>
      execute(
        'return window.__TAURI_INTERNALS__.invoke("desktop_call", {command: "window:test-foreground", args: arguments[0]})',
        [args],
      );
    const activate = async (args) => (await report(args)).hidden;
    const game =
      platform === 'windows'
        ? 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game\\bin\\win64\\dota2.exe'
        : '/home/user/.steam/steam/steamapps/common/dota 2 beta/game/bin/linuxsteamrt64/dota2';
    assert.equal(await activate({ exe: game }), false, 'Clicking the game hid the windows');
    assert.equal(await activate({ own: true }), false, 'Clicking an Ancient Lens window hid the windows');
    const browser = platform === 'windows' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : '/usr/bin/firefox';
    assert.equal(await activate({ exe: browser }), true, 'Another program did not hide the windows');
    // Minimized to the taskbar, not hidden, so a click on its button brings a window back.
    // Only Windows is asked: a Linux window manager need not report an iconified window.
    if (platform === 'windows')
      assert.deepEqual(
        (await report({ exe: browser })).minimized,
        [true, true],
        'The windows hid instead of minimizing',
      );
    // Both are hidden: each key brings its own window back.
    assert.equal(await call('toggleWindow', 'main'), true, 'Match window stayed up for another program');
    assert.equal(await call('toggleWindow', 'profile'), true, 'Profile window stayed up for another program');
    // A program whose name cannot be read hides them too; the tray's Show brings one back.
    assert.equal(await activate({}), true, 'An unnamed program did not hide the windows');
    assert.equal(await call('showWindow', 'profile'), true);
    assert.equal(await call('toggleWindow', 'main'), true, 'Match window stayed up for an unnamed program');
    // Turned off, nothing hides them.
    assert.equal((await call('setAutoHide', false)).autoHide, false);
    assert.equal(await activate({ exe: browser }), false, 'The windows hid with the setting off');
    assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).autoHide, false);
    assert.equal((await call('setAutoHide', true)).autoHide, true);
    // The window keys are released over other programs, so the key reaches them, and come back
    // over the game and over these windows, whether or not the game runs. A released key is
    // still bound for Settings.
    if (info.keysOverGame) {
      await call('setAutoHide', false);
      const keys = async (args) => (await report(args)).keys;
      assert.equal(await keys({ exe: browser }), false, 'Keys kept listening over a browser');
      const released = await call('getInfo');
      assert.deepEqual(
        [released.keysListening, released.shortcut, released.profileShortcut],
        [false, true, true],
        'A released key must not look taken by another application',
      );
      assert.equal(await keys({ own: true }), true, 'Keys stayed released over Ancient Lens');
      assert.equal(await keys({ exe: browser }), false);
      assert.equal(await keys({ exe: game }), true, 'Keys stayed released over the game');
      // Turning the setting off brings released keys back at once.
      assert.equal(await keys({ exe: browser }), false);
      assert.equal((await call('setKeysOverGame', false)).keysOverGame, false);
      await waitFor(async () => (await call('getInfo')).keysListening === true, 'Keys stayed released');
      assert.equal(await keys({ exe: browser }), true, 'Keys were released with the setting off');
      assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).keysOverGame, false);
      assert.equal((await call('setKeysOverGame', true)).keysOverGame, true);
      const back = await call('getInfo');
      assert.deepEqual([back.keysListening, back.shortcut, back.profileShortcut], [true, true, true]);
      await call('setAutoHide', true);
      // The window already active when watching starts sets the keys but minimizes nothing:
      // the windows have just been shown.
      const start = await report({ exe: browser, initial: true });
      assert.deepEqual([start.keys, start.hidden], [false, false], 'The first active window was handled as a switch');
      assert.equal(await keys({ own: true }), true);
    }
    assert.equal(await call('toggleWindow', 'profile'), false, 'Profile key did not hide the profile window');
    assert.equal(await call('toggleWindow', 'main'), false, 'Match key did not hide the match window');
    assert.equal(await call('toggleWindow', 'main'), true, 'Match key did not show the match window');
    await clickButton('My profile');
    assert.equal(await call('toggleWindow', 'profile'), false, 'The header icon did not show the profile window');
    assert.equal(await call('toggleWindow', 'profile'), true, 'Profile key did not show the profile window again');
  }
  // Closing the profile window hides it; the match window and the app keep running.
  await useWindow('profile');
  await clickButton('Close window');
  await useWindow('main');
  await waitFor(async () => (await call('toggleWindow', 'profile')) === true, 'Close quit the profile window');
  assert.equal(await app.windowCount(), 2, 'Closing the profile window destroyed it');
  // X11 shows the windows without taking the keyboard; Wayland decides by itself.
  if (!info.wayland) assert.equal((await call('getInfo')).overlay, true);
  assert.equal((await call('getInfo')).gsiPort, info.gsiPort);
  assert.deepEqual(await execute('return window.smokeErrors'), []);
  console.log(
    `Native smoke passed on ${platform}: ${platform === 'windows' ? 'WebView2' : 'WebKitGTK'} rendering, Rust IPC, authenticated HTTP GSI, 10 profiles in 2 batches, reordered identity mapping, migration, MMR/notes, settings, new-version notice, match and profile windows, hiding for other programs, window keys over the game. Wayland: ${info.wayland}.`,
  );
} catch (error) {
  await app?.captureFailure(error);
  throw error;
} finally {
  pendingDrafts.splice(0).forEach((resolve) => resolve());
  await app?.close();
  await new Promise((resolve) => service.close(resolve));
  // WebView2 may hold its data folder for a moment after the app stops.
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
}
