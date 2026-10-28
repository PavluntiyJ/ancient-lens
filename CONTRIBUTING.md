# Contributing

Start with the [installation guide](docs/guide/install.md) and
[status](docs/status.md). Use English for code comments, interface text,
documentation, issue templates, and pull-request descriptions. User-entered
player names and notes may use any language.

Claude Code, Codex, and OpenCode project MCP setup is documented in
[AI development tools](docs/dev/ai-tools.md).

Create a branch, make a focused change, and explain the user-visible result and
how you verified it. Keep the lockfiles. Do not commit tokens, generated GSI
configurations, personal state, exports, captures, proprietary binaries, or local
research archives. Use invented player names and synthetic IDs in fixtures and
screenshots. Preserve third-party attribution and font licenses.

```sh
npm ci
npm run check
npm run check:public
npm run format:check
cargo fmt --manifest-path src-tauri/Cargo.toml --check
npm run test:rust
python3 -m unittest discover -s tests/python
cargo check --manifest-path src-tauri/Cargo.toml --no-default-features --bin stats-service
```

For desktop changes, also run `npm run build && npm run test:native` on the target
platform. See [verification](docs/dev/verification.md) for drivers and opt-in live
tests. Ordinary tests use fixtures, require no API keys, and must not start Dota.
Only run a live-game probe with the game owner's consent. Unknown fields should
remain unknown; do not infer missing data or treat fixture success as live proof.

Run `npm run format` and `cargo fmt --manifest-path src-tauri/Cargo.toml` to format
changes. The optional local pre-push hook can be enabled using
`git config core.hooksPath .githooks`; this is not required to contribute.

Public pull requests run on GitHub-hosted runners. Do not configure public PR
workflows to run on a personal/self-hosted machine. Report security problems
using [SECURITY.md](SECURITY.md), not a public issue containing exploit details
or private data.
