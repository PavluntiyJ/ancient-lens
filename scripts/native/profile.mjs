// The profile window: the own STRATZ profile, the ten-player card, MMR chart, filters and
// menus, match details, older pages, and saved history over private or failed refreshes.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scenario } from './harness.mjs';

await scenario(
  'profile',
  async ({
    fx,
    app,
    cache,
    waitFor,
    execute,
    useWindow,
    call,
    screenshot,
    pointAt,
    clickButton,
    loadSpectatorMatch,
  }) => {
    const { historyById } = fx;
    await loadSpectatorMatch();
    // Turbo matches count, as Settings → Match statistics → Include Turbo sets it.
    await execute(
      'localStorage.setItem("ancient-include-turbo", "true"); dispatchEvent(new Event("stats-preferences"));',
    );
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
    const requestsBeforeFilters = fx.historyRequests;
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
    assert.equal(fx.historyRequests, requestsBeforeFilters, 'Filters must not reload history');
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
    fx.privateHistory = true;
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
      !(await execute(
        'return document.querySelector(".own-profile").textContent.includes("STRATZ history is private")',
      )),
      'Private history note shown over saved matches',
    );
    fx.failHistory = true;
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
    const savedHistory = JSON.parse(await readFile(join(cache, 'history-STRATZ-1.json'), 'utf8'));
    assert.equal(savedHistory.matches.length, 49);
    assert.equal(savedHistory.source, 'STRATZ');

    assert.deepEqual(await execute('return window.smokeErrors'), []);
    await useWindow('main');
  },
);
