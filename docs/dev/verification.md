# Verification

## Repeatable checks

Run these from the repository root. Ordinary checks require no personal API
keys, local research archive, or running Dota game.

| Command                                                                                      | Coverage                                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run check`                                                                              | TypeScript and Vitest: draft, roles, histories, accounts, state merging |
| `npm run format:check`                                                                       | Frontend/script formatting                                              |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check`                                     | Rust formatting                                                         |
| `npm run test:rust`                                                                          | Store, GSI, filters, history, service, synthetic readers, confidence    |
| `python3 -m unittest discover -s tests/python` (`py -3` on Windows)                          | Launcher quoting and credential handling                                |
| `cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --bin stats-service` | Service without desktop dependencies                                    |
| `npm run build`                                                                              | Optimized native desktop executable                                     |
| `npm run test:native`                                                                        | Real platform WebView, Rust IPC, HTTP GSI, synthetic statistics         |
| `npm run docs:screenshots`                                                                   | English native screenshots with synthetic players/statistics            |

Native checks use isolated `ANCIENT_TEST_DATA` and loopback fixtures. They do not
inspect the real game process or call live STRATZ. The release check never asks GitHub in an
isolated run; the scenario gives it a fixture list through `ANCIENT_TEST_RELEASES`. The page's local storage stays inside
that directory too: `XDG_DATA_HOME` on Linux, a WebView2 data folder on Windows.

One scenario, `scripts/smoke-native-scenario.mjs`, runs on both systems through the driver in
`scripts/native-capture.mjs`: `WebKitWebDriver` on Linux (needs a desktop session), Playwright
over the WebView2 debugging protocol on Windows. Both give the scenario element references,
real pointer and keyboard input, and the native window size; on Windows the size comes from an
isolated-only `window:test-size` command. Build first and close competing Ancient Lens windows.
The optional `ANCIENT_NATIVE_BINARY` selects an alternate executable.

`npm run test:native` writes per-scenario results to `test-results/native/`:
`results.json`, `summary.md`, and each scenario's `scenario.log`. On failure, the
driver captures the isolated match and profile windows before cleanup, with
`failure-main.png`, `failure-profile.png`, `geometry.json`, `error.txt` and
`application.log`. Geometry records viewport, DPI, window and panel bounds; it
does not export saved state, local storage or credentials. An unavailable or
hidden renderer can prevent a screenshot; capture errors are recorded without
replacing the original failure. The runner stops on the first failed scenario
and returns a failing exit status, without retrying it.

To exercise diagnostics deliberately, run the same built executable with
`ANCIENT_NATIVE_DIAGNOSTIC_FAILURE=1 npm run test:native` on Linux; on Windows set
`$env:ANCIENT_NATIVE_DIAGNOSTIC_FAILURE='1'` before the command and remove it
afterwards. This throws after the synthetic match loads and must fail. Keep the
failure output before starting another run: the runner clears its own
`test-results/native/` directory at startup. A normal run against the same
executable should report the same executable SHA-256. Never set this flag in
ordinary CI or use personal data to test diagnostics.

Window size and maximize checks need a screen of at least 1740×1100. On a smaller screen,
such as the 1024×768 Windows CI runner, the scenario checks only the minimum window the app
computes for that screen and logs what it skipped. A Linux window is stopped at its minimum
by the window manager; Windows applies the minimum only while the user resizes, so there the
scenario sets the window to that minimum.

Hover checks move the real WebDriver pointer. WebKitWebDriver hangs on pointer
actions while the window lacks keyboard focus (another application in front), so
the smoke then dispatches the same pointer events and says so in its log. For a
run that cannot be disturbed by the desktop, start it in a nested virtual KWin
session:

```sh
kwin_wayland --virtual --no-lockscreen --width 2560 --height 1600 --socket al-smoke \
  --exit-with-session "/bin/sh -c 'WAYLAND_DISPLAY=al-smoke npm run test:native'"
```

`--width 1024 --height 768` reproduces the Windows CI screen.

## Native coverage

- Ten player rows, shuffled provider responses correctly mapped by ID, two
  batches of five, lifetime/period statistics, positions, medals and the four profile links
  in the player hover card (Dotabuff, OpenDota, STRATZ and Steam).
- Independent carousels and hero pagination, shared recommendation lane,
  automatic initial lane from the local role, no refetch on display-only changes.
- Anonymous draft, tentative hovers, bans, malformed responses, retry, and
  rejection of late responses from a previous match or changed draft.
- Reconnect retains the match until explicit reset or post-game detection.
- Scale 80–120%, windows from 980×650 to 1740×1100, stable panel geometry,
  no horizontal overflow, 90% fit floor and scrolling below it.
- Personal profile, cached/incomplete history, older-page loading, mode/Turbo
  filters, manual entries, notes, exports, and separate account journals.
- Profile filter chips and Reset (no history reload), the ten-player card of a
  statistic, every header ⓘ card, and the MMR chart by pointer and arrow keys.
- Lane summary page in the panel's own height, slot-colour frames for spectator
  keys and Linux draft slots, and settings save/restore with disabled options.
- Windows account smoke (`scripts/smoke-own-account-windows.mjs`) checks A→B→A,
  calibration, invalidation, late history, and current versus saved rating.

WebKit scrolls a target button into view before a normal WebDriver click to
avoid the window-resize edge. A fixture test is not proof that a participating
Dota client exposes the same fields in every game mode.

On Windows, `scripts/smoke-roster-windows.mjs` adds the memory-reader consent and the isolated
reader worker after the shared scenario.

## Live evidence

Checks against a running game are not repeatable by a checkout: they need a person to start
Dota and a particular game build. The [native reader guide](native-reader.md#verified-builds)
lists which reader was checked live, offline or only synthetically on which build, and its
[update procedure](native-reader.md#after-a-game-update) describes how to repeat them. Record the
platform, the game build and the data source, distinguish absent from unsupported data, and
never treat a synthetic or static check as live-game proof.

## Opt-in tests

`ANCIENT_AUDIT_DATA` enables replay of captured public responses. Captures are local and
ignored and may contain personal identifiers; without them those tests skip explicitly.
`ANCIENT_CLIENT_DLL`, `ANCIENT_ENGINE2_DLL`, `ANCIENT_DOTA_CLIENT`, `ANCIENT_DOTA_ENGINE` and
`ANCIENT_ROSTER_GSI` select installed game files or a GSI capture for the ignored Rust tests
described in the native reader guide. Do not download proprietary artifacts merely to run
ordinary tests.

## CI

`.github/workflows/build.yml` checks formatting, frontend, Rust, Python and the
service on GitHub-hosted Ubuntu and Windows for every code change and pull
request. After those checks, `native-build` builds the Windows application
without installers and saves both executables with their source revision and
SHA-256 checksums. A separate `native-smoke` job downloads that exact artifact,
verifies its revision and checksums, and runs the native scenarios. This happens
on pull requests and main pushes as well as release tags and manual runs.

The Windows native job uses the runner's small desktop. Its summary identifies
the commit, executable checksum and failed scenario, and links to the diagnostic
artifact. Diagnostics upload even after test failure. Linux uses the same
diagnostic capture and runner locally, but Linux native smoke remains a desktop
check rather than a CI job; ordinary Linux checks and distributions still run.

For a native failure, open the `native-smoke` job and choose **Re-run jobs →
Re-run failed jobs**, or rerun that job alone. Its successful build dependency is
not rebuilt. The artifact is selected by ID, so retrying the test uses the same
executables and checksums. Each attempt gets a separate diagnostic artifact.
Build and diagnostic artifacts expire after seven days; missing/expired builds
fail explicitly and require a new build, never a silent fallback to a different
executable. Rerunning all jobs rebuilds the application and does not provide the
same-build comparison.

Tags and manual runs package Linux and Windows only after the native gate
passes. Windows downloads the verified application and runs `tauri bundle`
without recompiling it. The Linux distribution path is unchanged. Artifacts are
not a published release; a tag can create only a draft prerelease, after all
gates pass. Public pull requests must never use a personal runner. `docs.yml`
checks documentation-only pushes, and `audit.yml` audits lockfiles weekly.
