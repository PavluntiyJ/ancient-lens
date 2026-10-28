# Ancient Lens

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the project. Known
limitations and plans are in [docs/status.md](docs/status.md); the
[architecture](docs/dev/architecture.md) maps the source. Preserve existing unrelated
working-tree changes.

## Development tools

Project MCP configuration is available for Claude Code, Codex, and OpenCode 2.
See [AI development tools](docs/dev/ai-tools.md) for setup and limits.

- Use Context7 for version-specific library documentation when available.
- Check UI changes in the real app with `scripts/native-capture.mjs` and an
  isolated `ANCIENT_TEST_DATA` directory.
- Start AI clients from the repository root after `npm ci`.
- Use isolated synthetic app data for automation. Do not change personal notes,
  ratings, Steam settings, or a live Dota match as a test.
