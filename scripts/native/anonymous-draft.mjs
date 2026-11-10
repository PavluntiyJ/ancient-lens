// A native anonymous draft: picks without identities, slot colours, missing-hero requests,
// malformed and neutral replies, bans, removal and late replies from a previous match.
import assert from 'node:assert/strict';
import { scenario } from './harness.mjs';

await scenario('anonymous-draft', async ({ fx, waitFor, execute, clickButton, emitDraft, matrixShape, sameShape }) => {
  const { batches, totalBatches, draftBatches, refusedDrafts, pendingDrafts } = fx;
  await clickButton('Match and draft');
  const beforeAnonymous = batches.length;
  const beforeTotals = totalBatches.length;
  const beforeDraft = fx.draftRequests;
  const picks = [
    { slot: 0, team: 'radiant', heroId: 11 },
    { slot: 5, team: 'dire', heroId: 12 },
  ];
  await emitDraft('800001', picks, undefined, [], [], [], 'ready', {
    players: [{ key: 'self', team: 'dire', accountId: '42', name: 'Hidden self' }],
  });
  await waitFor(
    () =>
      execute(
        'return document.querySelectorAll(".suggestion-tile").length > 0 && document.querySelectorAll(".matchup-cell").length === 25 && document.querySelectorAll(".matchup-cell .portrait").length === 1',
      ),
    'Anonymous picks did not load recommendations/matchups',
  );
  assert.equal(await execute('return document.querySelectorAll(".match-table .player-sites a").length'), 0);
  // Linux draft slots give the colour of each row's player ID; rows without a slot get none.
  assert.ok(
    await execute(
      'const colours=["#3375ff","#66ffbf","#bf00bf","#f3f00b","#ff6b00","#fe86c2","#a1b447","#65d9f7","#008321","#a46900"]; const rows=[...document.querySelectorAll(".match-table tbody tr[data-team-slot]")]; return rows.length === 10 && rows.every(r => { const a=r.querySelector(".player-avatar"); const slot=r.dataset.slot; return slot === undefined ? !a.classList.contains("slot-frame") : getComputedStyle(a).getPropertyValue("--slot-colour").trim() === colours[Number(slot)]; })',
    ),
    `Slot colours do not follow the Linux draft slots: ${JSON.stringify(
      await execute(
        'return [...document.querySelectorAll(".match-table tbody tr[data-team-slot]")].map(r => [r.dataset.slot, r.querySelector(".player-avatar")?.className, r.querySelector(".player-avatar") && getComputedStyle(r.querySelector(".player-avatar")).getPropertyValue("--slot-colour")])',
      ),
    )}`,
  );
  assert.equal(await execute('return document.querySelectorAll(".anonymous-draft-row").length'), 10);
  assert.equal(
    await execute(
      'return document.querySelectorAll(".match-table .win-rate, .match-table .player-link, .match-table .rank-medal").length',
    ),
    0,
  );
  assert.equal(
    await execute('return document.querySelector(".match-table").textContent.includes("Hidden self")'),
    false,
  );
  assert.ok(
    await execute(
      'return !!document.querySelector(`.team-radiant [data-team-slot="2"] .selected-hero[data-hero-id="11"]`)',
    ),
  );
  assert.equal(
    await execute('return document.querySelector(`.team-dire [data-team-slot="3"] .player-name`).textContent'),
    'You',
  );
  assert.equal(
    await execute(
      'return !!document.querySelector(".draft-intentions") || document.body.innerText.includes("Player intentions")',
    ),
    false,
  );
  const twoHeroShape = await matrixShape();
  assert.equal(fx.draftRequests, beforeDraft + 1);
  assert.equal(refusedDrafts.length, 1, 'The warm-up of the first draft match was not attempted');
  assert.deepEqual(draftBatches.at(-1), [11, 12]);
  fx.delayDraft = true;
  picks[1].heroId = 13;
  await emitDraft('800001', picks);
  await waitFor(
    // Only the hero this match has not asked for yet is requested.
    () => Promise.resolve(pendingDrafts.length === 1 && draftBatches.at(-1)?.join(',') === '13'),
    'Changed pick did not reach draft provider',
  );
  // While the new hero loads, the panels keep the match's data instead of a loading state.
  assert.ok(
    await execute('return document.querySelectorAll(".suggestion-tile").length > 0'),
    'Panels dropped the match data while a new hero loaded',
  );
  fx.malformedDraft = true;
  fx.delayDraft = false;
  pendingDrafts.splice(0).forEach((resolve) => resolve());
  await waitFor(
    () => execute('return document.querySelector(".draft-carousel [role=alert]")?.textContent.includes("draft data")'),
    'Malformed service response was not rejected',
  );
  assert.equal(
    await execute('return document.querySelectorAll(".suggestion-tile, .matchup-cell .portrait").length'),
    0,
    'Failed replacement kept old recommendations',
  );
  fx.malformedDraft = false;
  fx.neutralDraft = true;
  // Retry the same current picks through the existing refresh control.
  await clickButton('Refresh match statistics');
  await waitFor(
    () => execute('return document.querySelectorAll(".suggestion-tile").length > 0'),
    'Changed pick did not produce recommendations',
  );
  assert.deepEqual(draftBatches.at(-1), [13], 'Refresh retried more than the failed hero');
  // Two heroes not asked for yet both come back neutral: a small advantage keeps its winner.
  picks[0].heroId = 16;
  picks[1].heroId = 17;
  await emitDraft('800001', picks);
  await waitFor(
    () =>
      execute(
        'return [...document.querySelectorAll(".matchup-cell")].some(el=>el.querySelector(".portrait") && el.getAttribute("aria-label").includes("Radiant +0.4"))',
      ),
    'A small known advantage still shows its winner',
  );
  assert.deepEqual(draftBatches.at(-1), [16, 17]);
  assert.ok(
    await execute(
      'return [...document.querySelectorAll(".matchup-average")].every(node=>/^(—|0|[+−][0-9]+(\\.[0-9])?)$/.test(node.textContent))',
    ),
    'Axis totals are signed numbers without a unit',
  );
  fx.neutralDraft = false;
  // Native bans: no strip of their own; excluded from suggestions, struck through in meta, no refetch.
  const bannedCandidate = await execute('return Number(document.querySelector(".suggestion-tile")?.dataset.heroId)');
  const banRequests = fx.draftRequests;
  await emitDraft('800001', picks, undefined, [bannedCandidate]);
  await waitFor(
    () =>
      execute(
        'return !document.querySelector(".draft-bans") && !document.querySelector(`.suggestion-tile[data-hero-id="${arguments[0]}"]`)',
        [bannedCandidate],
      ),
    'Native ban was not shown or still suggested',
  );
  assert.equal(fx.draftRequests, banRequests, 'Bans must not refetch draft statistics');
  await emitDraft('800001', picks);
  await waitFor(
    () =>
      execute('return !!document.querySelector(`.suggestion-tile[data-hero-id="${arguments[0]}"]`)', [bannedCandidate]),
    'Removed ban stayed applied',
  );
  const repeatedDraft = fx.draftRequests;
  await emitDraft('800001', picks);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(fx.draftRequests, repeatedDraft, 'Same picks refetched draft statistics');
  await emitDraft('800001', []);
  await waitFor(
    () =>
      execute(
        'return !document.querySelector(".suggestion-tile") && !document.querySelector(".matchup-cell .portrait") && document.querySelectorAll(".matchup-cell").length === 25',
      ),
    'Removed picks remained in UI',
  );
  await sameShape(twoHeroShape, 'Empty matrix changed size');
  await clickButton('Right panel: Meta');
  await waitFor(
    () => execute('return document.querySelectorAll(".meta-tile").length > 0'),
    'Meta must load before any pick or hover',
  );
  // Positions stay in the match's draft store, so clearing the picks needs no request.
  const emptyDraftCalls = fx.draftRequests;
  await emitDraft('800001', []);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(fx.draftRequests, emptyDraftCalls, 'Empty draft refetched on the same event');
  await clickButton('Right panel: Picks for Radiant');
  fx.delayDraft = true;
  await emitDraft('800001', [
    { slot: 0, team: 'radiant', heroId: 14 },
    { slot: 5, team: 'dire', heroId: 15 },
  ]);
  await waitFor(() => Promise.resolve(pendingDrafts.length === 1), 'Delayed draft request did not start');
  await emitDraft('800002', []);
  fx.delayDraft = false;
  pendingDrafts.splice(0).forEach((resolve) => resolve());
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(
    await execute('return document.querySelectorAll(".suggestion-tile, .matchup-cell .portrait").length'),
    0,
    'Old match response revived draft',
  );
  // A new match without picks asks for positions alone (an empty request).
  assert.deepEqual(draftBatches.at(-1), [], 'Empty draft never requested positions');
  await emitDraft('0', [], 'DOTA_GAMERULES_STATE_INIT');
  assert.equal(batches.length, beforeAnonymous, 'Anonymous picks triggered profile requests');
  assert.equal(totalBatches.length, beforeTotals, 'Anonymous picks triggered lifetime requests');
  console.log(
    'Anonymous draft passed: picks/swap/removal, no profile requests, deduplication and late-match response rejection.',
  );
});
