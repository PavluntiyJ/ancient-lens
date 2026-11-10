// The new-version notice, saved notes and MMR after a migration, and both windows: keys,
// returning to the draft screen, hiding for other programs and closing the profile window.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { scenario, platform, token } from './harness.mjs';

await scenario(
  'release-windows',
  async ({ app, info, directory, releasesPath, waitFor, execute, useWindow, call, screenshot, clickButton }) => {
    // New-version notice from the fixture release list. The missing list at start stayed
    // silent, as an offline check does.
    const releaseNotice = () => execute('return document.querySelector(".release-notice")?.textContent ?? null');
    assert.equal(await releaseNotice(), null);
    const [major, minor, patch] = info.version.split('.').map(Number);
    const nextVersion = `${major}.${minor}.${patch + 1}`;
    const laterVersion = `${major}.${minor + 1}.0`;
    const publish = (version) =>
      writeFile(
        releasesPath,
        JSON.stringify([
          { tag_name: 'v99.0.0', draft: true, prerelease: false },
          { tag_name: `v${version}`, draft: false, prerelease: true, published_at: new Date().toISOString() },
          { tag_name: `v${info.version}`, draft: false, prerelease: true },
          { tag_name: 'nightly', draft: false, prerelease: true },
        ]),
      );
    // Turning the check off and on again in Settings runs it at once.
    const checkReleases = async () => {
      await clickButton('Settings');
      await clickButton('Updates');
      for (const on of [false, true]) {
        await execute('document.querySelector("#settings-updates input[type=checkbox]").click()');
        await waitFor(async () => (await call('getState')).updateCheck === on, `Update check did not turn ${on}`);
      }
      await clickButton('Match and draft');
    };
    await publish(nextVersion);
    await checkReleases();
    await waitFor(
      async () => (await releaseNotice())?.includes(`Ancient Lens ${nextVersion} (prerelease) is out`),
      'New-version notice did not appear',
    );
    assert.ok((await releaseNotice()).includes(`you have ${info.version}`));
    await screenshot('release-notice');
    const releaseUrl = `https://github.com/PavluntiyJ/ancient-lens/releases/tag/v${nextVersion}`;
    assert.equal((await call('getRelease')).latest.url, releaseUrl);
    // Isolated runs return the release page instead of opening a browser.
    assert.equal(await call('openRelease'), releaseUrl);
    await clickButton("What's new", '.release-notice button');
    await clickButton('Skip this version', '.release-notice button');
    await waitFor(async () => (await releaseNotice()) === null, 'Skip this version did not hide the notice');
    assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).skippedVersion, nextVersion);
    // A newer release is announced again; Later hides it for this session only.
    await publish(laterVersion);
    await checkReleases();
    await waitFor(
      async () => (await releaseNotice())?.includes(`Ancient Lens ${laterVersion}`),
      'Notice for a newer release did not appear',
    );
    await clickButton('Later', '.release-notice button');
    await waitFor(async () => (await releaseNotice()) === null, 'Later did not hide the notice');
    assert.equal((await call('getState')).skippedVersion, nextVersion);
    assert.equal((await call('getRelease')).latest.version, laterVersion);
    await call('addMmr', 5000);
    await call('addNote', { accountId: '2', name: 'Second', text: 'Native IPC persistence' });
    await call('addNote', { accountId: '2', name: '', text: 'A second note on top' });
    const saved = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
    assert.equal(saved.token, token);
    assert.equal(saved.mmr.at(-1).value, 5000);
    assert.equal(saved.notes.length, 2);
    // A note of an older version became the first note of its player; a new one goes on top.
    assert.deepEqual(
      saved.notes.map((note) => note.entries.map((entry) => entry.text)),
      [['A second note on top', 'Native IPC persistence'], ['Keep this note']],
    );
    assert.equal(saved.notes[0].name, 'Second');
    assert.equal(
      JSON.parse(await readFile(join(directory, 'state.pre-tauri.json'), 'utf8')).notes[0].text,
      'Keep this note',
    );
    // Each key toggles its own window; no further window is created. On Wayland whether the
    // first press hides or raises depends on focus under the driver, so two presses end visible.
    for (const name of ['main', 'profile']) {
      const first = await call('toggleWindow', name);
      if (!first) assert.equal(await call('toggleWindow', name), true);
    }
    assert.equal(await app.windowCount(), 2);
    // The match window comes back on the draft screen, not the page that was open last.
    await useWindow('main');
    await clickButton('Notes');
    const currentPage = async () =>
      await execute(
        'return document.querySelector(\'nav[aria-label=Sections] [aria-current="page"]\')?.getAttribute("aria-label")',
      );
    await waitFor(async () => (await currentPage()) === 'Notes', 'Notes did not open');
    assert.equal(await call('showWindow', 'main'), true);
    await waitFor(
      async () => (await currentPage()) === 'Match and draft',
      'The match window did not return to the draft screen',
    );
    // The hotkey does the same after hiding: it comes up on the draft screen.
    await clickButton('Notes');
    await waitFor(async () => (await currentPage()) === 'Notes', 'Notes did not open again');
    if (!(await call('toggleWindow', 'main')))
      assert.equal(await call('toggleWindow', 'main'), true, 'The match key did not show the window');
    await waitFor(
      async () => (await currentPage()) === 'Match and draft',
      'The match key did not return to the draft screen',
    );
    // Both hidden at once; each comes back on its own, and the header icon shows the profile.
    // On Wayland a press may raise instead of hide, depending on focus, so only the end
    // state above is checked there.
    if (!info.wayland) {
      // Activating another program hides both windows; the game and the app's own windows keep
      // them up. Isolated runs do not watch the active window, so the activation is reported
      // here, through the same code as the system's notification.
      const report = (args) =>
        execute(
          'return window.__TAURI_INTERNALS__.invoke("desktop_call", {command: "window:test-foreground", args: arguments[0]})',
          [args],
        );
      const activate = async (args) => (await report(args)).hidden;
      const game =
        platform === 'windows'
          ? 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game\\bin\\win64\\dota2.exe'
          : '/home/user/.steam/steam/steamapps/common/dota 2 beta/game/bin/linuxsteamrt64/dota2';
      assert.equal(await activate({ exe: game }), false, 'Clicking the game hid the windows');
      assert.equal(await activate({ own: true }), false, 'Clicking an Ancient Lens window hid the windows');
      const browser = platform === 'windows' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : '/usr/bin/firefox';
      assert.equal(await activate({ exe: browser }), true, 'Another program did not hide the windows');
      // Minimized to the taskbar, not hidden, so a click on its button brings a window back.
      // Only Windows is asked: a Linux window manager need not report an iconified window.
      if (platform === 'windows')
        assert.deepEqual(
          (await report({ exe: browser })).minimized,
          [true, true],
          'The windows hid instead of minimizing',
        );
      // Both are hidden: each key brings its own window back.
      assert.equal(await call('toggleWindow', 'main'), true, 'Match window stayed up for another program');
      assert.equal(await call('toggleWindow', 'profile'), true, 'Profile window stayed up for another program');
      // A program whose name cannot be read hides them too; the tray's Show brings one back.
      assert.equal(await activate({}), true, 'An unnamed program did not hide the windows');
      assert.equal(await call('showWindow', 'profile'), true);
      assert.equal(await call('toggleWindow', 'main'), true, 'Match window stayed up for an unnamed program');
      // Turned off, nothing hides them.
      assert.equal((await call('setAutoHide', false)).autoHide, false);
      assert.equal(await activate({ exe: browser }), false, 'The windows hid with the setting off');
      assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).autoHide, false);
      assert.equal((await call('setAutoHide', true)).autoHide, true);
      // The window keys are released over other programs, so the key reaches them, and come back
      // over the game and over these windows, whether or not the game runs. A released key is
      // still bound for Settings.
      if (info.keysOverGame) {
        await call('setAutoHide', false);
        const keys = async (args) => (await report(args)).keys;
        assert.equal(await keys({ exe: browser }), false, 'Keys kept listening over a browser');
        const released = await call('getInfo');
        assert.deepEqual(
          [released.keysListening, released.shortcut, released.profileShortcut],
          [false, true, true],
          'A released key must not look taken by another application',
        );
        assert.equal(await keys({ own: true }), true, 'Keys stayed released over Ancient Lens');
        assert.equal(await keys({ exe: browser }), false);
        assert.equal(await keys({ exe: game }), true, 'Keys stayed released over the game');
        // Turning the setting off brings released keys back at once.
        assert.equal(await keys({ exe: browser }), false);
        assert.equal((await call('setKeysOverGame', false)).keysOverGame, false);
        await waitFor(async () => (await call('getInfo')).keysListening === true, 'Keys stayed released');
        assert.equal(await keys({ exe: browser }), true, 'Keys were released with the setting off');
        assert.equal(JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).keysOverGame, false);
        assert.equal((await call('setKeysOverGame', true)).keysOverGame, true);
        const back = await call('getInfo');
        assert.deepEqual([back.keysListening, back.shortcut, back.profileShortcut], [true, true, true]);
        await call('setAutoHide', true);
        // The window already active when watching starts sets the keys but minimizes nothing:
        // the windows have just been shown.
        const start = await report({ exe: browser, initial: true });
        assert.deepEqual([start.keys, start.hidden], [false, false], 'The first active window was handled as a switch');
        assert.equal(await keys({ own: true }), true);
      }
      assert.equal(await call('toggleWindow', 'profile'), false, 'Profile key did not hide the profile window');
      assert.equal(await call('toggleWindow', 'main'), false, 'Match key did not hide the match window');
      assert.equal(await call('toggleWindow', 'main'), true, 'Match key did not show the match window');
      await clickButton('My profile');
      assert.equal(await call('toggleWindow', 'profile'), false, 'The header icon did not show the profile window');
      assert.equal(await call('toggleWindow', 'profile'), true, 'Profile key did not show the profile window again');
    }
    // Closing the profile window hides it; the match window and the app keep running.
    await useWindow('profile');
    if (platform === 'linux') {
      // WebKit's native click can wait forever for input completion after its own window
      // unmaps. Activate the same button from the page, then verify its effect from main.
      console.log('Close profile: page click avoids waiting for native input on a hidden WebKit window.');
      await execute('document.querySelector(arguments[0]).click()', ['button[aria-label="Close window"]']);
      await waitFor(
        () => execute('return document.visibilityState === "hidden"'),
        'Close did not hide the profile WebView',
      );
    } else await clickButton('Close window');
    await useWindow('main');
    assert.equal(await call('toggleWindow', 'profile'), true, 'Close did not hide the profile window');
    assert.equal(await app.windowCount(), 2, 'Closing the profile window destroyed it');
    // X11 shows the windows without taking the keyboard; Wayland decides by itself.
    if (!info.wayland) assert.equal((await call('getInfo')).overlay, true);
    assert.equal((await call('getInfo')).gsiPort, info.gsiPort);
    assert.deepEqual(await execute('return window.smokeErrors'), []);
  },
);
