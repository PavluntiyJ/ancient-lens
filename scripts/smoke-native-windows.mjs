import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'ancient-native-'));
const cache = join(directory, 'cache');
await mkdir(cache);
const token = 'a'.repeat(64);
const initial = {
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
  mmr: [],
};
await writeFile(join(directory, 'state.json'), JSON.stringify(initial));
const heroes = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  name: `npc_dota_hero_fixture_${i + 1}`,
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
const batches = [];
const service = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const { ids, days, filter, bracket = 'ALL' } = JSON.parse(body);
  if (req.url === '/v1/draft') {
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
      vs: heroes.map((hero) => ({ heroId1: id, heroId2: hero.id, matchCount: 1000, winCount: 400, synergy: -4 })),
      with: heroes.map((hero) => ({ heroId1: id, heroId2: hero.id, matchCount: 1000, winCount: 550, synergy: 2 })),
    }));
    // The app refuses draft data that does not echo the requested rank bracket.
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ source: 'STRATZ', bracket, fetchedAt: new Date().toISOString(), positions, matchups }));
    return;
  }
  batches.push(ids);
  const summaries = [...ids].reverse().map((id) => ({
    accountId: id,
    days,
    filter,
    source: 'STRATZ',
    fetchedAt: new Date().toISOString(),
    profile: {
      rank_tier: 80,
      leaderboard_rank: Number(id),
      profile: { account_id: Number(id), personaname: `Fixture ${id}` },
    },
    total: { games: 1000 + Number(id), wins: 500 },
    // Three of four matches on one position, to check the position share columns.
    matches: Array.from({ length: 4 }, (_, k) => ({
      match_id: Number(id) * 100 + k,
      hero_id: Number(id),
      start_time: Math.floor(Date.now() / 1000) - 86400 * (k + 1),
      duration: 1800,
      player_slot: 0,
      radiant_win: k % 2 === 0,
      position: `POSITION_${k === 3 ? 5 : (Number(id) % 5) + 1}`,
    })),
    heroes: [{ hero_id: Number(id), games: 20, win: 12 }],
    limited: false,
    stale: false,
  }));
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ summaries }));
});
await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const debugPort = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(resolve('src-tauri/target/release/ancient-lens.exe'), [], {
  windowsHide: true,
  env: {
    ...process.env,
    ANCIENT_TEST_DATA: directory,
    ANCIENT_STATS_URL: `http://127.0.0.1:${service.address().port}`,
    ANCIENT_WEBVIEW_DEBUG_PORT: String(debugPort),
  },
  stdio: 'pipe',
});
let browser;
const failures = [];
child.stderr.on('data', (data) => process.stderr.write(data));
try {
  let endpoint;
  // A fresh CI runner can take a while to start WebView2.
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(`Native app exited: ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      endpoint = (await response.json()).webSocketDebuggerUrl;
      if (endpoint) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!endpoint) throw new Error('WebView2 debugging endpoint unavailable');
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  await context.route('https://**/*', (route) => route.abort());
  let page;
  for (let i = 0; i < 100; i++) {
    page = context.pages().find((p) => p.url().includes('tauri.localhost'));
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('Tauri page unavailable');
  page.on('pageerror', (error) => failures.push(error.message));
  await expect(page.getByRole('heading', { name: 'Match players', exact: true })).toBeVisible();
  const info = await page.evaluate(() => window.ancient.getInfo());
  if (info.runtime !== 'Tauri + Rust' || info.dataPath !== directory || !info.gsiPort)
    throw new Error('Wrong native runtime/data path');
  const state = await page.evaluate(() => window.ancient.getState());
  if (state.notes[0].text !== 'Keep this note' || JSON.stringify(state).includes(token))
    throw new Error('Migration or secret isolation failed');
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
  const url = `http://127.0.0.1:${info.gsiPort}/gsi`;
  const post = (value, headers = {}) =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(value),
    });
  if ((await post({ ...payload, auth: { token: 'wrong' } })).status !== 403) throw new Error('GSI accepted bad token');
  if ((await post(payload, { origin: 'https://untrusted.example' })).status !== 403)
    throw new Error('GSI accepted browser origin');
  if (!(await post(payload)).ok) throw new Error('Native GSI rejected valid fixture');
  await expect(page.getByText('Profiles · 10/10 loaded')).toBeVisible({ timeout: 15000 });
  if (batches.length !== 2 || batches.some((ids) => ids.length !== 5))
    throw new Error(`Expected two batches of five, got ${JSON.stringify(batches)}`);
  for (let i = 1; i <= 10; i++) {
    const row = page.locator('tr').filter({ has: page.getByRole('button', { name: `Fixture ${i}`, exact: true }) });
    await expect(row.locator('.all-time')).toContainText((1000 + i).toLocaleString('en-US'));
  }
  // Player and hero position columns: 3 of 4 known matches on the main position.
  await expect(page.locator('.position-share').first()).toContainText('75%');
  await expect(page.locator('.position-share')).toHaveCount(20);
  // Two carousels: left starts on matchups, right on suggestions. All ten fixture
  // heroes are picked, so suggestions can only contain the remaining 11 and 12.
  const left = page.getByRole('region', { name: 'Left panel' });
  const right = page.getByRole('region', { name: 'Right panel' });
  await expect(left.locator('.matchup-cell')).toHaveCount(25);
  await expect(right.locator('.suggestion-tile[data-hero-id="11"]').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('.error-text')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/native-match-carousels.png', fullPage: true });
  // Pages: matchups, lanes, both sides' picks, meta, counters. Alt+→ moves only the left
  // panel; Shift+→ only the right one; both wrap around.
  await page.keyboard.press('Alt+ArrowRight');
  await expect(left).toHaveAttribute('data-page', 'lanes');
  await expect(right).toHaveAttribute('data-page', 'suggest-radiant');
  await expect(left.locator('.lane-row')).toHaveCount(3);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(left).toHaveAttribute('data-page', 'suggest-radiant');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(right).toHaveAttribute('data-page', 'lanes');
  await expect(left).toHaveAttribute('data-page', 'suggest-radiant');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(right).toHaveAttribute('data-page', 'matchups');
  await right.getByRole('button', { name: 'Right panel: previous panel' }).click();
  await expect(right).toHaveAttribute('data-page', 'counters-radiant');
  // The lane is shared: changing it in one panel changes the other and is not refetched.
  const draftCalls = batches.length;
  await page.keyboard.press('Alt+ArrowDown');
  await expect(left.locator('.lane-select')).toHaveValue('1');
  await right.getByRole('button', { name: 'Right panel: Picks for Dire' }).click();
  await expect(right.locator('.lane-select')).toHaveValue('1');
  await left.locator('.lane-select').selectOption('0');
  await expect(right.locator('.lane-select')).toHaveValue('0');
  if (batches.length !== draftCalls) throw new Error('Carousel navigation refetched player statistics');
  // Player mode: own side is labelled, and a reconnect keeps the match on screen.
  const playing = {
    auth: { token },
    provider: { appid: 570 },
    map: { matchid: 'native-player', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 300 },
    player: { steamid: String(76561197960265728n + 1n), name: 'Fixture 1', team_name: 'radiant' },
    hero: { id: 1, name: heroes[0].name },
  };
  if (!(await post(playing)).ok) throw new Error('Player GSI rejected');
  await expect(page.locator('.team-radiant .own-team-label')).toBeVisible({ timeout: 10000 });
  await expect(right.getByRole('button', { name: 'Right panel: Picks for your team' })).toBeVisible();
  // Disconnected to the main menu: GSI continues without a match.
  if (!(await post({ auth: { token }, provider: { appid: 570 } })).ok) throw new Error('Menu GSI rejected');
  await expect(page.getByText('Connection to match #native-player interrupted', { exact: false })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByRole('button', { name: 'Fixture 1', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/native-reconnect.png' });
  // Back in the same match: the notice goes away and nothing was reset.
  if (!(await post(playing)).ok) throw new Error('Reconnect GSI rejected');
  await expect(page.locator('.reconnect-notice')).toHaveCount(0, { timeout: 10000 });
  if (!(await post({ auth: { token }, provider: { appid: 570 } })).ok) throw new Error('Menu GSI rejected');
  await expect(page.locator('.reconnect-notice')).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Reset match' }).click();
  await expect(page.locator('.reconnect-notice')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fixture 1', exact: true })).toHaveCount(0);
  // The own assigned role (lane flags from the native draft) picks the lane once per match.
  const emitDraft = (flags) =>
    page.evaluate((selfFlags) => {
      const now = Date.now();
      const slots = Array.from({ length: 10 }, (_, slot) => ({
        slot,
        team: slot < 5 ? 'radiant' : 'dire',
        teamSlot: ((slot % 5) + 2) % 5,
      }));
      const gameState = 'DOTA_GAMERULES_STATE_HERO_SELECTION';
      const frame = {
        status: 'connected',
        receivedAt: now,
        matchId: 'auto-lane',
        gameState,
        mode: 'player',
        players: [{ key: 'self', team: 'dire' }],
        selfTeamSlot: 3,
        draftStatus: 'ready',
        draft: {
          matchId: 'auto-lane',
          gameState,
          source: 'native',
          observedAt: now,
          picks: [],
          bans: [],
          hovers: [],
          lanes: [{ slot: 6, team: 'dire', flags: selfFlags }],
          slots,
        },
      };
      const listeners = window.__internal_unstable_listeners_object_id__?.['live:update'];
      window.__internal_unstable_listeners_function_id__(
        { event: 'live:update', payload: frame },
        Object.getOwnPropertyNames(listeners ?? {}),
      );
    }, flags);
  await emitDraft(2); // position 3 → Off Lane
  await expect(right.locator('.lane-select')).toHaveValue('2', { timeout: 10000 });
  await right.locator('.lane-select').selectOption('0');
  await emitDraft(16); // a later role must not override the user's choice
  await page.waitForTimeout(500);
  await expect(right.locator('.lane-select')).toHaveValue('0');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Include Turbo', { exact: true })).toBeVisible();
  await expect(page.locator('input[type=password]')).toHaveCount(0);
  // Rebind the global key through the page, then restore it; app:info proves the native
  // registration changed, not merely the displayed keycap.
  const showHide = page.locator('.shortcut-row').filter({ hasText: 'Show or hide the window' });
  await showHide.getByRole('button', { name: 'Change Show or hide the window' }).click();
  await page.keyboard.press('Control+Alt+F10');
  await expect(showHide.locator('.keycaps')).toHaveAttribute('aria-label', 'Ctrl + Alt + F10');
  await expect
    .poll(() => page.evaluate(() => window.ancient.getInfo()))
    .toMatchObject({ shortcutKey: 'Ctrl+Alt+F10', shortcut: true });
  await expect(page.getByText('Shortcut saved and registered.')).toBeVisible();
  const rebound = await page.evaluate(() => window.ancient.getState());
  if (rebound.shortcuts.global !== 'Ctrl+Alt+F10') throw new Error('Global shortcut was not stored');
  await page.getByRole('button', { name: 'Reset shortcuts' }).click();
  await expect.poll(() => page.evaluate(() => window.ancient.getInfo())).toMatchObject({ shortcutKey: 'Alt+Numpad5' });
  await page.evaluate(async () => {
    await window.ancient.addMmr(5000);
    await window.ancient.saveNote({ accountId: '2', name: 'Second', text: 'Native IPC persistence', tag: 'neutral' });
  });
  const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  if (saved.token !== token || saved.mmr[0].value !== 5000 || saved.notes.length !== 2)
    throw new Error('Native save changed or lost data');
  if (JSON.parse(await readFile(join(directory, 'state.pre-tauri.json'), 'utf8')).notes[0].text !== 'Keep this note')
    throw new Error('No recoverable migration backup');
  await page.getByRole('button', { name: 'Match and draft', exact: true }).click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/native-desktop.png', fullPage: true });
  if (failures.length) throw new Error(failures.join('\n'));
  console.log(
    'Native Tauri smoke passed: real Rust IPC + HTTP GSI, 10 profiles / 2 batches, reordered identity mapping, migration, MMR/notes, no manual keys.',
  );
} finally {
  await browser?.close();
  child.kill();
  await new Promise((resolve) => service.close(resolve));
}
