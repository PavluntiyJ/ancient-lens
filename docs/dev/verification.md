# Verification

## Repeatable checks

Run these from the repository root. Ordinary checks require no personal API
keys, local research archive, or running Dota game.

| Command                                                                                      | Coverage                                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `npm run check`                                                                              | TypeScript and Vitest: draft, roles, histories, accounts, state merging |
| `npm run lint`                                                                               | Oxlint correctness rules and the React hooks rules                      |
| `npm run format:check`                                                                       | Frontend/script formatting                                              |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --check`                                     | Rust formatting                                                         |
| `npm run test:rust`                                                                          | Store, GSI, filters, history, service, synthetic readers, confidence    |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`             | Rust lints, warnings fail; also run for the service build               |
| `cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --bin stats-service` | Service without desktop dependencies                                    |
| `npm run build`                                                                              | Optimized native desktop executable                                     |
| `npm run test:native`                                                                        | Real platform WebView, Rust IPC, HTTP GSI, synthetic statistics         |
| `npm run docs:screenshots`                                                                   | English native screenshots with synthetic players/statistics            |

Native checks use isolated `ANCIENT_TEST_DATA` and loopback fixtures. They do not
inspect the real game process or call live STRATZ. The release check never asks GitHub in an
isolated run; the scenario gives it a fixture list through `ANCIENT_TEST_RELEASES`. The page's local storage stays inside
that directory too: `XDG_DATA_HOME` on Linux, a WebView2 data folder on Windows.

### Isolated mode

`src-tauri/src/mode.rs` reads the isolation environment once at startup. The desktop,
provider client and GSI worker share that immutable snapshot; changing the environment
later cannot enable a test command. The caller/window check still runs before dispatch.

| Area                               | Difference with `ANCIENT_TEST_DATA` set                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Storage                            | State/cache/logs use that directory; window positions are neither read nor saved. Linux's driver also sets `XDG_DATA_HOME`; Windows WebView2 uses its `webview2/` subdirectory. |
| Test commands                      | `window:test-size` and `window:test-foreground` are routed to `desktop/commands/test.rs`; both are unknown commands in normal mode.                                             |
| Browser and folders                | Links and log-folder commands return their validated destination without opening it.                                                                                            |
| Steam                              | Status reports that Steam is not checked; repair is rejected.                                                                                                                   |
| STRATZ setup                       | Connect/disconnect are rejected without accessing credentials or the user's service. Explicit loopback fixture services are still usable.                                       |
| Identity/items/history             | The provider client retains its fixture-only paths and demonstration labels.                                                                                                    |
| GSI/reader                         | GSI binds an ephemeral loopback port; enabling the reader starts the synthetic worker.                                                                                          |
| Account and recorded-match workers | No automatic real-account polling or provider completion of recorded matches. `ANCIENT_TEST_ACCOUNT_FEED` optionally supplies synthetic account observations.                   |
| Releases                           | No GitHub requests; `ANCIENT_TEST_RELEASES` optionally supplies a release-list file.                                                                                            |
| Tray and shortcuts                 | No tray or Linux portal binding. Windows keeps the existing shortcut registration for native tests.                                                                             |
| Foreground watching                | Disabled unless `ANCIENT_TEST_AUTO_HIDE=1`; tests can report synthetic foreground changes explicitly.                                                                           |
| First-run dialogs                  | Suppressed unless `ANCIENT_READER_PROMPT=1`.                                                                                                                                    |
| Windows debugging                  | `ANCIENT_WEBVIEW_DEBUG_PORT` enables debugging only in isolated mode.                                                                                                           |

The native scenarios in `scripts/native/` run on both systems through the driver in
`scripts/native-capture.mjs`: `WebKitWebDriver` on Linux (needs a desktop session), Playwright
over the WebView2 debugging protocol on Windows. Before returning the driver waits for the
initial workspace load and live-event subscription, so a synthetic draft cannot be overwritten
by the initial live snapshot or delivered before its listener exists.
Each scenario is a file of its own and starts
the app on fresh isolated data through `scripts/native/harness.mjs`, which holds the startup and
the shared helpers; `scripts/native/fixtures.mjs` holds the data folder and the fake statistics
service with the switches a scenario flips (a refused warm-up, slow or malformed draft data, a
failing or private history). The scenarios: `table`, `draft-panels`, `player-mode`, `settings`
(with window sizes), `profile`, `anonymous-draft`, `hover-draft`, `reader-player` and
`release-windows`, then `items`, the Windows `reader` and `onboarding`. A new check goes into
the scenario of its screen; one that needs another scenario's state sets that state itself.
`npm run test:native -- profile hover-draft` (or `ANCIENT_NATIVE_ONLY=profile,hover-draft`)
runs only the named ones. Both drivers give the scenario element references,
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
replacing the original failure. A failed scenario does not stop the others: the
runner reports every result and returns a failing exit status, without retrying.

To exercise diagnostics deliberately, run the same built executable with
`ANCIENT_NATIVE_DIAGNOSTIC_FAILURE=1 npm run test:native` on Linux; on Windows set
`$env:ANCIENT_NATIVE_DIAGNOSTIC_FAILURE='1'` before the command and remove it
afterwards. This throws in the `table` scenario after the synthetic match loads and must fail. Keep the
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
the smoke then dispatches the same pointer events and says so in its log.
On a private display, `ANCIENT_NATIVE_FOCUS=1` instead gives the target window the
keyboard before moving the real pointer and fails if it cannot obtain focus.
Use this only on an isolated display: it deliberately changes the active window.
On Linux the profile-close check activates the actual close button through a page
click, since WebKit's native click can wait for input completion after the window
has hidden. It waits for the WebView to become hidden, then checks from the match
window that the same profile window can be shown again; this is logged explicitly.
Windows uses the native click.

For a run that cannot be disturbed by the desktop, and does not disturb it, use the KDE guard:

```sh
npm run test:native:kde
# any command: node scripts/kde-desktop-guard.mjs run -- npm run test:native
```

It starts the command in a virtual KWin on a private session bus that activates no
services, then repairs what nested sessions are known to break on the host desktop:
KWin's window-switching shortcuts (Alt+Tab stays assigned but stops working), the
flatpak document portal (`/run/user/<uid>/doc` unmounted, flatpak apps fail with
`bwrap: Can't find source path`) and KDE portals left on the dead test bus. After a run
started some other way, `node scripts/kde-desktop-guard.mjs repair` applies the same
fixes; `check` only reports. `ANCIENT_GUARD_SCREEN=1024x768` reproduces the Windows CI
screen.

## Choosing a page test

Page behaviour has three levels of test. Pick the cheapest one that can fail for the bug.

| Level           | Use it for                                                                                                                                                      | How                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Static          | What a component shows for given props: labels, order, numbers, dashes for missing data                                                                         | `renderToStaticMarkup` and string checks; no effects run                                                                 |
| DOM             | Clicks, typing, effects, and the order of answers: a call reaches the bridge with the right arguments, a late answer for a previous account or match is ignored | `// @vitest-environment happy-dom` at the top of the file, Testing Library, and the fake bridge in `tests/dom/bridge.ts` |
| Native scenario | The real WebView, Rust IPC, windows, GSI and the files the app writes                                                                                           | `npm run test:native` with isolated data ([below](#native-coverage))                                                     |

DOM tests run in `npm run check` beside the static ones and take milliseconds. Import
`./dom/bridge` before any component: the page reads `window.ancient` when `App.tsx` loads.
Every bridge method is a mock; `deferred()` gives a promise the test settles when it wants,
so answers can arrive in any order. Call `cleanup()` and `resetBridge()` after each test.

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
- The **Item build** scenario (`scripts/item-drafts.mjs`) runs on both platforms and
  covers invented drafts, standard equipment sets, multi-enemy purchase evidence,
  offlane Pipe/Lotus choices, reranking without refetching, sparse samples, stale caches,
  unknown self and rejected late responses. It captures local screenshots in
  `test-results/native/items/`.
- Windows account smoke (`scripts/smoke-own-account-windows.mjs`) checks A→B→A,
  calibration, invalidation, late history, and current versus saved rating.

WebKit scrolls a target button into view before a normal WebDriver click to
avoid the window-resize edge. A fixture test is not proof that a participating
Dota client exposes the same fields in every game mode.

On Windows, `scripts/smoke-roster-windows.mjs` adds the memory-reader consent and the isolated
reader worker.

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

`.github/workflows/build.yml` checks formatting, frontend, Rust and the
service on GitHub-hosted Ubuntu and Windows for every code change and pull
request. After those checks, `native-build` builds the Windows application
without installers and saves both executables with their source revision and
SHA-256 checksums. A separate `native-smoke` job downloads that exact artifact,
verifies its revision and checksums, and runs the native scenarios. This happens
on pull requests and main pushes as well as release tags and manual runs.

The Windows native job uses the runner's small desktop. Its summary identifies
the commit, executable checksum and failed scenario, and links to the diagnostic
artifact. Diagnostics upload even after test failure.

`native-linux` runs the same scenarios on Linux for every pull request and main push. It builds
the application in a Fedora container and runs it on a virtual X11 screen (Xvfb, 2560×1600) with
the Openbox window manager and software rendering; GitHub's runners have no GPU, and a Wayland
compositor (a virtual KWin) stalls frame-dependent driver actions such as pointer moves and
screenshots without one. Its summary and diagnostic artifact match the Windows job. It is not
required yet (`continue-on-error`) and becomes required once it has stayed green for a couple
of weeks.

The CI display runs the X11 side of the checks that differ by session: the windows are shown
without taking the keyboard (`overlay`), hiding for other programs and the first active window
are checked, and the scenario reports `Wayland: false`. Hover checks explicitly obtain keyboard
focus on this private display (`ANCIENT_NATIVE_FOCUS=1`) and use real pointer input.
Wayland's side (portal shortcuts, focus left to the compositor) is covered only by local runs
on a Wayland desktop, such as
`npm run test:native:kde`. No check is skipped on the CI display.

To reproduce the CI job locally without a GPU, build with `npm run build` on Fedora, then run the
scenarios in the same container image:

```sh
podman run --rm -v "$PWD:/work:Z" -w /work -e GDK_BACKEND=x11 -e ANCIENT_NATIVE_FOCUS=1 registry.fedoraproject.org/fedora:45 sh -c '
  dnf install -y --setopt=install_weak_deps=False nodejs npm webkit2gtk4.1 webkitgtk6.0 \
    libappindicator-gtk3 librsvg2 libxdo xorg-x11-server-Xvfb xorg-x11-xauth openbox \
    dbus-daemon dbus-tools mesa-dri-drivers which findutils >/dev/null &&
  export XDG_RUNTIME_DIR=/tmp/xdg && mkdir -m 700 -p $XDG_RUNTIME_DIR &&
  xvfb-run -a -s "-screen 0 2560x1600x24" dbus-run-session -- sh -c "openbox & sleep 1; npm run test:native"'
```

For an investigation without compilation or packaging, choose **Run workflow**
and fill all three native recheck fields with the source run ID, build artifact
ID and full source SHA printed in the original native summary. The native-only
mode skips ordinary checks, compilation, packaging and release creation. It
downloads that artifact from the specified run and verifies its source revision
and executable checksums before running the scenarios. Test scripts come from
the workflow revision selected in **Run workflow**, so diagnostic or harness
fixes can be tested against an unchanged application. Results record application
and test-script revisions separately; choose the original workflow revision
when the scripts must also stay unchanged.
Leave all three fields empty for the ordinary full workflow; partial or invalid
recheck identities fail explicitly. The build must contain the artifact manifest
produced by this workflow.

On a pull request or main push, rerunning only `native-smoke` also reuses the
successful build dependency. On a tag or full manual run, GitHub additionally
reruns dependent packaging jobs: use the native-only mode to avoid those.
Each attempt gets a separate diagnostic artifact.
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
