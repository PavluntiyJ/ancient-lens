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
inspect the real game process or call live STRATZ. The page's local storage stays inside
that directory too: `XDG_DATA_HOME` on Linux, a WebView2 data folder on Windows. Linux needs a desktop session
and `WebKitWebDriver`; Windows uses WebView2 and the Playwright CDP connection.
Build first and close competing Ancient Lens windows. The optional
`ANCIENT_NATIVE_BINARY` selects an alternate Linux executable.

Hover checks move the real WebDriver pointer. WebKitWebDriver hangs on pointer
actions while the window lacks keyboard focus (another application in front), so
the smoke then dispatches the same pointer events and says so in its log. For a
run that cannot be disturbed by the desktop, start it in a nested virtual KWin
session:

```sh
kwin_wayland --virtual --no-lockscreen --width 2560 --height 1600 --socket al-smoke \
  --exit-with-session "/bin/sh -c 'WAYLAND_DISPLAY=al-smoke npm run test:native'"
```

## Native coverage

- Ten player rows, shuffled provider responses correctly mapped by ID, two
  batches of five, lifetime/period statistics, positions, medals and site links.
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

The Windows smoke (`scripts/smoke-native-windows.mjs`, Playwright over the WebView2
debugging protocol) covers fewer areas than the Linux one; `scripts/smoke-roster-windows.mjs`
adds the memory-reader consent and the isolated reader worker.

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

`.github/workflows/build.yml` checks formatting, frontend, Rust, Python and the service on
GitHub-hosted Ubuntu and Windows for every code change and pull request. Tags and manual runs
build Linux and Windows distributions; Windows also runs the native smoke. Linux native smoke
is a local desktop check, not currently a CI job. `docs.yml` runs the public-source and link
check for documentation-only changes, and `audit.yml` audits the lockfiles weekly. Distribution artifacts expire and
are not a published release. Public pull requests must never use a personal runner.
