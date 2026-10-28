// Isolated native UI/IPC test. Does not inspect or change the user's Steam session.
import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'ancient-account-'));
const feed = join(directory, 'account-feed.json');
await mkdir(join(directory, 'cache'));
const endpoint = 'heroes';
await writeFile(
  join(directory, 'cache', `resource-${createHash('sha256').update(endpoint).digest('hex')}.json`),
  JSON.stringify({ endpoint, at: Date.now(), data: [] }),
);
async function sample(id, status, mmr = null, confidence = null) {
  await writeFile(
    `${feed}.next`,
    JSON.stringify({
      accountId: id,
      status,
      mmr,
      confidence,
      source: 'dota-memory',
      observedAt: new Date().toISOString(),
      behaviorScore: null,
      communicationScore: null,
    }),
  );
  await rename(`${feed}.next`, feed);
}
await sample('123', 'measured', 6586, 60);
let firstA = true;
const service = createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const { id } = JSON.parse(body);
  // Varied history to render every profile column (ranked/Turbo, positions, economy).
  const now = Math.floor(Date.now() / 1000);
  const matches = Array.from({ length: 8 }, (_, k) => ({
    match_id: 9000 + k,
    hero_id: (k % 3) + 1,
    start_time: now - 86400 * (k + 1),
    duration: 1500 + k * 120,
    player_slot: k % 2 ? 128 : 0,
    radiant_win: k % 3 !== 1,
    kills: 4 + k,
    deaths: 2 + (k % 4),
    assists: 10 + k,
    gold_per_min: 420 + k * 15,
    xp_per_min: 560 + k * 12,
    last_hits: 150 + k * 20,
    denies: k,
    net_worth: 15000 + k * 1300,
    hero_damage: 20000 + k * 2100,
    tower_damage: 1200 + k * 300,
    hero_healing: k * 150,
    imp: 5 + k,
    position: `POSITION_${(k % 5) + 1}`,
    game_mode: k === 0 ? 23 : 22,
    lobby_type: k === 0 ? 0 : 7,
  }));
  if (id === '123' && firstA) {
    firstA = false;
    await new Promise((r) => setTimeout(r, 12_000));
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      accountId: id,
      source: 'STRATZ',
      fetchedAt: new Date().toISOString(),
      profile: { profile: { account_id: Number(id), personaname: `Account ${id}` } },
      matches,
      hasMore: false,
      nextOffset: 0,
      stale: false,
    }),
  );
});
await new Promise((r) => service.listen(0, '127.0.0.1', r));
const probe = createServer();
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const debugPort = probe.address().port;
await new Promise((r) => probe.close(r));
const child = spawn(resolve('src-tauri/target/release/ancient-lens.exe'), [], {
  windowsHide: true,
  env: {
    ...process.env,
    ANCIENT_TEST_DATA: directory,
    ANCIENT_TEST_ACCOUNT_FEED: feed,
    ANCIENT_STATS_URL: `http://127.0.0.1:${service.address().port}`,
    ANCIENT_WEBVIEW_DEBUG_PORT: String(debugPort),
  },
  stdio: 'pipe',
});
let browser;
const errors = [];
child.stderr.on('data', (data) => process.stderr.write(data));
try {
  let websocket;
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`App exited: ${child.exitCode}`);
    try {
      websocket = (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()).webSocketDebuggerUrl;
    } catch {}
    if (websocket) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!websocket) throw new Error('WebView2 unavailable');
  browser = await chromium.connectOverCDP(websocket);
  const context = browser.contexts()[0];
  await context.route('https://**/*', (route) => route.abort());
  let page;
  for (let i = 0; i < 100; i++) {
    page = context.pages().find((p) => p.url().includes('tauri.localhost'));
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!page) throw new Error('No app page');
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'My profile', exact: true }).click();
  await expect(page.getByTestId('own-mmr')).toHaveText(/6,586/, { timeout: 15000 });
  await expect(page.getByTestId('own-confidence')).toHaveText('60%');
  await expect(page.locator('.own-profile-rank').getByRole('img', { name: 'Immortal', exact: true })).toBeVisible();
  await expect(page.getByText('Rank not available', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'My Dota ID', exact: true })).not.toBeVisible();
  await sample('456', 'account-mismatch');
  await expect(page.getByTestId('own-mmr')).toHaveText('—', { timeout: 10000 });
  await expect(page.getByTestId('own-confidence')).toHaveText('—');
  await expect(page.getByRole('heading', { name: 'Account 456', exact: true })).toBeVisible();
  let state = await page.evaluate(() => window.ancient.getState());
  if (state.accountId !== '456' || state.mmr.length) throw new Error('Previous account leaked into B');
  await sample('456', 'measured', 3000, 75);
  await expect(page.getByTestId('own-mmr')).toHaveText(/3,000/, { timeout: 10000 });
  await expect(page.getByTestId('own-confidence')).toHaveText('75%');
  // Let the intentionally delayed A profile arrive; it must not replace B.
  await new Promise((r) => setTimeout(r, 7000));
  await expect(page.getByRole('heading', { name: 'Account 456', exact: true })).toBeVisible();
  await sample('123', 'measured', 6586, 60);
  await expect(page.getByTestId('own-mmr')).toHaveText(/6,586/, { timeout: 10000 });
  state = await page.evaluate(() => window.ancient.getState());
  if (state.accountId !== '123' || state.mmr.length !== 1 || state.mmr[0].accountId !== '123')
    throw new Error('A history was duplicated or mixed');
  // Below 30% confidence the game shows "Uncalibrated" instead of a rating; so does the app.
  await sample('123', 'calibrating', null, 29);
  await expect(page.getByTestId('own-mmr')).toHaveText('Uncalibrated', { timeout: 10000 });
  await expect(page.getByTestId('own-confidence')).toHaveText('29%');
  const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  if (saved.mmr.length !== 2 || saved.mmr.some((m) => m.value === 0)) throw new Error('Bad persisted samples');
  await sample('123', 'measured', 6586, 60);
  await expect(page.getByTestId('own-mmr')).toHaveText(/6,586/, { timeout: 10000 });
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/own-account-profile.png', fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('PASS: automatic account, live rating, A → B → A, stale history, calibration, per-account persistence');
} finally {
  if (browser) await browser.close();
  child.kill();
  service.closeAllConnections();
  await new Promise((r) => service.close(r));
}
