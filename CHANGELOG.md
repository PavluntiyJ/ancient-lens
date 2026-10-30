# Changelog

User-visible changes. Dates are when the change landed; 0.5.0 is the first binary prerelease.

## Unreleased

### Changed

- Hover cards of match players list all loaded matches of the period, scrolling, instead of
  the newest eight.
- Player names in the match table are smaller and lighter, so longer names fit.

### Fixed

- The player card no longer extends past the top of the window when the match view is
  zoomed, and an empty note takes one line.
- Frequent heroes stay inside their column in narrow windows.

## 0.7.0 — October 30, 2026

This release refreshes the match table and player hover cards, simplifies notes, and adds
release notifications. Existing settings, notes and rating history are kept.

### New versions

- A notice above the match screen says when a newer Ancient Lens release is out, with
  **What's new** (the release page), **Later** (until the next start) and **Skip this
  version**. The app asks GitHub for its release list shortly after start and every 12
  hours; the request contains no account, settings or app version, and nothing is
  downloaded. Turn it off in Settings → Data → Updates.

### Match table

- A **With me** column replaces the MET badge: the number of your earlier matches with the
  player and your win rate in them; hover it for the list.
- The country flag sits in the corner of the avatar, and the Dotabuff, OpenDota and STRATZ
  links moved from the row into the player's hover card.
- The player's hover card opens from anywhere in the player cell (avatar, role or name), next
  to the row, and is built of blocks: who (avatar, name, all-time matches, rank, this match's
  role), facts (country, Steam name, the period, streak, main role, With me), the note, which
  opens its editor from anywhere in its block, site tiles (Dotabuff, OpenDota, STRATZ and now
  Steam), the newest eight matches with their result and how long ago they were, and your
  earlier matches with or against the player (both heroes, K/D/A and the result for you),
  which show for private profiles too because they come from your own history.
- Notes have one kind: Observation, Good teammate and Watch out are gone from the note
  forms, and older notes of any type look the same. The note marker is larger and its title
  gives the note's date; the hover card shows the date under the note.
- One role icon per player, before the name: the lane selected in the draft, or a dimmer
  guess. Its card says which in one line; lanes picked in the draft no longer show as extra
  icons under the name.
- The analysis panels keep less height before the screen grows (up to 150%), so a tall
  window gives the ten player rows more room.
- The match status (phase, match ID, profiles, period, refresh) moved into the window's title
  bar, and the match clock is gone, so the table starts higher. A player whose profile did not
  load no longer pushes the table down with a banner: the row says so, with the reason on hover.

### Sound

- The chime for a player with a note is two soft notes at 30% of the chime volume, once per
  match look; the separate "Watch out" chime is gone. Settings → Sound has a **Chime volume**
  slider (80% by default).

## 0.6.1 — October 29, 2026

0.6.0 was not published as a release, so this is the first release after 0.5.0 and also
includes everything listed under [0.6.0](https://github.com/PavluntiyJ/ancient-lens/blob/main/CHANGELOG.md#060--october-29-2026): two windows over the game,
Connect STRATZ, and the new Settings.

### First start and STRATZ

- First launch offers optional STRATZ setup after either memory-reader choice,
  explains faster player loading and extra match statistics, and remembers **Not
  now**. Provider settings are clearly titled **Connect STRATZ**.
- Website links use system libraries outside a Linux AppImage and check the
  browser launch result. STRATZ setup shows failures and an address to copy manually.

### Linux packages

- Releases include a Fedora package (`.rpm`), installed with `sudo dnf install`.
- Linux windows show the Ancient Lens icon in the task switcher and taskbar instead of
  a generic one: the desktop entry is now `ancient-lens.desktop`, matching the window.
  Linux release files are named `ancient-lens-<version>-…` accordingly.

## 0.6.0 — October 29, 2026

### Windows over the game

- **Two windows:** the match window (match table and draft panels) and the profile window
  open at start. Each is shown or hidden on its own, with its own global key (`Alt+Num 5` for
  the match, `Alt+Num 6` for the profile, both changeable in Settings → Interface → Shortcuts)
  or its close button; the app keeps running in the tray. The header's profile icon brings up
  the profile window, which opens at 1600×1000 and uses its full width.
- **The game keeps its sound:** both windows stay on top and, on Windows and on Linux with X11,
  appear without taking the keyboard from the game, so a game that mutes in the background
  keeps playing sound. Clicks work as usual; clicking a text field or the keyboard button in
  the title bar lets you type, and the game goes to the background until you click it again.
  Needs borderless or windowed mode. On Wayland the desktop decides, as before.
- Each window remembers its size and position.

### STRATZ

- **Connect STRATZ** in Settings and in the empty draft panels: open stratz.com/api, paste
  your token, and the app checks it, saves it in Windows Credential Manager or the Linux
  keyring and starts the statistics service that ships with the app. **Disconnect STRATZ**
  removes the token. On Linux the flow has not been tried on a desktop yet.

### Settings and navigation

- **Settings** opens with a Connections overview (Dota 2, STRATZ, memory reading: connected,
  needs setup or off, each with a button to its section) and groups the sections into
  Connections, Match & statistics, Interface and Data, with a side list on wide windows.
- The Tools (wrench) menu is gone. **Manual draft** and **Add players manually** open from the
  match screen while game data is missing or the roster is incomplete, **GSI diagnostics** from
  Settings → Connect Dota 2, and **Notes** has its own header icon. The interface scale is set
  in Settings → Appearance only.

### Memory readers

- **First start:** the app asks once whether to enable the reader that fills the roster,
  picks and bans of your own match, with its risk and the way back in Settings. **Not now**
  keeps it off, as before.
- **Windows:** reading the draft of your own match (picks, hovers, bans, lanes) and the
  ten-player roster after it are confirmed in a live ranked game on build 6969.

### Profile

- Removed the Bracket column from match history. A current MMR reading no longer shows a
  leaderboard position from cached public profile data.

## 0.5.0 — October 28, 2026

### Downloads

- A Windows installer, a portable Windows ZIP, an AppImage and a Debian package, with SHA-256
  checksums, on the Releases page. The [installation guide](docs/guide/install.md#download)
  explains installing, verifying and updating.

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
- A match you just played is coloured right away from the roles and medals of the live match
  (Linux), before providers have it.

### Players

- Notes from the player card or its hover card; an optional chime for noted players.

### Memory readers and setup

- Optional, read-only readers for your MMR, rank confidence, behaviour and communication
  scores and for the roster, picks, hovers, lanes and bans of your own match (Windows and
  Linux). Watching a friend's match live in the client shows all ten players too.
- Settings checks and repairs the Steam side of the game connection: the GSI file and the
  launch option.
- On Windows the statistics service needs no console after the first setup: the STRATZ token
  is kept in Windows Credential Manager, and Ancient Lens starts and stops the service. A
  service already running at `127.0.0.1:8787` is found automatically.
- One window with a tray icon; `Alt+Numpad 5` shows or hides it (a desktop portal shortcut on
  Linux). Every in-app key and the Windows show/hide key can be changed in Settings; a
  combination another program owns is reported and the previous one stays active.

### Fixes

- Caches are bounded and validated; long histories are kept; a recent history is reused for
  ten minutes and hero averages for a week.
- TLS certificate verification and other dependency security updates.

## 0.4.1 — October 12, 2026

Fedora support with batched statistics and native roster discovery; English interface and
documentation; installation, contribution and security guides.
