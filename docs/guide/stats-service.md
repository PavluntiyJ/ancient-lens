# Local statistics service

OpenDota works without registration, subject to its availability and rate limits.
STRATZ powers position recommendations, the live matchup matrix, meta/counter
picks, and faster player-history requests. **No shared public STRATZ service or
API token is included:** you connect your own token, and a small service on your
computer uses it.

## Connect STRATZ in the app

1. Use the optional **Connect STRATZ** prompt after the first-run memory-reader
   question, open **Settings → Connections → STRATZ** (the **Connect STRATZ**
   section), or press **Connect STRATZ** in an empty draft panel of the match screen.
2. Press **Open stratz.com/api**, sign in with Steam and copy your token from
   **My Tokens**. Check the current permissions and quota there.
3. Paste the token into the field and press **Connect**.

The startup offer appears after either reader choice. **Not now** or closing it
remembers the dismissal; Settings remains available later. STRATZ loads players in
batches of up to five and adds IMP, positions, matchups and pick recommendations.
It works with memory reading on or off. Without it, public history still loads
from OpenDota within its rate limits; notes and recorded matches remain available.

The website button opens your system browser, including from a Linux AppImage.
If the launcher reports an error, the form shows it and a selectable
`https://stratz.com/api` address to copy into your browser manually.

Ancient Lens then checks the token with one STRATZ request for a public reference
profile (not your account), saves it in the system secret store and starts the
statistics service with it. Windows uses Credential Manager under the target
`Ancient Lens/STRATZ`; Linux uses the Secret Service (`secret-tool`, attributes
`application org.ancientlens service stratz`). It is the same entry the Python
launcher below uses, so both find each other's token. Afterwards the app starts the
service at every launch and stops it when it quits. **Disconnect STRATZ** in
Settings deletes the saved token and stops the service the app started.

Connect reports a rejected token, a locked or missing keyring, a missing service
binary and a service that does not start; a rejected or unchecked token is never
saved. A service started outside the app (for example by the launcher below) keeps
its own token until you restart it.

The service ships beside the app: `stats-service.exe` next to `Ancient Lens.exe`
in the Windows installer and portable ZIP, `stats-service` next to `ancient-lens` in
`usr/bin` of the `.deb` and AppImage, and in `src-tauri/target/release/` of a source
build. The release build checks that every package contains it. On Linux the
Connect flow (keyring save and service start) has not been tried on a desktop yet.

On Linux an installed `ancient-lens-stats` user unit
([Fedora guide](fedora.md#personal-stratz-service)) is restarted after Connect and
reads the new token from the keyring itself.

**What the window sees.** With Connect, the token passes through the app window
once: you paste it into a password field, the Connect call hands it to the Rust
side, and the field is cleared at once. The page keeps no copy; the token is not
stored in app state, settings, exports or logs and is never shown again. This is a
deliberate trade-off so that release users need no source tree or terminal: while
you paste, the token is in the webview's memory like any typed password. If you
want the token never to enter the window, save it with the launcher below instead.

## Run the service yourself (Linux or Windows)

This is the path for source builds, other addresses and a token that never enters
the window.

1. Obtain your own token from [STRATZ My Tokens](https://stratz.com/api). Do not
   put it in source files, screenshots, issue reports or shell commands.
2. Install Python 3 if you want to use the hidden-input launcher below.
3. Build the service without Tauri/GTK/WebView dependencies:

```sh
cargo build --release --locked --manifest-path src-tauri/Cargo.toml --no-default-features --bin stats-service
```

4. Save the token once. The launcher validates it against a known public
   reference profile (not your account) and stores it in the platform secret
   store:

```sh
py -3 scripts/start-personal-stratz.py --configure
```

On Linux the token goes to the Secret Service. On Windows it goes to Windows
Credential Manager under the target `Ancient Lens/STRATZ`; no plaintext file is
written. `--session-only` skips saving and starts the service for this terminal
only.

5. Start the service. On Linux, run the launcher directly (or install the Fedora
   user service); on Windows, just start Ancient Lens. The launcher keeps
   ownership of the Windows child and forwards Ctrl+C, so the terminal prompt
   returns when the service stops:

```sh
py -3 scripts/start-personal-stratz.py --saved-token
```

Ancient Lens finds a compatible service already listening at
`127.0.0.1:8787` on either platform. If no service is running, a Linux user unit is
started when installed. Otherwise, when a saved token exists and `stats-service`
sits beside the app (or at the path in `ANCIENT_STATS_SERVICE`), the app starts it
as a hidden child and stops it when the app quits. The token travels only in the
child's environment, never in a command line, application state or logs. Without
the binary beside the app nothing is started and the keyring is not opened;
discovery of an already running service still works.

For a service at another address (here a service bound with
`ANCIENT_SERVICE_BIND=127.0.0.1:8788`), launch it from a separate terminal with
the service URL.

Linux:

```sh
ANCIENT_STATS_URL=http://127.0.0.1:8788 ./src-tauri/target/release/ancient-lens
```

Windows PowerShell:

```powershell
$env:ANCIENT_STATS_URL = 'http://127.0.0.1:8788'
.\src-tauri\target\release\ancient-lens.exe
```

For a development build, use `npm run dev` in that terminal instead. Settings
should show **STRATZ connection** under **Connections → STRATZ**. A successful `/health` response confirms
the service is running, not that upstream access is valid. Loading player data
checks that access.

Discovery runs once when the app starts, so start the service first or restart
the app afterwards. An explicitly empty `ANCIENT_STATS_URL` disables discovery.
On Linux, an installed but stopped user service is also started. To save a token
securely and install a Fedora menu shortcut, see
[the Fedora guide](fedora.md#personal-stratz-service).

## Limits and failure handling

The service binds to `127.0.0.1:8787` by default. Do not expose this personal
service on a public interface. `ANCIENT_SERVICE_BIND` changes the bind address;
`ANCIENT_UPSTREAM_HOURLY_BUDGET` limits upstream requests (default 60/hour).
The personal launcher uses these conservative defaults.

Player requests are batched in groups of at most five, with two concurrent
upstream requests. The server limits request bodies to 4 KiB, upstream responses
to 4 MiB, and client requests to 30/IP/minute. It caches raw public profiles in
memory for 120 seconds. Client summaries are cached for five minutes. A saved
match history is reused for ten minutes (the profile's Refresh asks at once),
and hero averages for a week. On an
outage, saved data is explicitly marked stale; a STRATZ row is not silently
replaced with OpenDota data. Errors do not reveal upstream bodies or tokens.

If port 8787 is already occupied, reuse the existing service or stop it first.
If the token is rejected, replace it through My Tokens and connect again in
Settings (or run `--configure` again). If a quota is exhausted, wait; restarting does not increase your upstream
quota. `py -3 scripts/start-personal-stratz.py --forget` (or
`python3 scripts/start-personal-stratz.py --forget`) removes the saved token.

## Shared deployment (advanced)

A personal test token is not permission to run a public shared service. Confirm
application access and quotas with STRATZ before deploying for multiple users.
The [token-types discussion](https://github.com/STRATZ-Esports/knowledge-base/issues/37)
is historical background, not a current access grant.

Put the service behind an HTTPS reverse proxy with authentication and external
rate limiting. Supply `STRATZ_API_TOKEN` using the host's secret manager/process
environment. The desktop app accepts `ANCIENT_STATS_URL` at runtime; a build-time
value can embed the service URL, never its token. Restarting clears in-memory
budgets, so multiple instances require a shared external limit. The service does
not trust `X-Forwarded-For`: clients behind a proxy share its local IP limit.
Proxy configuration and public hosting are not included in this repository.

## Protocol v1

`GET /health` reports readiness and protocol version. Fixed endpoints are
`POST /v1/summaries`, `/v1/totals`, `/v1/history` (25-match pages with all ten
players of each match), `/v1/draft`, and `/v1/match` (one match by ID, used to
complete matches recorded by the match journal). The desktop app and the service
are built from the same source: after updating, restart the service as well, or
new fields such as match lineups stay empty.
Example summary request (synthetic IDs; replace with public accounts you intend
to inspect):

```json
{ "ids": ["1", "2"], "days": 14, "filter": { "mode": "normal", "rankedOnly": false } }
```

The server validates IDs, periods, and supported modes. Arbitrary GraphQL,
client tokens, and arbitrary upstream URLs are not accepted. Clients associate
responses by ID, not by array order.

## Verification

`npm run test:rust` exercises a local fake GraphQL server: server-only token
handling, reordered responses, caching, budgets, and rejected requests, plus the
Connect check (accepted, rejected, rate-limited and malformed tokens). Two Windows
tests that write synthetic entries to Credential Manager are opt-in
(`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored`); the full Connect
test needs `stats-service.exe` in `target/release` and no saved personal token.
`npm run test:native` checks the actual desktop UI/IPC with synthetic data.
Neither proves live STRATZ coverage. To compare with another source,
use identical accounts, filters, periods, and capture times, and compare match
IDs before aggregates. OpenDota history is not a substitute for missing STRATZ history.
