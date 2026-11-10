// Player-mode GSI with only the own player: the partial roster at every scale and lane, the
// memory-reading notice and its way into Settings, and recovery to the full spectator roster.
import assert from 'node:assert/strict';
import { scenario, heroes } from './harness.mjs';

await scenario(
  'player-mode',
  async ({
    payload,
    post,
    waitFor,
    execute,
    screenshot,
    setScale,
    clickButton,
    matchFits,
    assertPanelContentsFit,
    loadSpectatorMatch,
  }) => {
    await loadSpectatorMatch();
    // Player-mode GSI supplies only self: unavailable rows must not look like pending API calls.
    const selfPayload = {
      ...payload,
      player: { steamid: String(76561197960265729n), name: 'Fixture 1', team_name: 'dire' },
      hero: { id: 1, name: heroes[0].name },
    };
    assert.equal((await post(selfPayload)).status, 200);
    await waitFor(
      () =>
        execute(
          'return document.body.innerText.includes("Players available: 1/10") && document.querySelector(".draft-scope")?.textContent.includes("1/10")',
        ),
      'Player-mode coverage was not shown',
    );
    await waitFor(
      () => execute('return document.querySelectorAll(".suggestion-tile").length === 12'),
      'Partial draft recommendations missing',
    );
    await assertPanelContentsFit();
    for (const scale of [80, 90, 100, 110, 120]) {
      await setScale(scale);
      for (const lane of [0, 1, 2, 3]) {
        await post(selfPayload);
        await execute(
          'const select=document.querySelector(`select[aria-label="Recommendation lane"]`); select.value=String(arguments[0]); select.dispatchEvent(new Event("change", {bubbles:true}));',
          [lane],
        );
        await new Promise((resolve) => setTimeout(resolve, 150));
        await waitFor(matchFits, 'Partial draft does not fit');
        await assertPanelContentsFit();
      }
    }
    await setScale(100);
    await execute(
      'const select=document.querySelector(`select[aria-label="Recommendation lane"]`); select.value="0"; select.dispatchEvent(new Event("change", {bubbles:true}));',
    );
    assert.equal(await execute('return document.querySelectorAll("tr.unavailable").length'), 9);
    assert.deepEqual(
      await execute(
        'return [...document.querySelectorAll(`[aria-label="Left panel: panels"] button`)].map(b=>b.getAttribute("aria-label"))',
      ),
      [
        'Left panel: Hero matchups',
        'Left panel: Lanes',
        'Left panel: Picks for your team',
        'Left panel: Picks for Radiant',
        'Left panel: Meta',
        'Left panel: Counter picks against Radiant',
      ],
      'Own side should come first and a player should only get counters to the enemy',
    );
    assert.equal(
      await execute(
        'return [...document.querySelectorAll("tr.unavailable .all-time")].every(cell => cell.textContent === "—")',
      ),
      true,
    );
    assert.equal(
      await execute(
        'return [...document.querySelectorAll("tr.unavailable")].every(row => row.textContent.includes("Not provided by the game") && !row.textContent.includes("Waiting for player"))',
      ),
      true,
    );
    assert.equal(await execute('return document.querySelectorAll("tr.unavailable .rank-medal").length'), 0);
    await waitFor(() => execute('return !!document.querySelector(".reader-notice")'), 'Disabled reader banner missing');
    await execute('document.querySelector(".reader-notice summary").click()');
    const riskText = await execute('return document.querySelector(".reader-notice p").textContent');
    assert.ok(riskText.includes('The anti-cheat response is unknown'));
    await clickButton('Enable in Settings');
    await waitFor(
      () => execute('return !!document.querySelector(".reader-settings")'),
      'Banner did not navigate to settings',
    );
    assert.equal(await execute('return document.querySelector(".reader-settings .muted").textContent'), riskText);
    assert.equal(
      await execute('return document.querySelector(".reader-settings input").checked'),
      false,
      'Banner enabled reading without consent',
    );
    await clickButton('Match and draft');
    await waitFor(
      () => execute('return document.querySelector("nav button.active")?.textContent === "Match and draft"'),
      'Match did not reopen after reader settings',
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    await screenshot('player');
    assert.equal((await post(payload)).status, 200);
    await waitFor(
      () =>
        execute(
          'return document.querySelectorAll("tr.unavailable").length === 0 && !document.querySelector(".draft-scope")',
        ),
      'Full spectator roster did not recover',
    );
    await waitFor(
      () =>
        execute('return !!document.querySelector(".suggestion-tile") && !document.querySelector(".carousel-loading")'),
      'Debounced spectator draft did not settle before settings checks',
    );
    assert.equal(
      await execute('return !!document.querySelector(".reader-notice")'),
      false,
      'Spectator saw reader banner',
    );
  },
);
