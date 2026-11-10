// Hovers in a native draft: debounce, changed scores, candidates, lane flags, the provisional
// matrix, confirmation and bans, late and disabled replies, large drafts and the warm-up.
import assert from 'node:assert/strict';
import { scenario, heroes } from './harness.mjs';

await scenario(
  'hover-draft',
  async ({
    fx,
    app,
    waitFor,
    execute,
    screenshot,
    clickButton,
    assertPanelContentsFit,
    tileIds,
    emitDraft,
    matrixShape,
    sameShape,
  }) => {
    const { batches, totalBatches, draftBatches, pendingDrafts } = fx;
    await clickButton('Match and draft');
    const beforeAnonymous = batches.length;
    const beforeTotals = totalBatches.length;
    fx.hoverDraft = true;
    const hoverPicks = [
      { slot: 0, team: 'radiant', heroId: 11 },
      { slot: 5, team: 'dire', heroId: 12 },
    ];
    const hover = (heroId) => [{ slot: 6, team: 'dire', heroId }];
    await emitDraft('810001', hoverPicks, undefined, [], hover(13), [{ slot: 6, team: 'dire', flags: 4 }]);
    await waitFor(
      () =>
        execute(
          'return !!document.querySelector(".suggestion-tile") && !!document.querySelector(`.selected-hero[data-hero-id="13"] .draft-hover`)',
        ),
      'Hover did not load draft',
    );
    // The matrix keeps this shape whatever the number of known heroes (checked again below).
    const twoHeroShape = await matrixShape();
    assert.equal(await execute('return document.querySelector(".draft-scope").textContent'), 'Known picks: 2/10');
    await assertPanelContentsFit();
    assert.equal(
      await execute('return document.querySelector(".match-role[data-lanes] .role-icon").getAttribute("src")'),
      './roles/midlane.png',
    );
    assert.ok(
      await execute(
        'return document.querySelectorAll(".matchup-provisional").length > 0 && [...document.querySelectorAll(".matrix-axis")].some(el=>(el.title || el.dataset.title).includes("hovered"))',
      ),
    );
    // Self is Dire: the only counter page is against the enemy (Radiant).
    await clickButton('Right panel: Counter picks against Radiant');
    await waitFor(
      () =>
        execute(
          'return !!document.querySelector(`.counter-row[data-enemy-id="11"]`) && !document.querySelector(`.counter-row[data-enemy-id="13"]`)',
        ),
      'Counters must list enemy heroes only, not an own-team hover',
    );
    await clickButton('Right panel: Picks for your team');
    const hoverStyle = await execute(
      'const el=document.querySelector(`.selected-hero[data-hero-id="13"] .portrait`); const style=getComputedStyle(el); return {filter:style.filter,opacity:Number(style.opacity)}',
    );
    assert.ok(
      hoverStyle.filter.includes('grayscale(1)') && hoverStyle.opacity < 1,
      'Hover portrait is not grey and translucent',
    );
    const oldSuggestions = await execute(
      'return [...document.querySelectorAll(".suggestion-tile")].map(el=>el.getAttribute("aria-label")).join("|")',
    );
    const beforeHovers = fx.draftRequests;
    // Hovers changing faster than the 100 ms debounce send one request, for the last hero.
    for (const heroId of [15, 17, 14])
      await emitDraft('810001', hoverPicks, undefined, [], hover(heroId), [{ slot: 6, team: 'dire', flags: 24 }]);
    await waitFor(
      () => execute('return !!document.querySelector(`.selected-hero[data-hero-id="14"] .draft-hover`)'),
      'Hover did not update immediately',
    );
    // A hover change keeps the match's data on screen until the new hero arrives.
    assert.ok(
      await execute('return document.querySelectorAll(".suggestion-tile").length > 0'),
      'Panels dropped the match data on a hover change',
    );
    // Panels never empty now, so wait for the debounced request itself.
    await waitFor(() => Promise.resolve(fx.draftRequests > beforeHovers), 'Debounced hover never loaded');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(fx.draftRequests, beforeHovers + 1);
    // Only the last hover is requested, and only because this match has not asked for it.
    assert.deepEqual(draftBatches.at(-1), [14]);
    assert.notEqual(
      await execute(
        'return [...document.querySelectorAll(".suggestion-tile")].map(el=>el.getAttribute("aria-label")).join("|")',
      ),
      oldSuggestions,
      'Ally hover did not change scores',
    );
    assert.equal(
      await execute('return document.querySelector(".match-role[data-lanes]").dataset.lanes.split(",").length'),
      2,
    );
    assert.ok(
      await execute(
        'return document.querySelector(".match-role[data-lanes]").getAttribute("aria-label").includes("selected in the draft")',
      ),
    );
    await screenshot('hover');
    await app.resize(1200, 927);
    await waitFor(() => execute('return innerWidth <= 1210'), 'Hover window did not resize');
    assert.ok(
      await execute(
        'const matrix=document.querySelector(".matrix-panel").closest(".analysis-panel").getBoundingClientRect(); const carousel=document.querySelector(".draft-carousel").closest(".analysis-panel").getBoundingClientRect(); return Math.abs(matrix.top-carousel.top)<3 && carousel.left>matrix.left',
      ),
      'Fixed matrix and recommendations are misaligned in a narrow window',
    );
    await app.resize(1710, 927);
    const beforeLane = fx.draftRequests;
    await emitDraft('810001', hoverPicks, undefined, [], hover(14), [{ slot: 6, team: 'dire', flags: 2 }]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(fx.draftRequests, beforeLane, 'Lane icon refetched hero statistics');
    const beforeHeroTwo = fx.draftRequests;
    await emitDraft('810001', [hoverPicks[0]], undefined, [], hover(2), [{ slot: 6, team: 'dire', flags: 2 }]);
    // The old scores stay up while hero 2 loads; page only once its reply has been applied.
    await waitFor(
      () => Promise.resolve(draftBatches.at(-1)?.join(',') === '2' && fx.draftRequests > beforeHeroTwo),
      'Hover 2 was not requested',
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Shrinkage reorders candidates, so search every page (and return to the first).
    const candidateOnAnyPage = async (heroId) => {
      let found = false;
      const categories = await execute(
        'return [...document.querySelectorAll(".suggestion-category")].map(el=>el.getAttribute("aria-label"))',
      );
      for (const category of categories) {
        const hasHero = () =>
          execute(
            'return !!document.querySelector(`.suggestion-category[aria-label="${arguments[0]}"] .suggestion-tile[data-hero-id="${arguments[1]}"]`)',
            [category, heroId],
          );
        found = (await hasHero()) || found;
        const next = `Next ${category} heroes`;
        if (await execute('return !document.querySelector(`button[aria-label="${arguments[0]}"]`)?.disabled', [next])) {
          const before = await tileIds(category);
          await execute(
            'document.querySelector(`button[aria-label="${arguments[0]}"]`).scrollIntoView({block:"nearest"})',
            [next],
          );
          await clickButton(next);
          await waitFor(
            async () => JSON.stringify(await tileIds(category)) !== JSON.stringify(before),
            'Hero page did not change',
          );
          found = (await hasHero()) || found;
          await clickButton(`Previous ${category} heroes`);
          await waitFor(
            async () => JSON.stringify(await tileIds(category)) === JSON.stringify(before),
            'Hero page did not reset',
          );
        }
      }
      return found;
    };
    await waitFor(() => candidateOnAnyPage(2), 'Hovered hero was excluded from candidates');
    assert.equal(await execute('return document.querySelector(".draft-scope").textContent'), 'Known picks: 1/10');
    await clickButton('Right panel: Meta');
    await waitFor(
      () => execute('return !!document.querySelector(`.meta-tile[data-hero-id="2"]`)'),
      'Meta excluded an unconfirmed hover',
    );
    await clickButton('Right panel: Picks for your team');
    const beforeConfirm = fx.draftRequests;
    await emitDraft('810001', [hoverPicks[0], ...hover(2)], undefined, [], hover(2));
    await waitFor(
      () =>
        execute(
          'return !!document.querySelector(".suggestion-tile") && !document.querySelector(`.suggestion-tile[data-hero-id="2"]`) && !document.querySelector(".draft-hover")',
        ),
      'Confirm did not exclude the hero or clear hover',
    );
    assert.equal(fx.draftRequests, beforeConfirm, 'Confirming the same hero refetched aggregates');
    assert.equal(
      await execute('return !!document.querySelector(`.meta-tile[data-hero-id="2"]`)'),
      false,
      'Meta retained a confirmed pick',
    );
    await emitDraft('810001', [hoverPicks[0]], undefined, [2], hover(2));
    await waitFor(
      () =>
        execute(
          'return !!document.querySelector(`.selected-hero[data-hero-id="2"] .draft-hover`) && !!document.querySelector(".banned-hover") && !document.querySelector(`.suggestion-tile[data-hero-id="2"]`)',
        ),
      'Banned hover must remain grey in its player row',
    );
    await clickButton('Right panel: Meta');
    await waitFor(
      () =>
        execute(
          'return !!document.querySelector(`.analysis-panel[aria-label^=Right] .meta-tile.banned[data-hero-id="2"] .ban-portrait`)',
        ),
      'Meta did not strike the banned hero through in place',
    );
    await clickButton('Right panel: Counter picks against Radiant');
    assert.equal(
      await execute('return !!document.querySelector(`.counter-tile[data-hero-id="2"]`)'),
      false,
      'Counter picks retained a banned hero',
    );
    await clickButton('Right panel: Picks for your team');
    await emitDraft(
      '810001',
      [],
      undefined,
      [],
      [
        { slot: 0, team: 'radiant', heroId: 19 },
        { slot: 6, team: 'dire', heroId: 20 },
      ],
    );
    await waitFor(
      () =>
        execute(
          'return document.querySelectorAll(".matchup-cell .portrait").length === 1 && !!document.querySelector(".suggestion-tile")',
        ),
      'Hover-only teams did not produce matchups',
    );
    assert.equal(await execute('return document.querySelector(".draft-scope").textContent'), 'Known picks: 0/10');
    fx.delayDraft = true;
    await emitDraft('810001', [], undefined, [], hover(21));
    await waitFor(() => Promise.resolve(pendingDrafts.length === 1), 'Delayed hover request did not start');
    await emitDraft('810002', []);
    fx.delayDraft = false;
    pendingDrafts.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      await execute(
        'return document.querySelectorAll(".suggestion-tile, .draft-hover, .match-role[data-lanes]").length',
      ),
      0,
      'Late hover revived the old match',
    );
    await emitDraft('810002', [], undefined, [], hover(22), [{ slot: 6, team: 'dire', flags: 4 }], 'disabled');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      await execute(
        'return document.querySelectorAll(".suggestion-tile, .draft-hover, .match-role[data-lanes]").length',
      ),
      0,
      'Disabled reader displayed intentions',
    );
    const beforeLargeDraft = fx.draftRequests;
    const fullPicks = Array.from({ length: 10 }, (_, slot) => ({
      slot,
      team: slot < 5 ? 'radiant' : 'dire',
      heroId: slot + 1,
    }));
    await emitDraft(
      '810003',
      fullPicks,
      undefined,
      [],
      [
        { slot: 0, team: 'radiant', heroId: 11 },
        { slot: 5, team: 'dire', heroId: 12 },
      ],
    );
    await waitFor(
      () =>
        execute(
          'return document.querySelectorAll(".matchup-cell .portrait").length === 25 && !!document.querySelector(".suggestion-tile")',
        ),
      'Picks and hovers exceeding ten IDs did not load',
    );
    assert.equal(fx.draftRequests, beforeLargeDraft + 2);
    assert.deepEqual(
      draftBatches.slice(-2).sort((a, b) => a[0] - b[0]),
      [
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        [11, 12],
      ],
    );
    // Warm-up: a new draft fetches every catalogue hero once in batches of ten; picks and
    // hovers covered by it then need no request of their own.
    const beforeWarmUp = fx.draftRequests;
    const catalogue = heroes.map((hero) => hero.id);
    const warmBatches = Array.from({ length: Math.ceil(catalogue.length / 10) }, (_, i) =>
      catalogue.slice(i * 10, i * 10 + 10),
    );
    await emitDraft('810004', [{ slot: 0, team: 'radiant', heroId: 11 }], undefined, [], [], [], 'ready', {
      warmUp: true,
    });
    await waitFor(
      () => Promise.resolve(fx.draftRequests - beforeWarmUp >= warmBatches.length),
      'Draft warm-up did not fetch every hero',
    );
    await waitFor(() => execute('return !!document.querySelector(".suggestion-tile")'), 'Warmed draft did not load');
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.deepEqual(draftBatches.slice(beforeWarmUp), warmBatches, 'Warm-up batches or an extra request');
    await emitDraft(
      '810004',
      [
        { slot: 0, team: 'radiant', heroId: 11 },
        { slot: 5, team: 'dire', heroId: 25 },
      ],
      undefined,
      [],
      [{ slot: 1, team: 'radiant', heroId: 31 }],
    );
    await waitFor(
      () => execute('return !!document.querySelector(`.selected-hero[data-hero-id="31"]`)'),
      'Warmed pick and hover were not shown',
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(fx.draftRequests, beforeWarmUp + warmBatches.length, 'A warmed pick or hover requested draft data');
    assert.equal(await execute('return document.querySelectorAll(".matchup-cell").length'), 25);
    await sameShape(twoHeroShape, 'Full matrix changed size');
    const identity = fullPicks.map((pick) => ({
      key: pick.slot === 6 ? 'self' : `native.${pick.slot}`,
      team: pick.team,
      heroId: pick.heroId,
      name: `Visible ${pick.slot}`,
    }));
    await emitDraft('810003', fullPicks, 'DOTA_GAMERULES_STATE_STRATEGY_TIME', [], [], [], 'ready', {
      players: identity,
    });
    await waitFor(
      () =>
        execute(
          'return document.querySelector(`.team-dire [data-team-slot="3"] .player-link`)?.textContent === "Visible 6"',
        ),
      'Strategy identity moved to a different slot',
    );
    assert.ok(
      await execute(
        'return !!document.querySelector(`.team-dire [data-team-slot="3"] .selected-hero[data-hero-id="7"]`)',
      ),
    );
    assert.ok(
      await execute(
        'return document.querySelector(`.team-radiant [data-team-slot="2"] .player-link`)?.textContent === "Visible 0"',
      ),
    );
    assert.equal(batches.length, beforeAnonymous, 'Hover created profile requests');
    assert.equal(totalBatches.length, beforeTotals, 'Hover created lifetime requests');
    await emitDraft('0', [], 'DOTA_GAMERULES_STATE_INIT');
    fx.hoverDraft = false;
    console.log(
      'Hover draft passed: debounce, changed scores, candidate eligibility, lane flags, provisional matrix, confirmation, bans and stale/disabled rejection.',
    );
  },
);
