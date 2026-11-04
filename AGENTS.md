# Ancient Lens

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the project; its rules, including the
fair-play boundary and the platform rule, apply to agents unchanged. Known limitations and
plans are in [docs/status.md](docs/status.md); the [architecture](docs/dev/architecture.md)
maps the source.

## Taking a task

- Work from one issue, preferably labelled `agent-ready`: it states the files, the expected
  result and how to verify it. Do not widen the scope; note related problems in the pull
  request instead.
- Use a branch per issue, ideally in its own `git worktree`, because other people or agents
  may work in the same checkout. Preserve unrelated working-tree changes and stage only your
  own hunks.
- Never push to `main`; open a pull request that links the issue.

## Development tools

Project MCP configuration is available for Claude Code, Codex, and OpenCode 2. See
[AI development tools](docs/dev/ai-tools.md) for setup and limits.

- Use Context7 for version-specific library documentation when available.
- Start AI clients from the repository root after `npm ci`.
- Check UI changes in the real app with `scripts/native-capture.mjs` and an isolated
  `ANCIENT_TEST_DATA` directory.
- Use isolated synthetic app data for automation. Do not change personal notes, ratings,
  Steam settings, or a live Dota match as a test, and never start Dota.

## Finishing

- Run the checks of the table in CONTRIBUTING for every area you touched and put their results
  in the pull request, with the platform they ran on and what was not run.
- A change that only builds or works on one system must say so; the platform rule decides
  whether it can merge.
