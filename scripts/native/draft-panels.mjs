// The analysis panels of a spectated match: hero pages, the shared lane, independent panels,
// lane summary, counter and meta pages without refetching, and a slow period refresh.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { scenario } from './harness.mjs';

await scenario(
  'draft-panels',
  async ({ fx, waitFor, execute, screenshot, clickButton, tileIds, panelPage, loadSpectatorMatch }) => {
    const { pendingSummaries } = fx;
    await loadSpectatorMatch();
    const carouselCalls = fx.draftRequests;
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
    assert.equal(fx.draftRequests, carouselCalls, 'Paging or lanes refetched draft data');
    assert.equal(await execute('return document.querySelectorAll(".matchup-cell").length'), 25);
    assert.ok(
      await execute(
        'return document.querySelectorAll(".matchup-cell.radiant").length > 0 && document.querySelectorAll(".matchup-cell.dire").length > 0',
      ),
    );
    assert.equal(await execute('return document.body.innerText.includes("Bans are not")'), false);
    // Left panel: matchups; right panel: suggestions of a side. Panels move independently.
    assert.equal(await panelPage('Left panel'), 'matchups');
    assert.equal(await panelPage('Right panel'), 'suggest-radiant');
    const matrixBefore = await execute('return document.querySelector(".advantage-matrix").innerHTML');
    const callsBefore = fx.draftRequests;
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
    assert.equal(fx.draftRequests, callsBefore, 'Side switching refetched draft data');
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
      await execute(
        'return [...document.querySelectorAll(".counter-tile")].every(tile=>Number(tile.dataset.heroId)>10)',
      ),
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
    assert.equal(fx.draftRequests, callsBefore, 'Counter tab requested new draft data');
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
    assert.equal(fx.draftRequests, callsBefore, 'Meta tab or role switching requested draft data');
    // A slow period refresh must retain rows and identify the old selection.
    fx.delaySummaries = true;
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
    fx.delaySummaries = false;
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
  },
);
