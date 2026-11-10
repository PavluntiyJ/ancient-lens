// Startup, authenticated GSI and the spectated ten-player table: profiles in batches, totals,
// identity mapping, slot colours, flags, hover card links, the smurf mark and a player's card.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { scenario, platform, token } from './harness.mjs';

await scenario(
  'table',
  async ({
    fx,
    info,
    directory,
    payload,
    spectatorDraft,
    post,
    waitFor,
    execute,
    call,
    pointAt,
    checkHeaderInfo,
    clickButton,
    matchFits,
    assertPanelContentsFit,
  }) => {
    const { batches, totalBatches, historyById, partyRequests } = fx;
    assert.equal(info.runtime, 'Tauri + Rust');
    assert.equal(info.dataPath, directory);
    assert.ok(info.gsiPort > 0 && info.gsiPort !== 32123);
    // The log file sits in the isolated data folder and never holds the GSI token.
    assert.equal(info.logPath, join(directory, 'logs', 'ancient-lens.log'));
    const log = await readFile(info.logPath, 'utf8');
    assert.match(log, /Ancient Lens \S+ started on /);
    assert.ok(!log.includes(token));
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
    assert.equal((await post({ ...payload, auth: { token: 'wrong' } })).status, 403);
    assert.equal((await post(payload, { origin: 'https://untrusted.example' })).status, 403);
    const diagnosticPath = join(directory, 'gsi-draft-diagnostics.jsonl');
    await assert.rejects(access(diagnosticPath), 'Rejected packets reached diagnostics');
    payload.draft = spectatorDraft;
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
    // Positions in the page, not the viewport: clicking a paging button that is partly out of
    // view lets WebDriver scroll it in, which moves every panel alike without any layout jump.
    const panelGeometry = () =>
      execute(`
    return [...document.querySelectorAll('.match-roster, .analysis-panel')].map(el => {
      let x = window.scrollX, y = window.scrollY;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        x += parent.scrollLeft;
        y += parent.scrollTop;
      }
      const r = el.getBoundingClientRect(); return [r.x + x, r.y + y, r.width, r.height];
    });
  `);
    // Fitting the canvas and choosing two/three panels use separate ResizeObservers. A
    // canvas that fits once can still be between those updates; start only after its
    // complete geometry stays unchanged across consecutive samples.
    let stablePanels;
    let stableSamples = 0;
    await waitFor(async () => {
      const current = await panelGeometry();
      stableSamples = JSON.stringify(current) === JSON.stringify(stablePanels) ? stableSamples + 1 : 0;
      stablePanels = current;
      return (await matchFits()) && stableSamples >= 2;
    }, 'Initial match layout did not settle');
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
            changed.length === stablePanels.length &&
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
    // Account 2 was opened in the player card: its cache is its own page, not account 1's.
    const otherHistory = await call('getHistory', '2', 0, true);
    assert.ok(
      otherHistory?.accountId === '2' && otherHistory.matches.length === 25,
      'Player card history mixed accounts',
    );
    await execute('document.querySelector(".suggestion-tile img")?.dispatchEvent(new Event("error"));');
    await waitFor(
      () => execute('return !!document.querySelector(".suggestion-tile .portrait-fallback")?.textContent'),
      'Missing image left an anonymous suggestion',
    );
  },
);
