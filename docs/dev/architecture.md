# Architecture

Ancient Lens is a Tauri 2 desktop app: a Rust core and a React/TypeScript page in the system
WebView (WebView2 on Windows, WebKitGTK on Linux), plus an optional statistics service that
runs as a separate process. This page maps the processes, the source tree and the boundaries
data crosses. How to check each part is in [verification](verification.md); the memory
readers have their own [maintenance guide](native-reader.md).

## Processes

```text
Dota 2 ──GSI POST──▶ 127.0.0.1:32123/gsi ─┐
   ▲                                       │
   │ read-only memory (opt-in)             ▼
   └──────────────── Rust core (src-tauri) ──events/IPC──▶ page (src/)
                       │        │
         OpenDota HTTPS│        │HTTP 127.0.0.1:8787 (optional)
                       ▼        ▼
                  OpenDota   stats-service ──HTTPS──▶ STRATZ GraphQL
```

| Process            | Binary                     | Role                                                                                |
| ------------------ | -------------------------- | ----------------------------------------------------------------------------------- |
| Desktop app        | `ancient-lens`             | Window, tray, global shortcut, GSI server, providers, local storage, memory readers |
| Page               | WebView inside the app     | All UI; talks to the core only through IPC and events                               |
| Statistics service | `stats-service` (optional) | Holds the STRATZ token and exposes a small fixed HTTP API to the app                |
| Dota 2             | the game                   | Sends Game State Integration (GSI) events; read, never written                      |

The service is separate so the STRATZ token never reaches the page, the app's state files or
its logs. It binds to `127.0.0.1:8787` by default. The app discovers it there at startup, can
start the user's installed service (a systemd user unit on Linux, a hidden child process with
a token from Windows Credential Manager on Windows), or uses `ANCIENT_STATS_URL`. See the
[statistics service guide](../guide/stats-service.md).

## Source map

### Rust core (`src-tauri/src`)

| Module                                                                  | Responsibility                                                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `desktop.rs`                                                            | Tauri setup: match and profile windows, tray, shortcuts, single instance, the `desktop_call` command  |
| `overlay.rs`                                                            | Shows the windows above the game without taking its keyboard (Windows, X11); keyboard on demand       |
| `gsi.rs`, `gsi/diagnostics.rs`                                          | GSI HTTP server: token check, normalization into the live state, optional structure-only diagnostics  |
| `roster.rs`, `roster/`                                                  | Optional roster and draft reader (see below)                                                          |
| `own_account.rs`, `own_account/`                                        | Account detection and the optional own-rating reader                                                  |
| `api.rs`                                                                | Provider requests, caching, the OpenDota rate limit, batching to the service                          |
| `stats.rs`, `history.rs`, `averages.rs`, `match_details.rs`, `draft.rs` | Shaping provider data: summaries, paged history, hero averages, one match, draft tables               |
| `journal.rs`                                                            | Records own matches from GSI at post-game into `matches.json`; completes them later from the match ID |
| `store.rs`                                                              | `state.json`: account, notes, rating journal, settings; atomic writes and migration                   |
| `steam_setup.rs`, `steam_setup/`                                        | Finds Steam and Dota, installs the GSI file and the launch option                                     |
| `local_service.rs`                                                      | Discovers or starts the statistics service                                                            |
| `releases.rs`                                                           | New-version notice: reads the GitHub release list and finds a newer published version                 |
| `broker.rs`, `bin/stats-service.rs`                                     | The statistics service: fixed routes, request budget, no client-supplied queries                      |
| `shortcut_portal.rs`                                                    | The XDG GlobalShortcuts portal on Linux/Wayland                                                       |

### Page (`src`)

| Path                                                        | Responsibility                                                                                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `bridge.ts`                                                 | `window.ancient`: typed IPC calls (`invoke('desktop_call', …)`) and event subscriptions                                             |
| `ui/App.tsx`                                                | The match window: header and pages for match and draft, manual draft and roster, notes, GSI diagnostics, settings                   |
| `ui/ProfileWindow.tsx`, `ui/WindowFrame.tsx`                | The profile window; title bar, window buttons and keyboard-on-demand shared by both windows                                         |
| `ui/settings/`                                              | The Settings page, one component per section                                                                                        |
| `ui/MatchScreen.tsx`, `ui/Roster.tsx`, `ui/DraftPanels.tsx` | Ten-player table and the analysis carousels                                                                                         |
| `ui/OwnProfile.tsx`, `ui/profile/`                          | Personal profile: header, filters, history table, side panel                                                                        |
| `shared/`                                                   | Pure logic without UI: domain types, draft maths, role guesses, statistic bands, history filters. Covered by unit tests in `tests/` |

## IPC and events

The page calls one Tauri command, `desktop_call(command, args)`. Commands are grouped by
prefix: `state:*` (settings and notes), `live:get`, `player:*`, `summary:get`, `totals:get`,
`history:get`, `averages:get`, `draft:data`, `heroes:get`, `steam:*`, `window:*`, `gsi:export`,
`release:*`. The core pushes `live:update` (GSI plus reader results), `state:update` (saved
state) and `release:update` (a newer release was found) as events. The page never receives the GSI token, provider tokens or memory addresses.

## Live state

1. Dota posts GSI to `127.0.0.1:32123/gsi`. The server rejects a wrong token, browser
   `Origin` headers and oversized bodies, and normalizes the payload (mode, match, players,
   heroes, phase).
2. With memory reading off, the normalized state is published as is. As a participant, GSI
   contains only the local player.
3. With memory reading on, a worker reads the roster and draft from the game and merges them
   into the GSI state. GSI stays the authority for the match and the local player; a read
   that does not match GSI is discarded.
4. At post-game the journal records the match from GSI (and the roster, if read).

## Storage

All local data lives in one folder: `%APPDATA%\Ancient Lens` on Windows,
`~/.config/Ancient Lens` on Linux (`ANCIENT_TEST_DATA` replaces it for tests).

| File                          | Contents                                                |
| ----------------------------- | ------------------------------------------------------- |
| `state.json`                  | Account, notes, rating journal, settings, GSI token     |
| `matches.json`                | Matches recorded from the game                          |
| `cache/`                      | Provider responses with their fetch time                |
| `gsi-draft-diagnostics.jsonl` | Only when diagnostics are enabled; structure, no values |

Writes are atomic (temporary file, then rename). A corrupt `state.json` is preserved, not
overwritten.

## Trust boundaries

- **Game:** memory is read only with consent, through a read/query-only process handle, and
  only at addresses validated against the game's own schema. Nothing is written or injected,
  and no game function is called.
- **GSI:** accepted only from loopback with the per-installation token.
- **Providers:** OpenDota is called directly at about one request per 1.1 seconds. STRATZ is
  reached only through the statistics service, which allows a fixed set of routes and an
  hourly upstream budget.
- **Page:** treated as untrusted for secrets; it gets data, not credentials.
