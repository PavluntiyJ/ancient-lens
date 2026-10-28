# Ancient Lens

An independent, open-source Dota 2 companion for **Windows and Linux**: draft
recommendations, a ten-player match table, player notes, and a personal profile
with an MMR journal. No ads, telemetry, or required Ancient Lens account.
Built with Tauri, Rust, and React. Licensed under MIT.

> **Early prototype · 0.5.0.** Platform features differ. There is no hosted STRATZ
> service or published binary release yet; build from source using the instructions
> below. Ancient Lens is not affiliated with Valve.

![Match screen with ten players, hero matchups, and suggested picks](docs/images/match-screen.png)

Screenshots use invented players and demonstration statistics. Hero portraits
are Valve assets. Regenerate them on Linux or Windows with
`npm run build && npm run docs:screenshots`.

## What works on each platform

| Feature                                                    | Windows                                                  | Linux                   |
| ---------------------------------------------------------- | -------------------------------------------------------- | ----------------------- |
| Public profiles, notes, manual draft, manual MMR journal   | Yes                                                      | Yes                     |
| Spectator roster and picks through Dota GSI                | Yes                                                      | Yes                     |
| Full roster, picks, and bans in your own match             | Optional memory reader (not yet checked in a live match) | Optional memory reader  |
| Automatic account identification                           | Active Steam account                                     | Steam login of Dota     |
| Exact MMR and rank confidence from Dota                    | Optional memory reader                                   | Optional memory reader  |
| Matchups, position recommendations, meta and counter picks | Requires STRATZ service                                  | Requires STRATZ service |

**Memory reading is off by default.** Enabling it permits external, read-only
access to the Dota process. It does not write memory, inject code, or call game
functions. The anti-cheat response is unknown, and game updates may break the
reader. See [setup and data](docs/guide/setup.md) before enabling it. macOS is not
currently a supported release target.

### Is this a cheat?

No gameplay automation, no input to the game, no overlay inside it, no modified game files
beyond Valve's own GSI setup, and nothing the game hides from you: during hero selection the
optional reader takes picks only, not who is playing. What you see is public profile
statistics and your own match, in a separate window. The one part with an unknown risk is the
optional memory reader, which is off unless you enable it.
[Safety and fair play](docs/guide/fair-play.md) explains each point, the data sources and the
limits of what we can promise.

## Features

- **Match table:** two teams of five with this match's role (selected in the
  draft, or a team-wide guess marked as likely), ranks, lifetime games and win
  rate, recent games over 7/14/30/90 days, main positions and their shares,
  frequent heroes with spam markers, and statistics for the current hero. Your own
  row is marked, earlier meetings show a MET badge, and avatars get the in-game
  slot colour when the slot order is known. Missing IDs, private profiles,
  loading, and stale data are shown separately.
- **Analysis panels:** hero matchups, lane summary, picks for either side, meta
  picks, and counter picks. Two independent panels, three on a wide window. Switch
  the left panel with `Alt+←/→`, the right with `Shift+←/→`, and the shared lane
  with `Alt+↑/↓`. In your own match the assigned position sets the initial lane.
  Switching panels does not fetch again.
- **Draft tracking:** bans drop out of suggestions and counters. Hovered heroes
  remain tentative. The current match survives a disconnect, and the last match
  stays on screen until another one starts.
- **Hover cards:** every number has a card that says what it is and where it comes
  from; column headers with ⓘ explain formulas and colour bands.
- **Readable layout:** the match screen fits the window down to 90% scale, then
  scrolls. Analysis panels keep their size when switching views.
- **Player notes and cards:** searchable notes linked to Dota IDs; a player card
  with full history, teammates and opponents; Dotabuff, OpenDota, and STRATZ
  links. The SMURF label is a public-statistics heuristic, not proof.

![Draft panels: lane summary, Radiant recommendations and counters to Dire](docs/images/draft-panels.png)

The personal profile includes a rank medal with confidence, an interactive MMR
chart, position breakdown, match averages, and history with KP/DP, IMP, building
damage, healing, measured MMR changes and site links. Statistics are coloured
against OpenDota hero benchmarks. Filters cover period, hero, result, modes,
position, duration, local start time and weekday, and patch; active filters show
as chips with a Reset. Incomplete history is labelled and can be extended. The
match journal records your own matches from GSI, so they stay visible when the
account's match data is private.

![Personal profile with rating, position breakdown, and match history](docs/images/profile.png)

Hovering a statistic of a match ranks all ten players of that match (STRATZ
history):

![Ten-player card for GPM with the own row highlighted](docs/images/match-card.png)

[How draft numbers are calculated](docs/guide/draft.md).

## Build and run

Install **Node.js 22.12 or newer**, npm, Rust stable, and the
[Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/).
On Windows, install the MSVC C++ Build Tools and WebView2 Runtime. On Linux,
install WebKitGTK 4.1 and your distribution's build dependencies.
See the [installation guide](docs/guide/install.md) for commands and packaging.

```sh
git clone https://github.com/PavluntiyJ/ancient-lens.git
cd ancient-lens
npm ci
npm run dev
```

`npm run dev` opens the desktop app. It is not a browser-only web application.
To create an optimized executable:

```sh
npm run build
```

Run `src-tauri/target/release/ancient-lens` on Linux or
`src-tauri/target/release/ancient-lens.exe` on Windows.

## First launch

1. Open **Settings → Connect Dota 2**. It checks the GSI file and the
   `-gamestateintegration` launch option; **Set up automatically** installs the
   file and, after you confirm, closes Steam to add the launch option and starts
   it again. **Set up manually** keeps the file-saving steps.
2. Restart Dota 2 if it was running, then spectate a match to check the connection.
3. Open **My profile**. Windows detects the active Steam account; Linux uses the
   Steam login that launched Dota, then your own GSI events if that is unavailable.
   **Set profile manually** is the fallback.
4. Public OpenDota statistics work without a token. For STRATZ draft features,
   set up the optional [local statistics service](docs/guide/stats-service.md).
   On Windows, save your token once with the launcher; Ancient Lens then starts
   the bundled `stats-service.exe` itself and stops it when the app quits. The
   token stays in Windows Credential Manager and never enters the app UI.

GSI sends only your own player when you participate in a match. An empty enemy
roster on Windows is a current platform limitation, not a failed installation.
See [setup and troubleshooting](docs/guide/setup.md) and the
[Fedora guide](docs/guide/fedora.md).

## Data and privacy

Notes, settings, and the MMR journal stay on your computer. Public statistics
providers receive your IP address and the player IDs you request; Steam CDNs
serve portraits and avatars. There is no usage analytics or cloud account.
Your generated GSI configuration contains a local access token: do not share it.
[Storage locations and network details](docs/guide/setup.md#storage-and-privacy).

## Contribute

```sh
npm run check
npm run format:check
npm run test:rust
python3 -m unittest discover -s tests/python
npm run build
npm run test:native
```

Native tests need the platform WebView driver. They use isolated synthetic data,
not a running Dota game. See [verification](docs/dev/verification.md),
[contributing](CONTRIBUTING.md), and [security reporting](SECURITY.md).
The [documentation index](docs/README.md) links the guides, the
[architecture](docs/dev/architecture.md) and the [native reader guide](docs/dev/native-reader.md);
[status](docs/status.md) lists known limitations and planned work, and the
[changelog](CHANGELOG.md) user-visible changes.

## License and attribution

Project code is [MIT licensed](LICENSE). Third-party assets retain their own
rights and licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Valve owns Dota 2 artwork and trademarks. No third-party application binaries,
extracted source, private captures or proprietary datasets are distributed with this
project.
