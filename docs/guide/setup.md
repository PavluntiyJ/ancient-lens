# Connect Dota and understand your data

## GSI configuration

**Settings → Connect Dota 2** checks the connection on Windows and Linux: the
Steam installation, the Dota 2 library, Ancient Lens's GSI file, and
`-gamestateintegration` in Dota's launch options. When something is missing,
**Set up automatically** fixes it:

- It writes `gamestate_integration_ancient_lens.cfg` into
  `<Dota 2>/game/dota/cfg/gamestate_integration/`.
- It appends `-gamestateintegration` to the existing launch options of the Steam
  account that launched Dota or signed in last (otherwise every account on this
  computer that has played Dota). Steam keeps launch options in
  `userdata/<account>/config/localconfig.vdf` and rewrites that file on exit, so
  this step asks first, then closes Dota 2 and Steam, edits the file, and starts
  Steam again. **Start Dota 2 afterwards** also launches the game. The previous
  file is kept as `localconfig.vdf.ancient-lens-backup`.
- It refuses while GSI reports that you are playing a match, so it never closes
  a running game you are in.

Steam on Linux may be a native, Flatpak, or Snap installation. Nothing is
changed without pressing the button, and isolated test sessions never look at
Steam.

To set it up by hand instead, open **Set up manually**:

1. **Save GSI configuration** and save the file into
   `<Dota 2>/game/dota/cfg/gamestate_integration/`. Create the last folder if needed.
   Find the installation through **Steam → Dota 2 → Manage → Browse local files**.
2. Add `-gamestateintegration` in **Steam → Dota 2 → Properties → Launch Options**
   and restart Dota 2. Then play or spectate a match.

Replace older configurations: the current version requests the `draft` block.
The receiver listens only on `127.0.0.1:32123`, checks a random installation
secret, limits request size, and rejects browser `Origin` headers. The generated
file contains this secret; do not publish it or copy it between installations.
Apart from the setup above, the app does not change game files, Steam settings,
or `coreinit.lua`.

In spectator mode, GSI supplies ten players with IDs and heroes. As a participant,
it supplies only your own player; the `draft` block was empty throughout the
live test on October 13, 2026. Full roster, picks, and bans in your own match
therefore require the optional memory reader. This is the same on Windows and
Linux: an empty enemy roster in your own match, with the reader off, is expected and does
not mean the installation failed. Data becomes stale after 30 seconds without events.

### Optional draft diagnostics

Diagnostics are off by default. To enable them for one Linux launch:

```sh
ANCIENT_GSI_DRAFT_DIAGNOSTICS=1 ./src-tauri/target/release/ancient-lens
```

This writes `gsi-draft-diagnostics.jsonl` in the data folder, capped at 1 MiB
before replacement. It records time, phase, mode, structure shape, and slot
counts, not field values, Steam IDs, player names, or tokens. To check the readers
after a game update, see [the native reader guide](../dev/native-reader.md#after-a-game-update).

## Your profile

**My profile** finds your account without a token. Windows uses the active Steam account
from the registry. Linux uses the Steam login that launched Dota and, when that is
unavailable, your own GSI events. **Set profile manually** is the fallback on both systems.

## Memory reading

**Allow Dota memory reading** is off by default. Changes apply immediately and
are saved as `nativeRosterReader` in `state.json`.

![Memory-reading consent and explanation](../images/memory-consent.png)

| Platform | Readable data                                                                                                                               | Method                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Linux    | Current roster, picks, hovers, selected lanes, bans; own MMR, confidence, behavior and communication                                        | `process_vm_readv`, Source 2 schema and code-shape discovery                                      |
| Windows  | Current roster, picks, hovers, selected lanes, bans (not yet checked in a live match); own MMR, rank confidence, behavior and communication | `ReadProcessMemory`, Source 2 schema, PE relocations and MSVC RTTI; rating polled every 3 seconds |

Neither implementation writes game memory, injects code, hooks the game, or
calls game functions. An unfamiliar layout gives an unsupported status instead
of guessed values. The anti-cheat response is unknown. Decide whether to enable
this feature before playing. The app does not relax system memory-access policy.

When disabled, Windows still identifies your account through Steam registry
information. Both keep GSI data. How the readers work, what they validate and on which
game builds they were checked: [native reader guide](../dev/native-reader.md).

## Window, hotkey, and tray

Ancient Lens has one window. `Alt+Num 5` (numpad 5 with Num Lock off) brings it
over the game; pressing it again while the window is in front hides it. On Linux
the shortcut is registered through the desktop's GlobalShortcuts portal, so it
works whichever window has the keyboard; the desktop asks to confirm it once and
lets you change it (on KDE: **System Settings → Shortcuts → Ancient Lens**).
Without the portal, an X11 key grab is used, which on Wayland only sees the key
while an X11 window such as the game is focused. Closing the window keeps the app
in the system tray, so GSI and the rating reader keep running; quit from the tray
icon menu, or turn this off in **Settings → Window over the game**, which also
shows the shortcut as the desktop bound it. On Linux the tray needs a
StatusNotifier host (KDE Plasma, or GNOME with the AppIndicator extension);
without one the option is disabled and closing quits. Exclusive fullscreen can hide the window,
so use borderless windowed mode or a second monitor. On Wayland the compositor
controls stacking and position (on KDE: **Keep Above Others** in the window menu),
and the shortcut depends on the desktop. This is a regular desktop window, not
an overlay injected into the game renderer. Shortcuts for the analysis panels are listed in
[the match screen guide](match-and-profile.md#analysis-panels).

## Storage and privacy

`state.json` stores notes, account-specific MMR history, the GSI token, and reader
settings. `matches.json` beside it is the match journal: while the app runs, each
match you play is recorded from GSI at post-game (hero, result, duration, K/D/A,
LH/DN, GPM/XPM), later completed by match ID from STRATZ or OpenDota, and shown
in the profile even when the account's match data is private. Display and
statistics preferences (scale, columns, Turbo, ranked only, synergy weight) live
in the window's local storage. The default directory is `%APPDATA%\Ancient Lens` on Windows and
`~/.config/Ancient Lens` on Linux (or `$XDG_CONFIG_HOME/Ancient Lens`). The exact
path appears in Settings. Writes are atomic; invalid state is preserved, and
`state.pre-tauri.json` is created before the first migration.

JSON export includes notes and MMR but omits the GSI secret. **Exports still
contain player IDs, names, notes, and rating history; they are personal backups,
not anonymous diagnostics.** Import is not implemented yet.

`cache/` contains player summaries, account/provider-specific history (STRATZ
history pages include all ten players of each match), hero catalogues, hero
benchmarks, the patch table, and draft statistics. Cached data is labelled stale on network
failure. Removing the app does not remove this data directory automatically.

| Destination                            | When                                                                               | Data sent                                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Configured statistics service → STRATZ | When configured                                                                    | Player IDs, period, filters; STRATZ token stays in the service        |
| `api.opendota.com`                     | Without STRATZ; hero catalogue, benchmarks, patch dates, match by ID, manual draft | IP and requested IDs; requests are paced, with a pause after HTTP 429 |
| `api.opendota.com` (`players/{id}`)    | With STRATZ, once a week per shown player whose STRATZ profile has no country      | IP and the player ID; only the country is used                        |
| `cdn.cloudflare.steamstatic.com`       | Hero portraits                                                                     | Ordinary image requests                                               |
| Steam avatar CDNs                      | Player avatars                                                                     | Ordinary image requests                                               |

No analytics, telemetry, or Ancient Lens cloud account is used.

## Troubleshooting

| Symptom                          | Check                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| No events from Dota              | **Settings → Connect Dota 2** shows what is missing. Otherwise: Steam library, configuration filename, launch option, game restart.              |
| GSI port unavailable             | Close another Ancient Lens instance. Do not expose port 32123 to your network.                                                                   |
| Only your player appears         | Expected participant GSI limitation. The full roster requires **Allow Dota memory reading** in Settings.                                         |
| Memory access denied             | Same user/permissions for game and app; OS process restrictions may still deny access. GSI remains available.                                    |
| Reader unsupported after a patch | Keep memory reading off and report the game/platform version. Do not replace offsets with guesses.                                               |
| Empty draft recommendations      | Set up the [STRATZ service](stats-service.md); OpenDota alone does not power these panels.                                                       |
| Rate limit or stale statistics   | Wait for the cooldown and retry. Provider coverage can differ; unavailable history does not prove a private profile.                             |
| No Linux MMR measurement         | Enable **Allow Dota memory reading** and start Dota from Steam. Without Steam's launch environment, the rating waits for your first in-game GSI. |
| No automatic profile             | Wait for your own GSI event on Linux or Steam login on Windows, or use **Set profile manually**.                                                 |
| Profile totals look incomplete   | Check period/mode/Turbo filters and the incomplete-sample label; use **Load more history**.                                                      |
