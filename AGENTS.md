# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, OpenCode, Pi, etc.) working in this repository. `CLAUDE.md` is a symlink to this file, so edit `AGENTS.md` only.

## Project

**agent-speak** researches, and will later build, an AI agent and our own agent harness/SDK. The first agent is a personal cloud coding agent for the owner, deployed on Cloudflare first, with the SDK and harness also proved on AWS and Vercel ([coding agent plan](docs/plans/build-coding-agent.md)). The repo is mostly documentation. The only code is the per-SDK verification harnesses under `verify/`.

## Layout

- `README.md`: project overview and doc index.
- `docs/reference/<sdk>/`: per-SDK reference (`guide.md`, `fact-check.md`, `README.md`). `source/` holds mirrored upstream docs. The Pi mirror is committed (MIT); the Claude mirror is gitignored because those docs are not openly licensed, so regenerate it with `pnpm run fetch-docs`.
- `verify/<sdk>/`: per-SDK verification harness (Node, exact-pinned deps). `pnpm run verify` type-checks and runs doc examples against a mock model; `pnpm test` runs our own examples in `examples/`. Generated folders (`extracted/`, `.tmp/`) are gitignored, while `results/` is committed.
- `.github/workflows/`: `ci.yml` runs `pnpm check`, `pnpm typecheck`, `pnpm test` and the results-drift check (`scripts/ci/results-drift.mjs`) on every push; `verify.yml` runs every harness's full verify and `pnpm audit` nightly.
- `docs/decisions/`: architecture decision records (ADRs) for lasting choices in the build plans; the format is in its README.
- `docs/plans/`: the plans and the [roadmap](docs/plans/roadmap.md); each plan starts with a status line and lists its todos.
- `docs/todos/`: the todo board. A todo's folder (`ready/`, `ongoing/`, `done/`) is its state; new todos start from `docs/todos/TEMPLATE.md`.
- `.agents/skills/`: agent skills, one folder per skill with a `SKILL.md` (frontmatter `name` and `description`); the format is in its README. `.claude/skills` is a relative symlink to it, so edit `.agents/skills/` only.
- `docs/comparison/`: the SDK feature table and the deep comparison.
- `docs/research/`: research reports.
  - `agent-sdks-and-harness-design.md`: the main report (SDK comparison, reference architecture, build-vs-buy).
  - `agent-ui/`: how agent UIs are built (protocols, web frameworks, terminal and editor UIs, patterns beyond chat), the UI contracts of our eight SDKs, Vercel Labs' UI SDK (`vercel-ui-sdk.md`), undo for agent edits (`undo-agent-edits.md`), hashbrown (`hashbrown.md`) and Copilot's diff review (`copilot-diff-review.md`).
  - `reversible-actions/`: making agent actions safe to fail, retry or reverse: server-side rollback (`server-rollback.md`), sagas for multistep actions (`sagas.md`) and agent rewind versus data rollback (`rewind-vs-rollback.md`). Each report has its own `fact-check-*.md`.
  - `external-designs/`: outside agent designs read against our own: 12-factor agents (`twelve-factor-agents.md`) and the Strands harness SDK (`strands-harness-sdk.md`). Each report has its own `fact-check-*.md`.
  - `deployment/`: deploying our agents anywhere: portable agents and cloud coding agents (`portable-agents.md`), the storage-and-wake problem behind its seams (`storage-and-wake.md`), and the market for agent-building platforms (`agent-building-platforms.md`). Each report has its own `fact-check-*.md`.
  - `harness-architectures.md`: source-level notes on Pi, Codex, OpenAI Agents SDK sandbox agents and Cloudflare Agents/Think.
  - `fact-check-2026-11-18.md`: verification log for the main report.
  - `notes/`: raw research notes behind the report. Treat them as working material; the report and fact-check log supersede them where they disagree.

## Working from the plans

- Pick the next todo whose **Depends on** are all in `docs/todos/done/`, following the [roadmap](docs/plans/roadmap.md).
- Do each todo on its own branch and pull request (see [Git](#git)). Move the todo to `ongoing/` in the first commit and to `done/` in the last, and push the branch after each meaningful step.

## Every document is drafted, fact-checked and reviewed before it merges

Every document goes through the same five steps before it merges, whoever or whatever drafted it (the owner's rule, 2026-11-18). Later agents act on these documents, so a wrong version number or an unclear rule costs them real work.

1. **Draft** with `/anthropic-skills:writing`. Use it for every new document and every rewrite, including fixes after a review. A draft from another tool, such as a research skill's report writer, stays unreviewed until it has been through steps 2–5.
2. **Fact-check** every factual claim against its primary source: the repo at a recorded tag or commit, the pinned `.d.ts`, the official docs or the paper. Log each claim in the round's fact-check file as ✅ confirmed, ✏️ corrected or ⚠️ unverified, with the reason. Correct a wrong claim in place and give the correction its own row, so every change stays visible.
3. **Review** the whole document with `/anthropic-skills:writing-review`, not just the changed parts.
4. **Fix** every finding with `/anthropic-skills:writing`, or record why you left it.
5. **Re-check** every claim a fix touched against its source, and confirm that every relative link and anchor resolves.

Record the review's rubric scores, before and after, in the pull request description.

Four rules apply to every claim in every document:
- Cite a source for each factual claim, and prefer primary sources (official docs, repos, papers) over blogs.
- Mark claims taken from search summaries or secondary write-ups as such.
- Write "as of <month year>" for versions, star counts and spec status, because they change fast.
- Use kebab-case filenames under `docs/`.

## Planned architecture (when code starts)

Follow the reference architecture in `docs/research/agent-sdks-and-harness-design.md`, with the refinements in `docs/research/fact-check-2026-11-18.md`:

1. Model gateway: streaming, retries, prompt caching, cost accounting.
2. Stateless harness loop with explicit stop conditions and hooks (before/after model step, before/after tool call, context transform, steering queue).
3. Append-only, tree-shaped session event log.
4. A small set of well-designed tools, plus an MCP client.
5. Layered context policy: between-turn, mid-turn and overflow-retry compaction.
6. File-based memory first.
7. Sandbox behind a pluggable interface, with separate sandbox and approval policies and no credentials inside the sandbox.
8. OTel `gen_ai.*` spans and an eval suite that measures against a mini-swe-agent baseline.

Each component should be removable so it can be ablated as models improve.

The SDK and harness must run on four targets, local Node, Cloudflare, AWS and Vercel, and every implementation of a portable seam must pass one conformance suite ([ADR 0033](docs/decisions/0033-three-deployment-targets.md)). Keep the loop outside the sandbox, and keep credentials out of it ([ADR 0036](docs/decisions/0036-loop-outside-sandbox-and-pr-approval.md)).

## Process for documenting an SDK

Every SDK reference follows the same eight steps. `docs/reference/claude-agent-sdk/` and `verify/claude-agent-sdk/` are the worked example; copy their layout and scripts.

1. **Research.** Find the official docs site, the source repo, the npm packages and the license. Pin one release. If the docs site renders the repo's main branch, mirror from the git tag that matches the pinned npm version, and record any pages where the live site runs ahead of the release.
2. **Mirror the docs.** Write `verify/<sdk>/scripts/fetch-docs.mjs` so the mirror can be regenerated, and record the source URL, tag or commit, and fetch date in `source/_manifest.json`. Include runnable examples the docs link to. Commit the mirror only when the license allows redistribution (MIT, Apache-2.0); otherwise gitignore `source/`. Skip compiled binaries.
3. **Lay out the folders.** `docs/reference/<sdk>/` holds `README.md` (index, pinned version, how to regenerate), `guide.md`, `fact-check.md` and `source/`. `verify/<sdk>/` holds `package.json` with exact pins, `scripts/`, `examples/`, `fixtures/` and `results/`.
4. **Verify the examples, in tiers.**
   - Extract every TypeScript block, then type-check each one against the pinned package and classify the errors (pass, fragment, signature, syntax, API mismatch).
   - Run every complete, type-clean block offline against a mock model. Prefer the SDK's own test provider (for example pi-ai's `fauxProvider`); otherwise mock the HTTP API through the SDK's base-URL setting.
   - Diff the documented API surface (functions, options, unions, message types) against the package's `.d.ts` files or source.
5. **Write behavioral examples.** Add small programs in `verify/<sdk>/examples/`, each asserting one documented behavior, plus a capstone that builds a complete agent. `pnpm test` must pass offline.
6. **Write the reference.** Draft `guide.md` and `fact-check.md` with the `/anthropic-skills:writing` skill: thesis-first introductions, headings that state conclusions, one term per concept, endings on the conclusion or action.
7. **Review.** Run `/anthropic-skills:writing-review` on both documents.
8. **Fix and ship.** Apply the review fixes. Re-check every changed claim against the source, rerun `pnpm run verify`, then commit and push.

Rules that apply throughout:
- Pin SDK versions exactly in `verify/<sdk>/package.json`; reference docs state the version they were checked against.
- Mark guide claims backed by a runnable example as **[verified]**, and cite the upstream page for everything else.
- Mock models must never call tools that touch the host (shell, file edits). Read-only tools inside a temp directory are allowed. Some SDKs expose host tools as ordinary function tools (OpenAI's sandbox `exec_command`), so deny them by name as well as by type.
- When a check fails, decide whether the docs, the SDK or the harness is wrong before recording a finding. Fix harness bugs and wrong examples of our own; record only real docs or SDK issues.

## Coding standards

The repo is a pnpm workspace. Run every command from the repo root unless a README says otherwise.

- **Toolchain.** Node 22 (`.nvmrc`) and pnpm 10.28.0 (`packageManager` in `package.json`). Install with `pnpm install` at the root; never use npm or yarn, and never commit a `package-lock.json`.
- **Workspace layout.** `pnpm-workspace.yaml` lists `verify/*`. Shared dev tools (TypeScript, tsx, `@types/node`, Biome) live in the root `package.json`. Each package declares only the runtime dependencies it imports, because pnpm does not hoist undeclared packages.
- **Versions.** Pin every dependency exactly (`.npmrc` sets `save-exact`). Choose releases at least one week old (changed from two weeks on 2026-11-18). One exception overrides the age rule: when a pinned dependency has a known vulnerability, move it to the latest release that fixes it, however new, and record the alert in the upgrade commit. Allow dependency build scripts only through `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
- **TypeScript.** ESM everywhere (`"type": "module"`). Packages extend `tsconfig.base.json` (strict, ES2024). Harness scripts are `.mjs`; example programs are `.ts`, run with tsx.
- **Lint and format.** Biome checks JS, TS and JSON (`biome.json`): 2-space indent, double quotes, semicolons, trailing commas, 120 columns. Biome skips Markdown and mirrored upstream sources. `noExplicitAny` is off only in `verify/*/examples`.
- **Tool paths.** Never hard-code `node_modules` paths. Resolve tools with `import.meta.resolve("tsx")` or by walking up to the nearest `node_modules/.bin`.
- **Running third-party code.** Spawn it with an allowlisted environment (`PATH`, a temp `HOME`, `TMPDIR`, `LANG` plus what the run needs), never `...process.env`, and block outbound network where the harness allows. Inherited credentials once sent a doc example to a real provider.
- **Before you commit.** `pnpm check`, `pnpm typecheck` and `pnpm test` must pass.

## Git

- **One pull request per piece of work** (changed from direct pushes to `main` on 2026-11-18). Branch from the latest `main`, named for the work (`todo/<id>-<slug>`, or `docs/<slug>` for work without a todo), push the branch, and open a pull request against `main`.
- **Squash-merge when ready:** CI (`ci.yml`) passes, the todo's definition of done is met, and review findings are fixed. The squash commit's message is the PR title plus a summary of the change. Delete the branch after the merge; this session's token cannot delete remote branches, so the owner deletes them or turns on the repository's "Automatically delete head branches" setting.
- Snapshots of unfinished work go to the work's own branch, not to separate `wip/*` branches.
- Commit messages: imperative mood, with a short summary line.
- Never commit secrets or `.env` files.
