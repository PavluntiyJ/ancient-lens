// Shared setup of the native UI scenarios in this folder: isolated app data, fixture
// statistics behind a fake statistics service, the app under the native driver and the
// helpers every scenario uses. Each scenario calls `scenario(name, body)` once; it starts the
// app on fresh data, runs the body, checks that the page logged no errors and cleans up.
// `native-capture.mjs` drives WebKitWebDriver on Linux and the WebView2 debugging protocol on
// Windows behind the same calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { nativeDriver } from '../native-capture.mjs';
import { fixtureData, heroes, statisticsService, token } from './fixtures.mjs';

export { heroes, token };

export const platform = process.platform === 'win32' ? 'windows' : 'linux';
/**
 * Runs one scenario: a fresh data folder and statistics service, the app at the configured
 * 1740×1100 window on the match screen, then `body(t)` with the driver, the fixture service
 * (`t.fx`) and the shared helpers. A failure saves the window screenshots, geometry and log.
 */
export async function scenario(name, body) {
  const { directory, cache, releasesPath } = await fixtureData();
  const { fx, service } = await statisticsService();
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
    const find = () =>
      execute(
        'return [...document.querySelectorAll(arguments[1])].find(b => (b.textContent.trim() === arguments[0] || b.getAttribute("aria-label") === arguments[0]))',
        [text, selector],
      );
    // A page loaded on first use (Settings) may still be rendering.
    await waitFor(find, `Missing button: ${text}`, 5000).catch(() => {});
    const element = await find();
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
    // layout checks assume the match screen fits without scrolling.
    await app.resize(1740, 1100);
    await useWindow('main');
    await waitFor(
      () => execute('return !!window.ancient && document.body.innerText.includes("Match players")'),
      'Native UI did not load',
    );
    await execute(
      'window.smokeErrors = []; addEventListener("error", e => window.smokeErrors.push(e.message)); addEventListener("unhandledrejection", e => window.smokeErrors.push(String(e.reason)));',
    );
    // Draft request counts assume one rank bracket for the whole match; automatic brackets
    // are covered by tests/rank-bracket.test.ts.
    await execute(
      'localStorage.setItem("ancient-rank-bracket", "ALL"); window.dispatchEvent(new Event("stats-preferences"));',
    );
    const info = await call('getInfo');
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
    const tileIds = (name) =>
      execute(
        'return [...document.querySelectorAll(`.suggestion-category[aria-label="${arguments[0]}"] .suggestion-tile`)].map(e=>e.dataset.heroId)',
        [name],
      );
    const panelPage = (label) =>
      execute('return document.querySelector(`.analysis-panel[aria-label="${arguments[0]}"]`)?.dataset.page', [label]);
    // Ten fixture players in spectator GSI; `spectatorDraft` is the GSI draft block the first
    // accepted packet carries (only its shape reaches the diagnostics file).
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
    const spectatorDraft = {
      team2: { pick0_id: 1, ban0_id: 2, steamid: '76561197960265729', name: 'PrivateFixture', token },
      team3: { picks: [{ hero_id: 3 }], bans: [] },
    };
    const post = (value, headers = {}) =>
      fetch(`http://127.0.0.1:${info.gsiPort}/gsi`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(value),
      });
    /** The spectated ten-player match with profiles, totals and suggestions loaded. */
    const loadSpectatorMatch = async () => {
      payload.draft = spectatorDraft;
      assert.equal((await post(payload)).status, 200);
      await waitFor(
        () => execute('return document.body.innerText.includes("Profiles · 10/10 loaded")'),
        'Ten profiles did not load',
      );
      await waitFor(
        () =>
          execute('return [...document.querySelectorAll(".all-time")].every(cell => cell.textContent.includes("%"))'),
        'Lifetime totals did not arrive',
      );
      await waitFor(
        () => execute('return document.querySelectorAll(".suggestion-tile").length === 12'),
        'Draft suggestions did not load',
      );
      await waitFor(matchFits, 'Populated match does not fit');
    };
    // Deliver draft fixtures to the native event listener; keep frontend emit ACL closed.
    // The memory reader/worker are exercised separately by Rust fixtures, never Dota.
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
        fx.refuseWarmUp = !warmUp;
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
    // Relative to the panel content: the grid must not depend on how many heroes are known,
    // while the whole screen may zoom when a status line above the roster comes and goes.
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
    await mkdir('test-results', { recursive: true });
    await body({
      app,
      fx,
      info,
      directory,
      cache,
      releasesPath,
      payload,
      spectatorDraft,
      post,
      waitFor,
      execute,
      useWindow,
      call,
      screenshot,
      pointAt,
      checkHeaderInfo,
      setScale,
      clickButton,
      matchFits,
      assertPanelContentsFit,
      tileIds,
      panelPage,
      loadSpectatorMatch,
      emitDraft,
      matrixShape,
      sameShape,
    });
    await useWindow('main');
    assert.deepEqual(await execute('return window.smokeErrors'), []);
    console.log(`Native scenario ${name} passed on ${platform}. Wayland: ${info.wayland}.`);
  } catch (error) {
    await app?.captureFailure(error);
    throw error;
  } finally {
    fx.pendingDrafts.splice(0).forEach((resolve) => resolve());
    fx.pendingSummaries.splice(0).forEach((resolve) => resolve());
    await app?.close();
    await new Promise((resolve) => service.close(resolve));
    // WebView2 may hold its data folder for a moment after the app stops.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  }
}
