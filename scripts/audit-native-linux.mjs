// Replay public API captures in an isolated native window. Never attaches to Dota.
// ANCIENT_AUDIT_DATA=test-results/live-audit node scripts/audit-native-linux.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const captures = resolve(process.env.ANCIENT_AUDIT_DATA || 'test-results/live-audit');
const read = async (name) => JSON.parse(await readFile(join(captures, name), 'utf8'));
const data = await read('normalized.json');
const ids = (await read('public-ids.json')).map(String);
const heroes = await read('opendota-heroes.json');
const scenario = (await read('public-selection.json'))[0];
const heroIds = [...scenario.radiant_team, ...scenario.dire_team];
const pairs = new Map(data.drafts.flatMap((draft) => draft.matchups).map((row) => [row.heroId, row]));
const totals = new Map(
  (await Promise.all([read('public-totals-0.json'), read('public-totals-1.json')]))
    .flatMap((raw) => raw.data.players)
    .map((row) => [String(row.steamAccountId), { games: row.matchCount, wins: row.winCount }]),
);
const directory = await mkdtemp(join(tmpdir(), 'ancient-public-audit-'));
await mkdir(join(directory, 'cache'));
const token = 'e'.repeat(64);
await writeFile(
  join(directory, 'state.json'),
  JSON.stringify({ version: 1, accountId: ids[0], token, notes: [], mmr: [], nativeRosterReader: 'off' }),
);
await writeFile(
  join(directory, 'cache', `resource-${createHash('sha256').update('heroes').digest('hex')}.json`),
  JSON.stringify({ endpoint: 'heroes', at: Date.now(), data: heroes }),
);
const requests = [];
const service = createServer(async (req, res) => {
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    requests.push({ route: req.url, ...input });
    let output;
    if (req.url === '/v1/draft')
      output = {
        source: 'STRATZ',
        fetchedAt: new Date().toISOString(),
        positions: data.drafts[0].positions,
        matchups: input.ids.flatMap((id) => (pairs.has(id) ? [pairs.get(id)] : [])),
      };
    else if (req.url === '/v1/history') {
      output = data.histories.find((page) => page.accountId === input.id && page.nextOffset === input.offset + 25);
      if (!output) throw new Error('Uncaptured history page');
    } else
      output = {
        summaries: input.ids.map((id) => {
          const summary = data.summaries.find(
            (row) =>
              row.accountId === id &&
              row.days === input.days &&
              row.filter.mode === input.filter.mode &&
              row.filter.rankedOnly === input.filter.rankedOnly,
          );
          if (!summary) throw new Error('Uncaptured summary');
          return req.url === '/v1/totals' ? { ...summary, total: totals.get(id) } : summary;
        }),
      };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(output));
  } catch (error) {
    res.writeHead(500).end(String(error));
  }
});
await new Promise((done) => service.listen(0, '127.0.0.1', done));
const probe = createServer();
await new Promise((done) => probe.listen(0, '127.0.0.1', done));
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const driver = spawn('WebKitWebDriver', [`--port=${port}`, '--host=127.0.0.1'], {
  detached: true,
  env: {
    ...process.env,
    TAURI_WEBVIEW_AUTOMATION: 'true',
    ANCIENT_TEST_DATA: directory,
    XDG_DATA_HOME: join(directory, 'xdg-data'),
    XDG_CACHE_HOME: join(directory, 'xdg-cache'),
    ANCIENT_STATS_URL: `http://127.0.0.1:${service.address().port}`,
  },
  stdio: 'ignore',
});
let session;
async function request(path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const { value } = await response.json();
  if (!response.ok || value?.error) throw new Error(JSON.stringify(value));
  return value;
}
async function waitFor(check, label) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(label);
}
const execute = (script, args = []) => request(`/session/${session}/execute/sync`, { script, args });
async function call(name, ...args) {
  const out = await request(`/session/${session}/execute/async`, {
    script:
      'const done=arguments[arguments.length-1];window.ancient[arguments[0]](...arguments[1]).then(value=>done({value}),error=>done({error:String(error)}));',
    args: [name, args],
  });
  if (out.error) throw new Error(out.error);
  return out.value;
}
async function click(label) {
  const element = await execute(
    'return [...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")===arguments[0] || b.textContent.trim()===arguments[0])',
    [label],
  );
  assert.ok(element, label);
  await execute('arguments[0].scrollIntoView({block:"center"})', [element]);
  await request(`/session/${session}/element/${element['element-6066-11e4-a52e-4f735466cecf']}/click`, {});
}
const findings = [];
async function inspect(label) {
  await execute('document.querySelector(".app-shell > main")?.scrollTo(0,0);window.scrollTo(0,0)');
  if (label === 'audit-meta' || label === 'audit-counters')
    await execute('document.querySelector(".analysis-strip").scrollIntoView({block:"start"})');
  const images = await execute(
    `return [...document.images].filter(img=>img.getBoundingClientRect().width>0).map(img=>{const r=img.getBoundingClientRect(),s=getComputedStyle(img); return {src:img.getAttribute('src'),cls:img.className,parent:img.parentElement.className,width:r.width,height:r.height,complete:img.complete,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,fit:s.objectFit,filter:s.filter,parentFilter:getComputedStyle(img.parentElement).filter};})`,
  );
  const layout = await execute(
    'return {width:innerWidth,height:innerHeight,bodyWidth:document.body.scrollWidth,errors:window.auditErrors,text:document.body.innerText}',
  );
  const colors = await execute(
    'return [...document.querySelectorAll(".matchup-cell,.hero-performance")].map(el=>({class:el.className,strength:el.style.getPropertyValue("--advantage-intensity")||el.style.getPropertyValue("--hero-strength"),color:el.querySelector(".portrait")?getComputedStyle(el.querySelector(".portrait")).backgroundColor:null}))',
  );
  const stats = await execute(
    'return [...document.querySelectorAll(".stat")].map(el=>({label:el.querySelector("span")?.textContent,value:el.querySelector("strong")?.textContent}))',
  );
  findings.push({ label, images, layout, colors, stats });
  await writeFile(
    join(captures, `${label}.png`),
    Buffer.from(await request(`/session/${session}/screenshot`), 'base64'),
  );
}
try {
  await waitFor(
    () =>
      request('/status').then(
        () => true,
        () => false,
      ),
    'Driver unavailable',
  );
  session = (
    await request('/session', {
      capabilities: {
        alwaysMatch: { 'webkitgtk:browserOptions': { binary: resolve('src-tauri/target/release/ancient-lens') } },
      },
    })
  ).sessionId;
  await waitFor(
    () => execute('return !!window.ancient && document.body.innerText.includes("Match players")'),
    'Window unavailable',
  );
  await execute(
    'window.auditErrors=[];addEventListener("error",e=>auditErrors.push(e.message));addEventListener("unhandledrejection",e=>auditErrors.push(String(e.reason)))',
  );
  await request(`/session/${session}/window/rect`, { width: 1710, height: 927 });
  const info = await call('getInfo');
  assert.equal(info.dataPath, directory);
  const payload = {
    auth: { token },
    provider: { appid: 570 },
    map: { matchid: 'audit-public-roster', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 420 },
    player: { team2: {}, team3: {} },
    hero: { team2: {}, team3: {} },
  };
  ids.forEach((id, i) => {
    const team = i < 5 ? 'team2' : 'team3',
      key = `player${i}`;
    const row = data.summaries.find((row) => row.accountId === id);
    payload.player[team][key] = {
      steamid: String(76561197960265728n + BigInt(id)),
      name: row.profile.profile.personaname,
      team_slot: i % 5,
    };
    payload.hero[team][key] = { id: heroIds[i], name: heroes.find((h) => h.id === heroIds[i]).name };
  });
  await fetch(`http://127.0.0.1:${info.gsiPort}/gsi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await waitFor(
    () =>
      execute(
        'return document.body.innerText.includes("10/10 loaded") && !!document.querySelector(".suggestion-tile")',
      ),
    'Real-data roster not loaded',
  );
  assert.equal(await execute('return document.querySelectorAll(".advantage-matrix tbody td").length'), 25);
  const rendered = await execute(
    'return [...document.querySelectorAll(".match-table tbody tr[data-team-slot]")].map(el=>({name:el.querySelector(".player-link")?.textContent,total:el.querySelector(".all-time")?.textContent,period:el.cells[3]?.textContent}))',
  );
  assert.equal(rendered.length, 10);
  for (const [i, row] of rendered.entries()) {
    const id = ids[i],
      summary = data.summaries.find(
        (s) => s.accountId === id && s.days === 14 && s.filter.mode === 'normal' && !s.filter.rankedOnly,
      );
    assert.equal(row.name, summary.profile.profile.personaname);
    assert.ok(row.total.replace(/[\s,]/g, '').startsWith(String(totals.get(id).games)));
  }
  // Cells show the winner; the signed value (Radiant positive) is in each cell's label.
  const displayed = await execute(`return [...document.querySelectorAll('.matchup-cell')].map(el => {
    const m = /(Radiant|Dire) \\+([0-9.]+) percentage points/.exec(el.getAttribute('aria-label'));
    return m ? (m[1] === 'Radiant' ? 1 : -1) * Number(m[2]) : 0;
  })`);
  const formulas = (await read('formula-report.json')).find((row) => row.matchId === scenario.match_id);
  assert.deepEqual(
    displayed,
    formulas.matrix.flat().map((cell) => Number(cell.value.toFixed(2)) || 0),
  );
  const panelGeometry = () =>
    // Relative to the match canvas: clicks may scroll a window below the fit floor.
    execute(`const o=document.querySelector('.match-fit').getBoundingClientRect();
    return [...document.querySelectorAll('.match-roster,.analysis-panel')].map(el=>{
    const r=el.getBoundingClientRect();return [r.x-o.x,r.y-o.y,r.width,r.height];
  })`);
  await new Promise((done) => setTimeout(done, 250));
  const baseline = await panelGeometry();
  for (const label of ['Left panel', 'Right panel']) {
    const count = await execute(
      'return document.querySelectorAll(`[aria-label="${arguments[0]}: panels"] button`).length',
      [label],
    );
    for (const direction of ['next', 'previous']) {
      for (let index = 0; index < count; index++) {
        await click(`${label}: ${direction} panel`);
        await new Promise((done) => setTimeout(done, 100));
        const geometry = await panelGeometry();
        assert.ok(
          geometry.every((rect, i) => rect.every((value, j) => Math.abs(value - baseline[i][j]) <= 1)),
          `${label} changes layout on real data`,
        );
      }
    }
  }
  const imageDeadline = Date.now() + 15000;
  while (Date.now() < imageDeadline && !(await execute('return [...document.images].every(img=>img.complete)')))
    await new Promise((done) => setTimeout(done, 250));
  assert.ok(
    await execute(`
    const cells = [...document.querySelectorAll('.matchup-cell.radiant .portrait')];
    return new Set(cells.map(el => getComputedStyle(el).backgroundColor)).size > 1;
  `),
    'Different matchup strengths must produce different tints',
  );
  assert.ok(
    await execute(`
    // Near-even pairs stay plain grey; the team tints start above them.
    const cells = [...document.querySelectorAll('.matchup-cell.neutral .portrait')];
    return cells.every(el => getComputedStyle(el).backgroundColor === 'rgb(115, 115, 115)');
  `),
    'Neutral matchups must stay grey',
  );
  assert.ok(
    await execute('return document.body.innerText.includes("No games in this sample")'),
    'Incomplete zero sample was not identified',
  );
  for (const scale of [80, 100, 120]) {
    await execute(
      'localStorage.setItem("ancient-display",JSON.stringify({scale:arguments[0]}));window.dispatchEvent(new Event("stats-preferences"))',
      [scale],
    );
    await waitFor(
      () =>
        execute(`
      const page=document.querySelector('.match-page'),fit=document.querySelector('.match-fit');
      const content=fit.getBoundingClientRect(),host=page.getBoundingClientRect();
      if(page.classList.contains('match-scroll'))return Math.abs(Number(fit.style.zoom)-0.9)<0.002;
      return content.bottom<=host.bottom+2 && content.right<=host.right+2 && content.bottom<=innerHeight;
    `),
      `Real data does not fit at ${scale}%`,
    );
    await inspect(`audit-roster-${scale}`);
  }
  await execute(
    'localStorage.setItem("ancient-display",JSON.stringify({scale:100}));window.dispatchEvent(new Event("stats-preferences"))',
  );
  await click('Right panel: Meta');
  await inspect('audit-meta');
  await click('Right panel: Counter picks against Dire');
  await inspect('audit-counters');
  await click('My profile');
  for (const id of [...ids.slice(0, 4), ids[7]]) {
    await execute(
      'localStorage.setItem("ancient-include-turbo","false");window.dispatchEvent(new Event("stats-preferences"))',
    );
    await call('setAccount', id);
    const page = data.histories.find((page) => page.accountId === id && page.nextOffset === 25);
    await waitFor(
      () =>
        execute('return !!document.querySelector(".own-profile") && document.body.innerText.includes(arguments[0])', [
          page.profile.profile.personaname,
        ]),
      'Public profile not loaded',
    );
    await waitFor(
      () =>
        execute(
          'return document.querySelectorAll(".history-table tbody tr").length>0 || document.body.innerText.includes("No matches in the loaded history")',
        ),
      'History rows missing',
    );
    await inspect(`audit-profile-${id}`);
    assert.ok(
      await execute('return document.querySelector(".profile-sample").textContent.includes("incomplete sample")'),
    );
    assert.equal(await execute('return document.querySelector(`[aria-label="Profile modes"]`).value'), 'match');
    await execute(
      'localStorage.setItem("ancient-include-turbo","true");window.dispatchEvent(new Event("stats-preferences"))',
    );
    await waitFor(
      () => execute('return document.querySelectorAll(".history-table tbody tr").length>0'),
      'Turbo history missing',
    );
    await inspect(`audit-profile-turbo-${id}`);
    await click('Load older matches');
    await waitFor(
      async () => (await call('getHistory', id, 0, true)).matches.length >= 50,
      'History pagination missing',
    );
    const cached = await call('getHistory', id, 0, true);
    assert.equal(new Set(cached.matches.map((match) => match.match_id)).size, cached.matches.length);
    if (id === ids[7]) {
      assert.ok(await execute('return !document.querySelector(".history-table").textContent.includes("Single Draft")'));
      await execute(
        'const select=document.querySelector(`[aria-label="Profile modes"]`);select.value="all";select.dispatchEvent(new Event("change",{bubbles:true}));',
      );
      await waitFor(
        () => execute('return document.querySelector(".history-table").textContent.includes("Single Draft")'),
        'Single Draft was lost in all-mode history',
      );
      await inspect('audit-profile-all-modes');
      await execute(
        'const select=document.querySelector(`[aria-label="Profile modes"]`);select.value="match";select.dispatchEvent(new Event("change",{bubbles:true}));',
      );
    }
  }
  await request(`/session/${session}/window/rect`, { width: 1280, height: 800 });
  await inspect('audit-profile-narrow');
  await click('Match and draft');
  await fetch(`http://127.0.0.1:${info.gsiPort}/gsi`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      map: { ...payload.map, matchid: 'audit-empty-draft', game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION' },
      hero: { team2: {}, team3: {} },
    }),
  });
  await waitFor(() => execute('return document.body.innerText.includes("audit-empty-draft")'), 'Empty draft missing');
  await click('Right panel: Meta');
  await waitFor(
    () => execute('return document.querySelectorAll(".meta-tile").length === 6'),
    'Meta before first pick did not load',
  );
  await inspect('audit-meta-empty-draft');
  assert.deepEqual(await execute('return window.auditErrors'), []);
  console.log(
    'Public native audit passed: ten real profiles, 25 matrix cells, scale 80/100/120, meta/counters, five paginated profiles.',
  );
} finally {
  await writeFile(join(captures, 'ui-report.json'), JSON.stringify({ findings, requests }, null, 2));
  if (session) await fetch(`http://127.0.0.1:${port}/session/${session}`, { method: 'DELETE' }).catch(() => {});
  if (driver.pid) {
    try {
      process.kill(-driver.pid, 'SIGTERM');
    } catch {}
  }
  await new Promise((done) => service.close(done));
  await rm(directory, { recursive: true, force: true });
}
