# Native readers: maintenance guide

Two optional readers take data from the running game that Game State Integration (GSI) does
not send: the account and rating of the local player, and the ten-player roster and draft of
the current match. Both are off until the user enables **Allow Dota memory reading**; one
setting (`nativeRosterReader` in `state.json`) covers both. This guide explains how they find
their data, what they validate and how to check them after a game update.

## Rules

- Read only. The process is opened for reading and querying (`PROCESS_VM_READ` /
  `PROCESS_QUERY_LIMITED_INFORMATION` on Windows, `process_vm_readv` on Linux). Nothing is
  written, injected or called in the game, and the process is never suspended.
- No stored addresses. Every address and field offset is found again in the installed game
  files and the running process; nothing from an earlier build is cached on disk.
- Fail closed. An unknown layout reports `unsupported` instead of a guessed value. A value
  is published only after two agreeing reads.
- GSI stays the authority for the match and the local player. A read that disagrees with GSI
  is discarded.
- Test instances (`ANCIENT_TEST_DATA`) never open the real game process.

## Account and rating (`src-tauri/src/own_account*`)

Polled every three seconds.

- **Account.** Windows reads the active Steam user from the registry
  (`ActiveProcess.ActiveUser`) and checks it against the running Steam process; this is not
  game memory and works without consent. Linux maps the Steam login that launched Dota
  (`SteamAppUser` in the game's environment) through `loginusers.vdf`; the environment is
  part of the game process, so it is read only with consent. A fresh own GSI packet can
  confirm or, when it conflicts, block the binding until the game restarts.
- **Layout.** `layout.rs` (PE) and `layout_linux.rs` (ELF) find the rating getter by its
  code shape near the `rank_confidence` string. Every candidate must be the same function;
  the getter, adjustment and percent code are compared byte for byte except relative
  displacements, and the confidence formula constants must match. A changed formula fails as
  `unsupported`; relocated but identical code is accepted.
- **Values.** MMR, confidence (adjusted for game time), behaviour and communication scores.
  Below 30% confidence the MMR is hidden. The rating journal records a value only when MMR
  changes. Confirmed values survive up to 30 seconds of temporary failures.

## Roster and draft (`src-tauri/src/roster*`)

| File                                   | Layer                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `roster.rs`                            | GSI context, worker, merge into the live state, holding a confirmed roster  |
| `roster/source2.rs`                    | Shared Source 2 logic: schema classes, layout, entity walk, reads, sessions |
| `roster/picks.rs`                      | Draft snapshot: picks, hovers, lanes, slots, bans; no identities            |
| `roster/elf.rs`, `roster/pe.rs`        | Discovery in the Linux and Windows module files                             |
| `roster/linux.rs`, `roster/windows.rs` | Process access: find the game, map modules, read memory                     |

ELF and PE discovery is plain file parsing, so both build and are tested on every system.

### Discovery (once per game process)

1. **Resource service.** The `CreateInterface` export of the engine module (`libengine2.so`,
   `engine2.dll`) loads the interface registry head with its first RIP-relative `mov`. The
   registry nodes are `{factory, name, next}`; `GameResourceServiceClientV001`'s factory must
   be exactly `lea rax, [rip+X]; ret`, and `X` is the service.
2. **Schema classes.** In the client module, the class names `C_DOTA_PlayerResource`,
   `PlayerResourcePlayerData_t`, `PlayerResourcePlayerTeamData_t`, `C_DOTAGamerules`,
   `C_DOTAGamerulesProxy` (required) and `DataTeamPlayer_t`, `C_DOTA_DataNonSpectator`
   (draft, optional) are found as strings. Relocated pointers to those names (ELF
   `R_X86_64_RELATIVE`, PE `DIR64`) sit 8 bytes into a class-info structure. In the running
   game that structure points to itself, has its size at +32, its field count at +36 and its
   field table at +48 (32-byte entries: name pointer, offset at +16). A required class must
   resolve to exactly one candidate.
3. **Entity types.** The primary virtual tables of `C_DOTA_PlayerResource`,
   `C_DOTAGamerulesProxy`, `C_DOTA_DataRadiant` and `C_DOTA_DataDire` come from RTTI: Itanium
   type info on Linux; on Windows the decorated name `.?AV<class>@@` inside a TypeDescriptor,
   a CompleteObjectLocator with offset 0 that names it, and the table right after a relocated
   pointer to that locator. At runtime each table's type name is read back and compared.
4. **Module identity.** The loaded module must be the file that was parsed: the inode on
   Linux, the PE timestamp and image size on Windows.

Field offsets all come from the schema. A small engine layout does not: the entity system
pointer in the resource service (+0x50 on Linux; +0x58 on Windows, with +0x50 tried as well),
32 chunk pointers at +0x10, and 512 identities of 0x70 bytes per chunk with the handle at
+0x10. Only an offset whose identities validate (handle index equals position, virtual table
among the discovered types, no duplicates) is used.

### Reading (about once a second, four times a second while drafting)

- **Roster** from Strategy Time to Game In Progress: per player the Steam ID, team, selected
  hero, name and, when the schema has it, the medal (`m_iRankTier`, 10–80). The match ID,
  phase, rules pointer and vector headers are checked before and after; two consecutive reads
  must agree. A roster needs ten distinct accounts, five per team, and must contain the local
  player as GSI reports it.
- **Watching a match in the client.** Watching a friend's match live sends GSI in player mode
  with the match but no player. The reader then checks the roster for ten players and two
  teams without a local player.
- **Draft** in Hero Selection: picks, hovers, selected lanes, team slots and bans, without
  names or account IDs. Picks confirmed in a match are kept through short incomplete reads.

### Statuses

`rosterStatus` and `draftStatus` report `disabled`, `waiting`, `ready`, `test-mode`,
`permission`, `unsupported`, `not-running`, `multiple-games`, `waiting-entities`,
`match-mismatch`, `incomplete`, `unavailable` or `retrying` (`src/shared/domain.ts`). The UI
falls back to GSI data for every status but `ready`.

## After a game update

1. **Offline, without starting the game** (any system; paths to the installed files):

   ```sh
   ANCIENT_CLIENT_DLL=<…/game/dota/bin/win64/client.dll> ANCIENT_ENGINE2_DLL=<…/game/bin/win64/engine2.dll> cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture installed_client_dll_schema installed_engine2_exports_create_interface installed_client_layout_is_found_and_fails_closed
   ```

   ```sh
   ANCIENT_DOTA_CLIENT=<…/linuxsteamrt64/libclient.so> ANCIENT_DOTA_ENGINE=<…/linuxsteamrt64/libengine2.so> cargo test --manifest-path src-tauri/Cargo.toml --lib -- --ignored --nocapture installed_client_schema installed_engine_exports_create_interface installed_libclient_matches_the_researched_layout
   ```

   Every class must resolve once, every entity table must be found, and the rating layout
   must be found and fail closed when its constant is changed.

2. **Live**, started by a person and never by automation: run the app with
   `ANCIENT_ROSTER_DEBUG=1` and its standard error saved. The log names counts and statuses,
   never player IDs, names or tokens. Check, in this order: a watched match (ten players
   match the game), an own match through the draft (picks, bans, lanes), and post-game (the
   recorded match keeps its roster).
3. If a check fails, keep reading off, report the game build (`game/dota/steam.inf`) and the
   failing step. Do not replace discovery with fixed offsets.

## Verified builds

| Reader | Platform | Evidence                                                                                                                  |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Rating | Windows  | Live on the October 14, 2026 build; offline on build 6969                                                                 |
| Rating | Linux    | Live on build 6962 (October 19 and 23, 2026)                                                                              |
| Roster | Linux    | Live in spectator mode and as a participant (October 13–14, 2026)                                                         |
| Roster | Windows  | Offline on build 6969; live while watching a match (October 28, 2026) and as a participant (October 29, 2026), build 6969 |
| Draft  | Windows  | Live during an own role-queue ranked hero selection on build 6969 (October 29, 2026): picks, hovers, bans, lanes          |

Synthetic tests cover the shared logic on both systems. None of this establishes behaviour on
future builds or the anti-cheat response.
