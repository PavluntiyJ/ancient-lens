// Memory-reading consent with the isolated worker, the own side and a reconnect in player
// mode, the lane from the own role, and shortcut conflicts and registration.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scenario, heroes, platform, token } from './harness.mjs';

await scenario(
  'reader-player',
  async ({ directory, post, waitFor, execute, call, screenshot, clickButton, emitDraft }) => {
    await clickButton('Settings');
    const readerToggle = 'document.querySelector(`input[aria-label="Allow Dota memory reading"]`)';
    await waitFor(() => execute(`return !!${readerToggle}`), 'Settings did not load');
    assert.equal(await execute(`return ${readerToggle}.checked`), false);
    await execute(`${readerToggle}.click()`);
    await waitFor(
      () => execute(`return ${readerToggle}.checked && !${readerToggle}.disabled`),
      'Reader opt-in was not saved',
    );
    assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).nativeRosterReader, 'on');
    await screenshot('reader');
    const readerPayload = {
      auth: { token },
      provider: { appid: 570 },
      map: { matchid: '987654', game_state: 'DOTA_GAMERULES_STATE_HERO_SELECTION' },
      player: { team_name: 'dire' },
      hero: { id: 0 },
    };
    await post(readerPayload);
    await waitFor(async () => (await call('getLive')).draftStatus === 'test-mode', 'Isolated worker did not start');
    await execute(`${readerToggle}.click()`);
    await waitFor(() => execute(`return !${readerToggle}.checked && !${readerToggle}.disabled`), 'Reader did not stop');
    const afterStop = await call('getLive');
    assert.equal(afterStop.rosterStatus, 'disabled');
    assert.equal(afterStop.draftStatus, undefined);
    assert.equal(afterStop.draft, undefined);
    assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).nativeRosterReader, 'off');
    await clickButton('Match and draft');
    await execute(
      'const ids=Object.getOwnPropertyNames(window.__internal_unstable_listeners_object_id__["live:update"]); window.__internal_unstable_listeners_function_id__({event:"live:update",payload:arguments[0]},ids);',
      [{ ...afterStop, draftStatus: 'permission' }],
    );
    await waitFor(
      () =>
        execute(
          'return [...document.querySelectorAll("[role=alert]")].some(node=>node.textContent.includes("The system denied access to Dota memory"))',
        ),
      'Draft permission error was hidden in hero selection',
    );
    await post({ ...readerPayload, map: { matchid: '0', game_state: 'DOTA_GAMERULES_STATE_INIT' } });
    console.log(
      'Reader opt-in passed: legacy off, UI toggle, persistence, isolated start/stop and permission message.',
    );

    // Player mode: the own side is labelled, and a reconnect keeps the match until it is reset.
    const playing = {
      auth: { token },
      provider: { appid: 570 },
      map: { matchid: 'native-player', game_state: 'DOTA_GAMERULES_STATE_GAME_IN_PROGRESS', clock_time: 300 },
      player: { steamid: String(76561197960265728n + 1n), name: 'Fixture 1', team_name: 'radiant' },
      hero: { id: 1, name: heroes[0].name },
    };
    const menu = { auth: { token }, provider: { appid: 570 } };
    const shows = (text) => execute('return document.body.innerText.includes(arguments[0])', [text]);
    const hasButton = (label) =>
      execute(
        'return [...document.querySelectorAll("button")].some(b => b.textContent.trim() === arguments[0] || b.getAttribute("aria-label") === arguments[0])',
        [label],
      );
    assert.equal((await post(playing)).status, 200);
    await waitFor(
      () => execute('return !!document.querySelector(".team-radiant .own-team-label")'),
      'Own side not labelled',
    );
    assert.equal((await post(menu)).status, 200);
    await waitFor(() => shows('Connection to match #native-player interrupted'), 'No reconnect notice');
    assert.ok(await hasButton('Fixture 1'), 'A reconnect wait cleared the match');
    await screenshot('reconnect');
    assert.equal((await post(playing)).status, 200);
    await waitFor(() => execute('return !document.querySelector(".reconnect-notice")'), 'Reconnect notice stayed');
    assert.equal((await post(menu)).status, 200);
    await waitFor(() => execute('return !!document.querySelector(".reconnect-notice")'), 'No second reconnect notice');
    await clickButton('Reset match');
    await waitFor(() => execute('return !document.querySelector(".reconnect-notice")'), 'Reset kept the notice');
    assert.equal(await hasButton('Fixture 1'), false, 'Reset kept the match');
    // The own assigned role (lane flags from the native draft) picks the lane once per match.
    const laneValue = () => execute('return document.querySelector(".lane-select")?.value');
    await emitDraft('auto-lane', [], undefined, [], [], [{ slot: 6, team: 'dire', flags: 2 }]); // position 3
    await waitFor(async () => (await laneValue()) === '2', 'The own role did not pick the Off Lane');
    await execute(
      'const select=document.querySelector(".lane-select"); select.value = "0"; select.dispatchEvent(new Event("change", {bubbles:true}));',
    );
    await emitDraft('auto-lane', [], undefined, [], [], [{ slot: 6, team: 'dire', flags: 16 }]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await laneValue(), '0', 'A later role overrode the chosen lane');
    await emitDraft('0', [], 'DOTA_GAMERULES_STATE_INIT');
    // Shortcuts: one key cannot serve two actions.
    const pressKey = (code, modifiers) =>
      execute(
        'window.dispatchEvent(new KeyboardEvent("keydown", {key: arguments[0], code: arguments[0], ...arguments[1], bubbles: true, cancelable: true}));',
        [code, modifiers],
      );
    const shortcutRow = (label) =>
      `[...document.querySelectorAll(".shortcut-row")].find(row => row.textContent.includes(${JSON.stringify(label)}))`;
    const keycaps = (label) =>
      execute(`return ${shortcutRow(label)}.querySelector(".keycaps").getAttribute("aria-label")`);
    await clickButton('Settings');
    await clickButton('Change Previous recommendation lane');
    await pressKey('ArrowDown', { altKey: true });
    await waitFor(() => shows('Already used for “Next recommendation lane”.'), 'Duplicate in-page key accepted');
    if (platform === 'windows') {
      // The two show/hide keys are registered with Windows; app:info proves the native
      // registration changed, not merely the displayed keycap. On Linux the desktop portal
      // assigns them, and the isolated session has none.
      await clickButton('Change Show or hide the match window');
      await pressKey('F10', { ctrlKey: true, altKey: true });
      await waitFor(
        async () => (await keycaps('Show or hide the match window')) === 'Ctrl + Alt + F10',
        'Key not shown',
      );
      await waitFor(async () => {
        const keys = await call('getInfo');
        return keys.shortcutKey === 'Ctrl+Alt+F10' && keys.shortcut === true;
      }, 'Match window key was not registered');
      await waitFor(() => shows('Shortcut saved and registered.'), 'No registration message');
      assert.equal((await call('getState')).shortcuts.global, 'Ctrl+Alt+F10');
      await clickButton('Change Show or hide the profile window');
      await pressKey('F10', { ctrlKey: true, altKey: true });
      await waitFor(() => shows('Already used for “Show or hide the match window”.'), 'Profile key took the match key');
      await clickButton('Change Show or hide the profile window');
      await pressKey('F11', { ctrlKey: true, altKey: true });
      await waitFor(async () => {
        const keys = await call('getInfo');
        return keys.profileShortcutKey === 'Ctrl+Alt+F11' && keys.profileShortcut === true;
      }, 'Profile window key was not registered');
      await clickButton('Reset shortcuts');
      await waitFor(async () => {
        const keys = await call('getInfo');
        return keys.shortcutKey === 'Alt+Numpad5' && keys.profileShortcutKey === 'Alt+Numpad6';
      }, 'Shortcuts were not reset');
    }
    await clickButton('Match and draft');
  },
);
