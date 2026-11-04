// Synthetic draft fixture for the native item scenario. All data is isolated; Dota is never started.
// --demo keeps the window open; keys 1/2/3/4/5 change drafts and q exits.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { nativeDriver, waitFor } from './native-capture.mjs';

const demo = process.argv.includes('--demo');
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/item-drafts.json', import.meta.url), 'utf8'));
const directory = await mkdtemp(join(tmpdir(), 'ancient-item-drafts-'));
const cache = join(directory, 'cache');
const out = resolve('test-results', 'native', 'items');
await mkdir(cache);
await mkdir(out, { recursive: true });
await writeFile(
  join(directory, 'state.json'),
  JSON.stringify({
    version: 1,
    accountId: demo ? '123' : '',
    token: 'b'.repeat(64),
    notes: [],
    mmr: [],
    nativeRosterReader: 'off',
    profileAccounts: demo ? ['123', '456'] : [],
    ratingSnapshots: demo
      ? {
          123: {
            mmr: 5758,
            confidence: 35,
            behaviorScore: 9000,
            communicationScore: 9300,
            confirmedAt: new Date().toISOString(),
          },
          456: {
            mmr: 3100,
            confidence: 55,
            behaviorScore: 10000,
            communicationScore: 10000,
            confirmedAt: new Date().toISOString(),
          },
        }
      : {},
    closeToTray: false,
  }),
);
await writeFile(
  join(cache, `resource-${createHash('sha256').update('heroes').digest('hex')}.json`),
  JSON.stringify({ endpoint: 'heroes', at: Date.now(), data: fixture.heroes }),
);
await writeFile(
  join(cache, `resource-${createHash('sha256').update('constants/patch').digest('hex')}.json`),
  JSON.stringify({
    endpoint: 'constants/patch',
    at: Date.now(),
    data: [{ name: 'Fixture patch', date: '2026-09-15T00:00:00Z' }],
  }),
);
for (const [hero, data] of Object.entries(fixture.stats)) {
  const { source, fetchedAt, stale, demonstration, ...raw } = data;
  await writeFile(join(cache, `items-v4-${hero}.json`), JSON.stringify({ at: Date.now(), data: raw }));
}
if (demo) {
  const avatar = 'https://avatars.fastly.steamstatic.com/0000000000000000000000000000000000000000_full.jpg';
  for (const [id, name] of [
    ['123', 'Kestrel of the Northern Sky'],
    ['456', 'Another invented account'],
  ]) {
    const history = {
      accountId: id,
      source: 'OpenDota',
      fetchedAt: new Date().toISOString(),
      stale: false,
      demonstration: true,
      hasMore: false,
      nextOffset: 0,
      profile: {
        rank_tier: null,
        profile: {
          account_id: Number(id),
          personaname: 'Previous fixture nickname',
          loccountrycode: 'SE',
          avatarfull: avatar,
        },
      },
      matches: Array.from({ length: 8 }, (_, index) => ({
        match_id: 900000000 + Number(id) * 10 + index,
        hero_id: index % 2 ? 2 : 8,
        start_time: Math.floor(Date.now() / 1000) - 7200 - index * 86400,
        duration: 2400,
        player_slot: 0,
        radiant_win: index % 3 !== 0,
        kills: 7 + index,
        deaths: 4,
        assists: 12,
        team_kills: 30,
        team_deaths: 20,
        gold_per_min: 500 + index * 20,
        xp_per_min: 600 + index * 15,
        position: 'POSITION_3',
        game_mode: 22,
        lobby_type: 7,
        last_hits: 220 + index * 10,
        denies: 8,
      })),
    };
    await writeFile(join(cache, `history-OpenDota-${id}.json`), JSON.stringify(history));
    await writeFile(
      join(cache, `steam-profile-v1-${id}.json`),
      JSON.stringify({
        accountId: id,
        name,
        avatar,
        source: 'Steam Community',
        fetchedAt: new Date().toISOString(),
        stale: false,
      }),
    );
  }
}
let app;
function draftLive(index, extra = {}) {
  const draft = fixture.drafts[index];
  const players = [draft.heroId, ...draft.allies, ...draft.enemies].map((heroId, slot) => ({
    key: slot === 0 ? 'self' : `fixture.${slot}`,
    team: slot < 5 ? 'radiant' : 'dire',
    teamSlot: slot % 5,
    heroId,
    heroName: fixture.heroes.find((h) => h.id === heroId).name,
    name: slot === 0 ? 'Kestrel' : `Demo player ${slot}`,
  }));
  // Same match for drafts 1/2 proves that changing enemies reranks without a data fetch.
  const live = {
    status: 'connected',
    receivedAt: Date.now(),
    mode: 'player',
    matchId: 'synthetic-items',
    selfTeamSlot: 0,
    gameState: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS',
    players,
    ...extra,
  };
  return live;
}
async function emit(index, extra = {}) {
  const live = draftLive(index, extra);
  await app.execute(
    'const rows=window.__internal_unstable_listeners_object_id__?.["live:update"]; window.__internal_unstable_listeners_function_id__({event:"live:update",payload:arguments[0]},Object.getOwnPropertyNames(rows??{}));',
    [live],
  );
  console.log(`Synthetic draft ${index + 1}: ${fixture.drafts[index].title}`);
}
async function selectItems() {
  await waitFor(
    () =>
      app.execute(
        'const button=document.querySelector(\'[aria-label="Item build"]\'); if(!button)return false; button.click(); return true;',
      ),
    'Item build navigation was not found',
  );
  await waitFor(
    () => app.execute('return !!document.querySelector(\'[aria-label="Item build"][aria-current="page"]\')'),
    'Item build page did not open',
  );
}
const text = () => app.execute('return document.querySelector(".item-build")?.innerText ?? ""');
const firstItem = () => app.execute('return document.querySelector(".item-option")?.getAttribute("data-item-id")');
async function capture(name) {
  await app.execute('return document.fonts.ready.then(()=>true)');
  await writeFile(join(out, name), await app.screenshot());
}
try {
  app = await nativeDriver(directory, { ANCIENT_STATS_URL: undefined });
  await app.useWindow('main');
  await app.resize(1740, 1100);
  await waitFor(
    () => app.execute('return !!window.ancient && !!document.querySelector(".analysis-panel")'),
    'Match screen did not load',
  );
  if (!demo) {
    await app.execute(
      'window.itemErrors=[]; addEventListener("error",e=>window.itemErrors.push(e.message)); addEventListener("unhandledrejection",e=>window.itemErrors.push(String(e.reason))); const original=window.ancient.getItemStats;window.itemNativeApi=original;window.itemRequests=[];window.ancient.getItemStats=(hero)=>{window.itemRequests.push(hero);return original(hero)};',
    );
    await emit(0);
    await selectItems();
    await waitFor(async () => (await firstItem()) === '160', 'Multi-enemy draft did not recommend Skadi');
    assert.ok((await text()).includes('Synthetic demonstration'));
    assert.ok((await text()).includes('Enemies first'));
    // Real pointer click opens the evidence, including sample sizes and the ally cap.
    await app.clickElement(await app.execute('return document.querySelector(".item-option summary")'));
    await waitFor(
      () => app.execute('return !!document.querySelector(".item-option[open]")'),
      'Item explanation did not open',
    );
    const reasons = await app.execute(
      'return document.querySelector(\'.item-option[data-item-id="160"] summary\').innerText',
    );
    for (const hero of ['Necrophos', 'Pudge', 'Witch Doctor']) assert.ok(reasons.includes(hero));
    assert.equal(await app.execute("return document.querySelectorAll('[data-standard-item]').length"), 6);
    await capture('necro-draft.png');
    const requests = await app.execute('return window.itemRequests.length');
    await emit(1);
    await waitFor(async () => (await firstItem()) === '135', 'Changed enemy draft did not rerank to Monkey King Bar');
    assert.equal(
      await app.execute('return window.itemRequests.length'),
      requests,
      'Draft changes should not refetch the hero sample',
    );
    await capture('changed-draft.png');
    await emit(2);
    await waitFor(
      async () => (await text()).includes('Matchup evidence is limited'),
      'Sparse statistics were presented as a recommendation',
    );
    await capture('sparse-draft.png');
    // Exercise late responses after a hero change with a real IPC request in flight.
    // Wraps Ember Spirit (hero 2), which is still uncached here: Juggernaut was fetched
    // above, so only an uncached hero produces the request the rejection needs.
    await app.execute(
      'const original=window.ancient.getItemStats;window.ancient.getItemStats=(hero)=>original(hero).then(data=>hero===2?new Promise(resolve=>{window.deliverOldItemStats=()=>resolve(data)}):data);',
    );
    await emit(3);
    await waitFor(
      () => app.execute('return typeof window.deliverOldItemStats === "function"'),
      'Delayed item request was not made',
    );
    await emit(2);
    await waitFor(
      async () => (await text()).includes('Ember Spirit') && (await text()).includes('Matchup evidence is limited'),
      'New hero result did not load',
    );
    await app.execute('window.deliverOldItemStats()');
    await app.execute('return new Promise(resolve=>setTimeout(resolve,100))');
    assert.ok(!(await text()).includes('Blink Dagger'), 'The late offlaner build leaked into the page');
    assert.ok(!(await text()).includes('Juggernaut'), 'The previous hero leaked into the page');
    assert.equal(await firstItem(), null);
    // Stale cache remains visible as stale, never relabelled as fresh.
    const raw = fixture.stats['106'];
    await writeFile(join(cache, 'items-v4-106.json'), JSON.stringify({ at: Date.now() - 7 * 3600000, data: raw }));
    await emit(2, { matchId: 'synthetic-items-stale' });
    await selectItems();
    await waitFor(async () => (await text()).includes('Saved statistics'), 'Stale cache was not marked');
    await capture('stale-draft.png');
    assert.deepEqual(await app.execute('return window.itemErrors'), []);
    // Unknown self and spectator contexts have no personal recommendation.
    await emit(0, { players: [], matchId: 'synthetic-items-unknown' });
    await selectItems();
    await waitFor(
      () => app.execute('return document.body.innerText.includes("Waiting for your confirmed hero")'),
      'Unknown self retained an item build',
    );
    await emit(0, { mode: 'spectator', matchId: 'synthetic-items-spectator' });
    await selectItems();
    await waitFor(
      () => app.execute('return document.body.innerText.includes("Waiting for your confirmed hero")'),
      'Spectator retained a personal build',
    );
    await app.execute('window.ancient.getItemStats=()=>Promise.reject(new Error("Synthetic statistics offline"))');
    await emit(0, { matchId: 'synthetic-items-error' });
    await selectItems();
    await waitFor(
      async () => (await text()).includes('Synthetic statistics offline'),
      'Item request failure was hidden',
    );
    await app.execute('window.ancient.getItemStats=window.itemNativeApi');
    await app.clickElement(
      await app.execute(
        'return [...document.querySelectorAll("button")].find(b=>b.textContent.includes("Retry item statistics"))',
      ),
    );
    await waitFor(async () => (await firstItem()) === '160', 'Item retry did not recover');
    await capture('item-options.png');
    await writeFile(join(out, 'item-panel.png'), await app.screenshot('.items-page'));
    assert.deepEqual(await app.execute('return window.itemErrors'), []);
    console.log(
      'Native item checks passed: own hero, draft reranking, 50% cap, purchase evidence, sparse data, stale cache and late-response rejection.',
    );
    await emit(3);
    await waitFor(
      async () => (await firstItem()) === '90',
      'Offlaner did not recommend Pipe against multiple magic threats',
    );
    assert.ok((await text()).includes('Zeus') && (await text()).includes('Leshrac'));
    await capture('offlane-pipe.png');
    await emit(4);
    await waitFor(async () => (await firstItem()) === '226', 'Changed offlane draft did not recommend Lotus Orb');
    await capture('offlane-lotus.png');
    // Undo the intentionally stale cache before the interactive examples are opened.
    await writeFile(join(cache, 'items-v4-106.json'), JSON.stringify({ at: Date.now(), data: fixture.stats['106'] }));
  }
  if (demo) {
    await emit(0);
    await selectItems();
    await app.execute(
      `
      const panel=document.createElement('div');
      panel.setAttribute('aria-label','Demonstration drafts');
      Object.assign(panel.style,{display:'flex',flexWrap:'wrap',gap:'8px',margin:'16px 0'});
      arguments[0].forEach(({title,live},index)=>{
        const button=document.createElement('button');button.className='secondary';
        button.textContent=(index+1)+' · '+title;
        button.addEventListener('click',()=>{
          const rows=window.__internal_unstable_listeners_object_id__?.['live:update'];
          window.__internal_unstable_listeners_function_id__({event:'live:update',payload:{...live,receivedAt:Date.now()}},Object.getOwnPropertyNames(rows??{}));
        });panel.append(button);
      });
      document.querySelector('.page-heading').after(panel);
    `,
      [fixture.drafts.map((draft, index) => ({ title: draft.title, live: draftLive(index) }))],
    );
    console.log('Demo is open. Keys 1/2/3/4/5: fake drafts; q: close. All displayed statistics are invented.');
    emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();
    await new Promise((done) => {
      let checking = false;
      let failures = 0;
      const watch = setInterval(async () => {
        if (checking) return;
        checking = true;
        try {
          await app.execute('return true');
          failures = 0;
        } catch {
          if (++failures >= 2) finish();
        } finally {
          checking = false;
        }
      }, 1000);
      function finish() {
        clearInterval(watch);
        done();
      }
      process.stdin.on('keypress', (value, key) => {
        if (value === 'q' || (key.ctrl && key.name === 'c')) finish();
        else if (['1', '2', '3', '4', '5'].includes(value)) void emit(Number(value) - 1).catch(console.error);
      });
    });
  }
} catch (error) {
  await app?.captureFailure(error);
  throw error;
} finally {
  if (demo && process.stdin.isTTY) process.stdin.setRawMode(false);
  if (demo) process.stdin.pause();
  await app?.close();
  // Windows may keep the WebView2 profile lockfile busy for a moment after the
  // renderer exits; retrying beats failing the whole run over a unlocked file.
  await rm(directory, { recursive: true, force: true, maxRetries: 12, retryDelay: 250 }).catch((error) =>
    console.error(`Temporary data not removed: ${error.message}`),
  );
}
