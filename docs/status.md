# Status and roadmap

What works is listed per platform in the [README](../README.md#what-works-on-each-platform);
changes are in the [changelog](../CHANGELOG.md). This page lists what is known to be missing
or unverified, and what is planned.

## Not provided

- No installer signing or automatic updates. The app announces a new release and links to
  it; you install it yourself ([installation](guide/install.md#update)).
- No hosted statistics service. STRATZ features need your own token; **Connect STRATZ** in
  Settings saves it and starts the bundled [statistics service](guide/stats-service.md).
  OpenDota works without one, with fewer features and a rate limit.
- macOS is not supported.

## Known limitations

- **Native CI coverage:** Windows runs the native UI scenarios before packaging
  and preserves reusable executables and failure diagnostics. Linux shares the
  diagnostic capture but still needs a local desktop run; its ordinary checks
  and distributions run in CI. See [verification](dev/verification.md#ci).
- **0.7 match interface on Linux:** the roomier table, player hover card and simplified note
  controls were inspected on Windows with synthetic native fixtures. Linux has passed the
  ordinary CI checks for the interface changes, but the new layout and interactions still
  need a Linux desktop run of `npm run test:native` and visual review. This is a verification
  gap, not an intentionally Windows-only feature.
- **Memory readers** are validated on specific game builds (see the
  [maintenance guide](dev/native-reader.md#verified-builds)). A game update can make them
  report `unsupported` until discovery is checked again. The anti-cheat response to external
  reading is unknown; reading is off by default.
- **Connect STRATZ on Linux** saves the token with `secret-tool` and starts the
  `stats-service` shipped in the packages. Checked on a Fedora 44 KDE desktop; other
  desktops and keyrings are covered by the build and the unit tests only.
- **Windows over the game:** on Windows the match and profile windows are shown and clicked
  without taking the keyboard from the game; that Dota keeps its sound with a window shown has
  not yet been checked in a live match. Exclusive fullscreen covers the windows. On Linux the
  same works on X11 when the window manager honours the focus hint (the X11 path has not been
  run on a desktop yet); on **Wayland** the compositor decides stacking and focus, so the
  windows cannot be kept above the game or shown without activation by the app (KDE: **Keep
  Above Others** or a window rule) and showing one puts the game in the background.
- **Minimizing for other applications:** both windows minimize when another program is activated.
  Checked on Windows with isolated data; that clicking the game keeps them up is covered by
  unit tests only, never with the game running. On Linux X11 the active window's
  `_NET_WM_PID` names the program; this path builds and its decision is tested, but it has not
  been run on a desktop, and a game in a separate process namespace would not be recognized.
  **Wayland** does not tell applications which window is active, so there the windows stay up
  and the setting is disabled.
- **Window keys only over the game:** the two window keys are released over other programs,
  whether or not Dota runs. Checked on Windows with isolated data. On Linux the desktop portal's
  shortcuts are global by design, so only the X11 key-grab fallback follows the rule, and that
  path has not been run on a desktop; on **Wayland** the active window is unknown, so the keys
  work everywhere and the setting is disabled.
- **Recorded matches** have no damage, net worth or game mode until a provider has the
  match; participant GSI does not send them.
- **Parties** are inferred from the 20 latest public matches of each player (STRATZ through the
  statistics service): STRATZ has no party data for a match in progress, and records it for
  only part of past matches. Friends who queue together rarely, or players with private
  profiles and no public teammate, are not marked; an older statistics service shows none.
- **Profile filters:** party size and season need data the app does not load. History is
  paged by scrolling, not by numbered pages.
- **Performance points:** the profile shows STRATZ IMP per match; there is no own
  performance score yet.

## Planned

- An own performance score per match, scored against position and bracket averages.
- Replay parsing, so statistics of all ten players are available without waiting for
  providers. It needs a replay source and a demo parser checked against the current game.
- Visual decisions still open: best-of-match marks in the history table and colour families
  for statistics.

Report problems and proposals through the issue templates; see
[contributing](../CONTRIBUTING.md).
