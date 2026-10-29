# Contributing

Thanks for helping. Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
Start with the [installation guide](docs/guide/install.md), the
[architecture](docs/dev/architecture.md) and [status](docs/status.md). Issues labelled
`good first issue` are small and self-contained; `help wanted` marks larger work.

## Workflow

1. **Discuss first** for anything beyond a small fix: comment on an issue or open one, so two
   people do not build the same thing differently.
2. **Branch** from `main`: `feat/…`, `fix/…`, `docs/…`, `test/…`, `perf/…`, `ci/…`.
3. **One topic per pull request.** Refactoring and behaviour changes go in separate commits.
4. **Commits** use [Conventional Commits](https://www.conventionalcommits.org/): `feat(profile):
…`, `fix(roster): …`. The body says why, not only what.
5. **Pull request**: fill in the template; say what changed for the user, which checks you ran
   on which platform, and what you could not verify.
6. A maintainer reviews and squash-merges. CI must pass.

## Rules

- **Fair-play boundary.** Ancient Lens shows public statistics and the player's own match. Do
  not add anything that sends input to the game, automates play, writes game memory, injects
  code, hooks the game's rendering, or reveals information the game hides (for example player
  identities during hero selection, or anything under the fog of war). Such changes are not
  accepted. See [safety and fair play](docs/guide/fair-play.md).
- **Both platforms.** Windows and Linux are equal targets. A change behind
  `#[cfg(target_os = …)]` or a platform check in the page either covers both systems in the
  same pull request, or adds the gap to the platform table in the README and to
  [status](docs/status.md). Platform code stays a thin layer; parsing and logic build and are
  tested on both systems.
- **Unknown stays unknown.** Never show a guessed value as data. A missing field is a dash,
  not a zero, and every displayed number says where it comes from.
- **Memory readers** stay read-only and opt-in. Changes need the offline checks of the
  [native reader guide](docs/dev/native-reader.md#after-a-game-update); a live check needs a
  person who starts the game and consents, never automation.
- **No private data.** Do not commit tokens, generated GSI configurations, personal state,
  exports, captures, proprietary binaries or research archives. Fixtures and screenshots use
  invented players and synthetic IDs.
- **English** for code comments, interface text, documentation and pull requests.
  User-entered names and notes may use any language.
- **Changelog.** A user-visible change adds a line under _Unreleased_ in
  [CHANGELOG.md](CHANGELOG.md). A behaviour change updates the affected guide.
- **Dependencies.** Keep the lockfiles. A new dependency needs a reason in the pull request.
  Preserve third-party attribution and licenses.

## Checks

| Change             | Run                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------- |
| Any                | `npm ci`, `npm run check`, `npm run format:check`, `npm run check:public`                    |
| Rust               | `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `npm run test:rust`                |
| Statistics service | `cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --bin stats-service` |
| Launcher scripts   | `python3 -m unittest discover -s tests/python` (`py -3` on Windows)                          |
| UI or desktop      | `npm run build` and `npm run test:native` on each platform you can reach                     |
| Memory readers     | The offline game-file tests in the [native reader guide](docs/dev/native-reader.md)          |
| Screenshots        | `npm run build`, then `npm run docs:screenshots` ([details](docs/README.md#screenshots))     |

`npm run test:rust` builds the web assets first, because Tauri embeds them when the crate
compiles; a direct `cargo test` needs an earlier `npm run build:web`.
`npm run format` and `cargo fmt --manifest-path src-tauri/Cargo.toml` format your changes.
The optional pre-push hook runs the main checks: `git config core.hooksPath .githooks`.
Ordinary tests use fixtures, need no API keys and never start Dota. See
[verification](docs/dev/verification.md) for the native drivers.
For version files, documentation screenshots and draft publication, follow
[release preparation](docs/dev/releases.md).

## AI-assisted contributions

Welcome, under the same rules. Agents follow [AGENTS.md](AGENTS.md); the person opening the
pull request is responsible for it and must have read the change. Project MCP setup for Claude
Code, Codex and OpenCode is in [AI development tools](docs/dev/ai-tools.md).

## Security

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md), not in a public
issue. Public pull requests run on GitHub-hosted runners only.
