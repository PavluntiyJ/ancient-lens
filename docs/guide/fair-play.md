# Safety and fair play

Ancient Lens shows statistics about the players and heroes of your match, as public statistics
sites do, in a window next to the game. This page states exactly what it does and does not do,
so you can decide for yourself. It is not legal advice and makes no promise about how Valve's
anti-cheat treats any tool.

## What the app does not do

- It does not play for you: no keyboard or mouse input is sent to the game, no actions are
  automated, and nothing reacts to the game on your behalf.
- It does not modify the game: no game files are changed apart from the Game State
  Integration (GSI) file and launch option it installs with your consent (see below), no code
  is injected, no game memory is written, and no game function is called.
- It does not draw into the game. Ancient Lens is an ordinary desktop window; it is not an
  overlay hooked into the game's rendering.
- It does not reveal what the game hides from you. During hero selection, when names are
  hidden in ranked drafts, the optional reader takes only picks, hovers, lanes and bans; it
  reads player identities only after hero selection, when the game shows them.
- It does not show enemy positions, cooldowns, items in the fog, or any other live game state
  that you could not see yourself.

## Where the data comes from

| Source                         | What it gives                                                                | How                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Valve's Game State Integration | Match ID, phase, your hero and statistics; all ten players when you spectate | An official, documented interface: the game sends events to `127.0.0.1` |
| OpenDota and STRATZ            | Public match history, ranks and hero statistics of public profiles           | Their public APIs; private profiles stay private                        |
| The running game (optional)    | The roster and draft of your own match; your exact MMR and confidence        | Read-only access to the game process, off by default                    |

Everything shown about other players comes from their public profiles or from what the match
shows you. A player with a private profile appears as private.

## The optional memory reader

GSI sends only your own player when you play, so the ten-player table of your own match and
your exact rating need the optional reader. It is **off by default**, and nothing reads the
game process until you enable **Allow Dota memory reading** in Settings.

- The process is opened for reading and querying only. On Windows the handle has no write or
  execute rights; on Linux the kernel's `process_vm_readv` is used.
- Addresses come from the game's own type information, checked on every start; an unknown
  layout stops the reader instead of guessing.
- How it works in detail: [native reader guide](../dev/native-reader.md).

**The risk is yours to judge.** External reading of a game's memory is a technique that
anti-cheat systems can observe, and Valve has published no statement about tools like this.
Ancient Lens cannot guarantee that enabling the reader is without consequences for your
account. If that matters to you, keep it off: everything else works without it.

## Game setup

Settings → Connect Dota 2 installs Ancient Lens's GSI file in the game's
`cfg/gamestate_integration` folder and adds the `-gamestateintegration` launch option, with a
backup of Steam's settings. These are Valve's documented integration points; nothing else in
the game folder is changed. You can remove both at any time.

## Your data

There is no account, no telemetry and no analytics. Notes, ratings and settings stay on your
computer ([storage and privacy](setup.md#storage-and-privacy)). Network requests go to the
statistics providers and the Steam CDN for portraits; the optional STRATZ token stays in the
local statistics service, never in the app window.

## Legal

Ancient Lens is an independent project under the MIT license and is not affiliated with or
endorsed by Valve. Dota 2 and its artwork are Valve's; statistics come from providers under
their own terms; bundled third-party assets keep their licenses
([third-party notices](../../THIRD_PARTY_NOTICES.md)). Whether using a tool like this agrees
with the game's terms of use is for each player to decide; this page does not settle that.
