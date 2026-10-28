# Changelog

User-visible changes. Dates are when the change landed; there are no binary releases yet.

## Unreleased

- **Downloads:** a version tag builds a Windows installer, a portable Windows ZIP, an AppImage
  and a Debian package into a draft GitHub prerelease with SHA-256 checksums. The
  [installation guide](docs/guide/install.md#download) explains installing, verifying and
  updating.
- **Windows:** the optional memory reader now also reads the roster, picks, hovers, lanes and
  bans of your own match, as on Linux. Watching a friend's match live in the client shows all
  ten players too.
- **Windows:** the statistics service needs no console after the first setup: the STRATZ
  token is kept in Windows Credential Manager, and Ancient Lens starts and stops the service.
  A service already running at `127.0.0.1:8787` is found automatically.
- **Shortcuts:** every in-app key and the Windows show/hide key can be changed in Settings;
  a combination another program owns is reported and the previous one stays active.
- **Profile:** a match you just played is coloured right away from the roles and medals of
  the live match (Linux), before providers have it.

## 0.5.0 — October 28, 2026

### Match screen

- Ten-player table with this match's role (picked lane, or a likely role for the team), your
  own row marked, ranks, lifetime and recent games, main positions, frequent heroes with spam
  markers, a MET badge for players from your earlier matches and Steam country flags.
- Analysis carousels: hero matchups, lane summary, picks for either side, meta picks and
  counter picks; two panels, three on wide windows, with keyboard switching.
- Hover cards on every number, with what it is and where it comes from; column headers
  explain formulas and colour bands.
- The screen fits the window down to 90% scale, keeps panel sizes stable and survives
  reconnects; the last match stays until another starts.

### Draft

- Hero statistics per rank bracket, chosen automatically for each match.
- Suggestions keep a hero's main positions only (at least 20% of its games), with an optional
  minimum win rate.
- Pair advantages are shrunk by sample size; bans drop out of suggestions and counters.

### Profile

- Redesigned page: header with rating and compact MMR chart, position cards, one filter bar
  (period, result, modes, duration, start time, weekday, patch) and a saved view.
- History coloured against the average of the hero on its position and match bracket; IMP in
  seven tones; KP, DP, building damage, healing and site links per match.
- Every match opens a ten-player card; a local match journal keeps your matches even when
  your provider history is private.

### Players

- Notes from the player card or its hover card; an optional chime for noted players.

### Memory readers and setup

- Optional, read-only readers for your MMR, rank confidence, behaviour and communication
  scores (Windows and Linux) and for the roster and draft of your own match (Linux).
- Settings checks and repairs the Steam side of the game connection: the GSI file and the
  launch option.
- One window with a tray icon; `Alt+Numpad 5` shows or hides it (a desktop portal shortcut on
  Linux).

### Fixes

- Caches are bounded and validated; long histories are kept; a recent history is reused for
  ten minutes and hero averages for a week.
- TLS certificate verification and other dependency security updates.

## 0.4.1 — October 12, 2026

Fedora support with batched statistics and native roster discovery; English interface and
documentation; installation, contribution and security guides.
