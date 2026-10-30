import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { captureNativeFailure } from './native-diagnostics.mjs';

// Memory reader consent on Windows: the toggle persists, the isolated worker starts in test
// mode (it never opens the game process) and stops again. Mirrors the Linux smoke's block.
const directory = await mkdtemp(join(tmpdir(), 'ancient-roster-'));
const token = 'b'.repeat(64);
await writeFile(
  join(directory, 'state.json'),
  JSON.stringify({ version: 1, accountId: '1', token, notes: [], mmr: [] }),
);
// No statistics are needed here; every provider request gets an empty refusal.
const service = createServer((req, res) => {
  req.resume();
  res.writeHead(404, { 'content-type': 'application/json' }).end('{}');
});
await new Promise((resolve) => service.listen(0, '127.0.0.1', resolve));
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const debugPort = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const child = spawn(resolve(process.env.ANCIENT_NATIVE_BINARY || 'src-tauri/target/release/ancient-lens.exe'), [], {
  windowsHide: true,
  env: {
    ...process.env,
    ANCIENT_TEST_DATA: directory,
    ANCIENT_STATS_URL: `http://127.0.0.1:${service.address().port}`,
    ANCIENT_WEBVIEW_DEBUG_PORT: String(debugPort),
  },
  stdio: 'pipe',
});
let diagnostic = '';
child.stdout.on('data', (data) => (diagnostic = (diagnostic + data).slice(-16000)));
child.stderr.on('data', (data) => (diagnostic = (diagnostic + data).slice(-16000)));
let browser;
let page;
const failures = [];
try {
  let endpoint;
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw new Error(`Native app exited: ${child.exitCode}`);
    try {
      endpoint = (await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()).webSocketDebuggerUrl;
      if (endpoint) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!endpoint) throw new Error('WebView2 debugging endpoint unavailable');
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  await context.route('https://**/*', (route) => route.abort());
  for (let i = 0; i < 100 && !page; i++) {
    for (const candidate of context.pages()) {
      if (
        candidate.url().includes('tauri.localhost') &&
        (await candidate.evaluate(() => window.ancient?.windowName === 'main').catch(() => false))
      ) {
        page = candidate;
        break;
      }
    }
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!page) throw new Error('Tauri page unavailable');
  page.on('pageerror', (error) => failures.push(error.message));
  await expect(page.getByRole('heading', { name: 'Match players', exact: true })).toBeVisible();
  const info = await page.evaluate(() => window.ancient.getInfo());
  const live = () => page.evaluate(() => window.ancient.getLive());
  const post = (value) =>
    fetch(`http://127.0.0.1:${info.gsiPort}/gsi`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(value),
    });
  const state = async () => JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));

  // A participant in hero selection with reading off: the notice explains what is missing.
  const drafting = {
    auth: { token },
    provider: { appid: 570 },
    map: { matchid: '987654', game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION' },
    player: { team_name: 'dire' },
    hero: { id: 0 },
  };
  // Dota repeats GSI every few seconds; repeat it here too, so a packet that arrives before
  // the page listens cannot decide the result.
  const notice = page.getByText('The enemy roster, picks, and bans require memory reading');
  await expect
    .poll(
      async () => {
        if (!(await post(drafting)).ok) throw new Error('GSI rejected the draft fixture');
        return notice.isVisible();
      },
      { timeout: 15000, intervals: [500] },
    )
    .toBe(true);
  if ((await state()).nativeRosterReader !== 'off') throw new Error('Reading must be off by default');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Read roster and rating from Dota memory' })).toBeVisible();
  const toggle = page.getByRole('checkbox', { name: 'Allow Dota memory reading' });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(toggle).toBeEnabled();
  if ((await state()).nativeRosterReader !== 'on') throw new Error('Reader opt-in was not saved');
  await post(drafting);
  await expect.poll(async () => (await live()).draftStatus, { timeout: 10000 }).toBe('test-mode');

  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(toggle).toBeEnabled();
  const stopped = await live();
  if (stopped.rosterStatus !== 'disabled' || stopped.draftStatus !== undefined || stopped.draft !== undefined)
    throw new Error(`Reader did not stop: ${JSON.stringify(stopped)}`);
  if ((await state()).nativeRosterReader !== 'off') throw new Error('Reader opt-out was not saved');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/native-windows-reader.png', fullPage: true });
  if (failures.length) throw new Error(failures.join('\n'));
  console.log('Windows reader smoke passed: notice, opt-in persistence, isolated worker start/stop, opt-out.');
} catch (error) {
  await captureNativeFailure({
    error,
    log: diagnostic,
    driver: page && {
      useWindow: async (name) => {
        const found = [];
        for (const candidate of browser.contexts()[0].pages()) {
          if (await candidate.evaluate((label) => window.ancient?.windowName === label, name).catch(() => false)) {
            found.push(candidate);
          }
        }
        if (!found.length) throw new Error(`No ${name} window`);
        page = found[0];
      },
      execute: (script) => page.evaluate((source) => new Function(source)(), script),
      screenshot: () => page.screenshot(),
    },
  });
  throw error;
} finally {
  await browser?.close();
  child.kill();
  await new Promise((resolve) => service.close(resolve));
}
