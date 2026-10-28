# AI development tools

The repository configures one local MCP server for Claude Code, Codex, and
OpenCode 2: Context7, for version-specific library documentation. Models use it
through their client; the configuration does not depend on a particular model.

## Setup

Run `npm ci`, then start your AI client **from the repository root**. The server
uses the pinned package in `node_modules`; no global MCP installation is needed.

| Client      | Project configuration | Check                                    |
| ----------- | --------------------- | ---------------------------------------- |
| Claude Code | `.mcp.json`           | `claude mcp list`, then `/mcp` in Claude |
| Codex       | `.codex/config.toml`  | `codex mcp list`, then `/mcp` in Codex   |
| OpenCode 2  | `opencode.json`       | `opencode mcp list`                      |

Restart an existing AI session to load the server. Claude may ask you to approve
project MCP servers on first use. Codex loads project configuration only for
trusted projects. OpenCode uses the `mcp.servers` configuration shape from its
current schema.

## Suggested use

- Ask Context7 for documentation matching the versions in `package.json` and
  `src-tauri/Cargo.lock`; do not assume examples for the latest version match.
- Check UI changes in the real app with `scripts/native-capture.mjs` (WebKitWebDriver
  on Linux, CDP on Windows): it starts the release build with an isolated
  `ANCIENT_TEST_DATA` directory and can run scripts, click, and take screenshots.
  `scripts/docs-screenshots.mjs` is a complete example.
- Use synthetic data for automated interactions. Do not use personal notes,
  ratings, Steam setup, or a live Dota match as fixtures.

Context7 requires internet access and sends documentation queries to its service.
Its local OpenTelemetry instrumentation is disabled in all three client configs.
Anonymous use may be rate limited. If it requests authentication, follow the
[Context7 setup instructions](https://github.com/upstash/context7) and keep any
API key in your local environment (`CONTEXT7_API_KEY`), never in these files.

## Why there is no Tauri MCP

Tauri MCP (`tauri-plugin-mcp-bridge` 0.13.2) was tried on October 24, 2026 and
removed. Its bridge accepts any WebSocket connection on its loopback port without
an Origin check or token, so any web page open in the browser could drive the app
while the bridge ran. It also needed a separate build without the content
security policy. The native capture script already covers DOM inspection and
screenshots without either.

References: [Claude project MCP configuration](https://code.claude.com/docs/en/mcp),
[Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp), and
[OpenCode configuration schema](https://opencode.ai/config.json).
