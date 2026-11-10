# Ancient Lens

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the project. Its workflow, rules and
check table apply to agents unchanged; this file adds agent-specific guidance and does not
replace it.

## Boundaries

- Never send input to Dota, automate play, write game memory, inject code, hook rendering, or
  expose information the game hides. Memory reading stays read-only and opt-in. Automation
  never starts Dota.
- Use isolated synthetic app data for automation. Never use personal notes, ratings, Steam
  settings, credentials, or a live Dota match as test data.
- Keep secrets and personal data out of commits, exports, screenshots and logs.

## Taking a task

- Work from one issue, preferably labelled `agent-ready`: it states the files, the expected
  result and how to verify it. Do not widen the scope; note related problems in the pull
  request instead.
- Take routine file choices and implementation details from the issue and nearby code. Ask
  only when a material requirement or decision is missing and the repository cannot settle it.
- Follow nearby code for conventions unless it conflicts with CONTRIBUTING.md, the agreed
  requirements, or a rule in this file. Do not copy an existing violation; report it.
- Use a branch per issue, ideally in its own `git worktree`, because other people or agents
  may work in the same checkout. Preserve unrelated working-tree changes and stage only your
  own hunks.
- Never push to `main`; open a pull request that links the issue and fills in the template.
  Do not merge it, enable auto-merge, tag or publish a release unless the task explicitly
  authorizes that action.

## Finding the right guidance

Read the guide a task needs, not all of them.

- [Architecture](docs/dev/architecture.md): processes, source map, IPC and storage boundaries.
- [Status](docs/status.md): known limitations and platform gaps.
- [Verification](docs/dev/verification.md): choosing a static, DOM or native test, and what
  [isolated mode](docs/dev/verification.md#isolated-mode) changes.
- Game-facing changes: [safety and fair play](docs/guide/fair-play.md). Reader changes: also
  the [native reader guide](docs/dev/native-reader.md) and its offline checks.
- Release work: [release preparation](docs/dev/releases.md).
- MCP setup and limits: [AI development tools](docs/dev/ai-tools.md). Do not add a Tauri MCP
  bridge; that guide says why.
- Use Context7 for version-specific library documentation when available, for the versions
  in `package.json` and the lockfiles.

## Working and checking

- Start AI clients from the repository root after `npm ci`.
- Carry the agreed implementation, its checks and the fixes they call for through to the end
  without asking for approval at each routine step. Ask when the work needs a decision or an
  action outside the agreed scope or authorization.
- Use focused checks while developing. Before the pull request, run every row of the
  [check table](CONTRIBUTING.md#checks) that applies to the areas you touched.
- Check UI changes in the real app after `npm run build`. `npm run test:native` (on a KDE
  desktop, `npm run test:native:kde`) guards against regressions; it does not show your
  change. Look at the changed screen itself through the driver in
  `scripts/native-capture.mjs` with an isolated `ANCIENT_TEST_DATA` directory;
  `scripts/docs-screenshots.mjs` is a complete example.
- Isolated runs touch no personal Steam data and no live provider. Feed them through the
  fixture inputs of [isolated mode](docs/dev/verification.md#isolated-mode); do not turn
  those into live-provider access.

## Finishing

- Complete the acceptance criteria and fix the failures your change caused. Report a real
  blocker instead of presenting unfinished work as complete.
- Put the check results in the pull request, with the platform they ran on and what was not
  run. Never claim a Windows or Linux check you did not run.
- A change that only builds or works on one system must say so; the platform rule decides
  whether it can merge.
