# Status and roadmap

What works is listed per platform in the [README](../README.md#what-works-on-each-platform);
changes are in the [changelog](../CHANGELOG.md). This page lists what is known to be missing
or unverified, and what is planned.

## Not provided

- No published binaries, installer signing or automatic updates. Build from source
  ([installation](guide/install.md)).
- No hosted statistics service. STRATZ features need your own token and the local
  [statistics service](guide/stats-service.md); OpenDota works without one, with fewer
  features and a rate limit.
- macOS is not supported.

## Known limitations

- **Memory readers** are validated on specific game builds (see the
  [maintenance guide](dev/native-reader.md#verified-builds)). A game update can make them
  report `unsupported` until discovery is checked again. The anti-cheat response to external
  reading is unknown; reading is off by default.
- **Windows draft reading** in your own match is implemented but has not yet been checked
  during a live hero selection.
- **Recorded matches** have no damage, net worth or game mode until a provider has the
  match; participant GSI does not send them.
- **Profile filters:** party size and season need data the app does not load. History is
  paged by scrolling, not by numbered pages.
- **Performance points:** the profile shows STRATZ IMP per match; there is no own
  performance score yet.

## Planned

- An own performance score per match, scored against position and bracket averages.
- Replay parsing, so statistics of all ten players are available without waiting for
  providers. It needs a replay source and a demo parser checked against the current game.
- Windows and Linux checks in hosted CI once the repository is public, so neither platform
  falls behind.
- Visual decisions still open: best-of-match marks in the history table and colour families
  for statistics.

Report problems and proposals through the issue templates; see
[contributing](../CONTRIBUTING.md).
