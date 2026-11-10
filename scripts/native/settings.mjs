// Settings with a loaded match: statistics preferences, the section list, window options,
// suggestion controls, interface scale without reloads, display reset and window sizes.
import assert from 'node:assert/strict';
import { scenario, platform } from './harness.mjs';

await scenario(
  'settings',
  async ({
    fx,
    app,
    waitFor,
    execute,
    call,
    screenshot,
    clickButton,
    matchFits,
    assertPanelContentsFit,
    loadSpectatorMatch,
  }) => {
    const { batches } = fx;
    await loadSpectatorMatch();
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

    try {
      await waitFor(
        async () =>
          batches.length >= beforeTurboBatches + 2 &&
          (await execute(
            'return !document.querySelector(".match-toolbar [role=status]") && !document.querySelector(".previous-selection")',
          )),
        'Turbo refresh did not finish before scale checks',
      );
    } catch (error) {
      // Name the unmet condition: a flaky run then shows whether summary requests were missing,
      // a refresh never ended, or rows kept an older sample (and the error each row reports).
      const page = await execute(
        'return { status: [...document.querySelectorAll(".match-toolbar [role=status]")].map(e=>e.textContent), note: document.querySelector(".table-refresh-note")?.textContent ?? null, previous: [...document.querySelectorAll(".match-table tbody tr")].filter(r=>r.querySelector(".previous-selection")).map(r=>({ player: r.querySelector(".player-name")?.textContent, sample: r.querySelector(".previous-selection").textContent, titles: [...r.querySelectorAll("small[title]")].map(s=>s.title).filter(Boolean) })) }',
      ).catch((reason) => ({ unavailable: String(reason) }));
      error.message += `\n${JSON.stringify({ summaryBatches: batches.slice(beforeTurboBatches), page }, null, 2)}`;
      throw error;
    }
    const scaleBatches = batches.length;
    const scaleDraftRequests = fx.draftRequests;
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
      await waitFor(
        () => execute('return !!document.querySelector(".scale-options")'),
        'Scale settings did not render',
      );
    }
    assert.ok(
      toolbarHeights[4] > toolbarHeights[0] * 1.4,
      'Scale must change rendered controls, while rows adapt to available height',
    );
    assert.equal(batches.length, scaleBatches, 'Scaling must not reload player statistics');
    assert.equal(fx.draftRequests, scaleDraftRequests, 'Scaling must not recalculate remote draft data');
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
  },
);
