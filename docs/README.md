# Ancient Lens documentation

New users start with [installation](guide/install.md), then [first-run setup](guide/setup.md)
and [the match screen and profile](guide/match-and-profile.md). Contributors read the [contributing guide](../CONTRIBUTING.md) and the
[architecture](dev/architecture.md). Known limitations and plans are in [status](status.md);
user-visible changes in the [changelog](../CHANGELOG.md).

## User guides

| Document                                               | Purpose                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| [Install](guide/install.md)                            | Build requirements, source installation, native packages                  |
| [Setup](guide/setup.md)                                | GSI, profile, opt-in memory reading, window/tray, storage/network         |
| [Match screen and profile](guide/match-and-profile.md) | Match table, analysis panels and shortcuts, notes, personal profile       |
| [Draft](guide/draft.md)                                | Recommendations, matrix, lanes, counters, meta, formulas and uncertainty  |
| [Fedora](guide/fedora.md)                              | Dependencies, launcher, optional keyring/service                          |
| [Statistics service](guide/stats-service.md)           | Optional STRATZ setup, credentials, cache, quotas                         |
| [Safety and fair play](guide/fair-play.md)             | What the app does and does not do, data sources, the memory reader's risk |

## Development

| Document                                | Purpose                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| [Architecture](dev/architecture.md)     | Processes, source map, IPC, storage and trust boundaries             |
| [Native readers](dev/native-reader.md)  | Memory readers: discovery, validation, verified builds, game updates |
| [Verification](dev/verification.md)     | Checks and the claims they support                                   |
| [AI development tools](dev/ai-tools.md) | Project MCP setup for Claude Code, Codex and OpenCode                |
| [Release preparation](dev/releases.md) | Version files, documentation, platform checks and draft publication |
| [Status and roadmap](status.md)         | Known limitations and planned work                                   |

## Screenshots

Screenshots in `images/` (match screen, player hover card, analysis panels, profile, ten-player card,
memory-reading consent), used by the README and the guides, use isolated fictional fixtures, not personal account captures.
Regenerate on Linux with WebKitWebDriver or Windows with WebView2:

```sh
npm run build
npm run docs:screenshots
```

For a hands-on review, `npm run demo` opens the built app on deliberately awkward invented
data (long and non-Latin names, private and missing profiles, notes, a 150-match history) and
switches between watching, playing and a step-by-step draft from the terminal.

Close the ordinary application first. The capture script uses native IPC and its own
temporary data directory; hero portraits may require network access. On Linux, running it in
a nested `kwin_wayland --virtual` session (see [verification](dev/verification.md)) keeps the
desktop from interfering.
