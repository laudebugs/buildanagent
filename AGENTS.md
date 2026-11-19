# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, OpenCode, Pi, etc.) working in this repository. `CLAUDE.md` is a symlink to this file, so edit `AGENTS.md` only.

## Project

**buildanagent** researches, and will later build, an AI agent and our own agent harness/SDK. The first agent is a personal cloud coding agent for the owner, deployed on Cloudflare first, with the SDK and harness also proved on AWS and Vercel ([coding agent plan](docs/plans/build-coding-agent.md)). After it comes a multi-user platform that turns a user's description into a checked agent deployed in the user's own cloud ([agent platform plan](docs/plans/build-agent-platform.md)). The gateway and SDK publish to npm under `@buildanagent`, from 0.1.0 once a model call works, and their docs go to `docs.buildanagent.fyi` ([publish and docs plan](docs/plans/publish-and-docs.md)). The repo is mostly documentation. Our own code lives in `packages/` (the gateway and SDK, scaffolded empty in todo B1); the only other code is the per-SDK verification harnesses under `verify/`.

## Layout

- `README.md`: project overview and doc index.
- `docs/reference/<sdk>/`: per-SDK reference (`guide.md`, `fact-check.md`, `README.md`). `source/` holds mirrored upstream docs. The Pi mirror is committed (MIT); the Claude mirror is gitignored because those docs are not openly licensed, so regenerate it with `pnpm run fetch-docs`.
- `packages/`: our own packages. `gateway/` is `@buildanagent/gateway` (the model gateway) and `sdk/` is `@buildanagent/sdk` (the loop over it); the harness plan adds `packages/harness` and others beside them. Each package runs `tsc -p` for `typecheck`, Vitest (`vitest run`) for `test` ([ADR 0046](docs/decisions/0046-vitest-test-runner.md)) and `tsc -p tsconfig.build.json` for `build`, which writes `dist/`. `pnpm build` builds every package in dependency order, and `pnpm --filter "<package>..." build` builds one package after its workspace dependencies (building the SDK alone fails until the gateway has a `dist/`). Tests and type-checks need no build: a `source` export condition points them at `src/` ([ADR 0050](docs/decisions/0050-dist-build-with-source-condition.md)). Each package's `vitest.config.ts` loads `test/setup.ts`, which imports `@buildanagent/gateway/testing/setup` before every test file; the setup blocks non-loopback `fetch`, fails if a provider key variable is set and turns real model requests off.
- `apps/`: deployable sites (planned). `docs/` (`@buildanagent/docs`, Starlight, docs.buildanagent.fyi) and `site/` (`@buildanagent/site`, buildanagent.fyi) come from the [publish-and-docs plan](docs/plans/publish-and-docs.md) ([ADR 0048](docs/decisions/0048-docs-on-astro-starlight.md), [ADR 0049](docs/decisions/0049-two-sites-on-cloudflare.md)). `book/` will be `@buildanagent/book`, the public textbook at manual.buildanagent.fyi, built in Round T from the [book plan](docs/plans/build-book.md) ([ADR 0051](docs/decisions/0051-book-in-apps-on-cloudflare.md)); its listings come from `verify/*/examples` until our own packages replace them.
- `verify/<sdk>/`: per-SDK verification harness (Node, exact-pinned deps). `pnpm run verify` type-checks and runs doc examples against a mock model; `pnpm test` runs our own examples in `examples/`. Generated folders (`extracted/`, `.tmp/`) are gitignored, while `results/` is committed.
- `.github/workflows/`: `ci.yml` runs `pnpm check`, `pnpm typecheck`, `pnpm test`, the CI scripts' tests (which build and pack both packages), the results-drift check (`scripts/ci/results-drift.mjs`), `gh actions-lock --verify` and a warning for stale price-catalog entries (`scripts/ci/catalog-staleness.mjs`) on every push. Its `changesets` job, off until the first release, fails a change to a package's `src/`, `package.json` or `tsconfig.build.json` without a changeset. `verify.yml` runs every harness's full verify and `pnpm audit` nightly. `sdk-updates.yml` runs weekly. It finds SDK releases at least a week old for each `verify/*` harness, then opens one pull request per harness with its verify result (`scripts/ci/sdk-updates.mjs`). `release.yml` publishes the gateway and SDK to npm through trusted publishing when a push to `main` carries a version npm lacks, with no npm token anywhere; a `workflow_dispatch` is a dry run that only builds and packs, and its "Version packages" pull request stays off until L4b ([CI plan §3f](docs/plans/ci.md#3f-releases-through-npm-trusted-publishing-added-2026-11-19)). Every action is locked by `.github/workflows/actions.lock`: a `uses:` line names a tag, and the lockfile holds its commit ([CI plan §3d](docs/plans/ci.md#3d-actions-locked-by-a-lockfile-added-2026-11-19)).
- `.changeset/`: Changesets' config (`config.json`) and pending changesets. The gateway and SDK version as one fixed group; `README.md` gives the 0.x rule.
- `docs/guidelines/`: the coding and documentation rules for `packages/`: TypeScript (`typescript.md`), maintainability (`maintainability.md`), testing (`testing.md`), reader-facing docs (`docs-writing.md`) and examples (`examples.md`), adapted from the owner's Lamina PDF repo.
- `docs/design/`: design tokens as data, the source the apps generate their styles from: `book-tokens.json` for `apps/book` (colours with their measured contrast, fonts and sizes).
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
  - `agents/`: research for agents we might build on our stack: a job-search agent (`job-search-agent.md`). Each report has its own `fact-check-*.md`.
  - `browser-use/`: how our agents should use a web browser (`browser-use.md`): page representations, hosted browsers, vendor computer-use tools, browser security, evals and proposed plan changes. It has its own `fact-check-browser-use.md`.
  - `connectors/`: connectors for our agents and platform (`agent-connectors.md`): how platforms offer them, MCP authorization and token custody, build-or-buy infrastructure and a recommended design. It has its own `fact-check-*.md`.
  - `harness-architectures.md`: source-level notes on Pi, Codex, OpenAI Agents SDK sandbox agents and Cloudflare Agents/Think.
  - `fact-check-2026-11-18.md`: verification log for the main report.
  - `source-update-2026-11-19.md`: what fourteen owner-chosen sources, most of them seeds the first round could not fetch, add to the main report, with proposed plan changes. It has its own `fact-check-source-update-2026-11-19.md`.
  - `notes/`: raw research notes behind the report. Treat them as working material; the report and fact-check log supersede them where they disagree.

## Working from the plans

- Pick the next todo whose **Depends on** are all in `docs/todos/done/`, following the [roadmap](docs/plans/roadmap.md).
- Do each todo on its own branch and pull request (see [Git](#git)). Move the todo to `ongoing/` in the first commit and to `done/` in the last work commit, before you open the pull request. The review-fix commits that follow may tick the todo's review checkboxes and update its outcome, but they don't move it back. Push the branch after each meaningful step.

## Every document is drafted, fact-checked and reviewed before it merges

Every document goes through the same five steps before it merges, whoever or whatever drafted it (the owner's rule, 2026-11-18). Later agents act on these documents, so a wrong version number or an unclear rule costs them real work.

1. **Draft** with `/anthropic-skills:writing`. Use it for every new document and every rewrite, including fixes after a review. A draft from another tool, such as a research skill's report writer, stays unreviewed until it has been through steps 2–5.
2. **Fact-check** every factual claim against its primary source: the repo at a recorded tag or commit, the pinned `.d.ts`, the official docs or the paper. Log each claim in the round's fact-check file as ✅ confirmed, ✏️ corrected or ⚠️ unverified, with the reason. Correct a wrong claim in place and give the correction its own row, so every change stays visible.
3. **Review** the whole document with `/anthropic-skills:writing-review`, not just the changed parts.
4. **Fix** every finding with `/anthropic-skills:writing`, or record why you left it.
5. **Re-check** every claim a fix touched against its source, and confirm that every relative link and anchor resolves.

Record the review's rubric scores, before and after, in the pull request description.

**A long document is fact-checked section by section** (the owner's rule, 2026-11-19: "We'll always write copy with /writing and review with /writing-review and fix any issues from that review. As well, we should always run a fact check after each chapter/section is written."). Each section of a book chapter or of a long report is fact-checked as soon as it is written, before the next section is drafted, not only at the end. Step 3's review then reads the whole document, and steps 4 and 5 still apply. The book's workflow is in its plan ([BK21](docs/plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted)).

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

The agent platform serves other users from the start, so tenant isolation applies to every platform component: no tenant credential enters a sandbox, generated code runs only in a fresh hosted sandbox, and no deploy proceeds without a passing gate report for its commit ([ADR 0037](docs/decisions/0037-multi-user-agent-platform.md), [ADR 0039](docs/decisions/0039-check-and-deploy-gate.md), [ADR 0042](docs/decisions/0042-generated-code-isolation.md)).

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
7. **Open the pull request and review it.** Rerun `pnpm run verify`, open the pull request, and run the [two code-review rounds](#every-pull-request-gets-two-rounds-of-code-review) on it, harness code included.
8. **Writing review, fix and ship.** Once the code is final, run `/anthropic-skills:writing-review` on `guide.md`, `fact-check.md` and the pull request description, apply the fixes, re-check every changed claim against the source, and merge under the [Git](#git) rules.

Rules that apply throughout:
- Pin SDK versions exactly in `verify/<sdk>/package.json`; reference docs state the version they were checked against.
- Mark guide claims backed by a runnable example as **[verified]**, and cite the upstream page for everything else.
- Mock models must never call tools that touch the host (shell, file edits). Read-only tools inside a temp directory are allowed. Some SDKs expose host tools as ordinary function tools (OpenAI's sandbox `exec_command`), so deny them by name as well as by type.
- When a check fails, decide whether the docs, the SDK or the harness is wrong before recording a finding. Fix harness bugs and wrong examples of our own; record only real docs or SDK issues.

## Coding standards

The repo is a pnpm workspace. Run every command from the repo root unless a README says otherwise.

- **Toolchain.** Node 22 (`.nvmrc`) and pnpm 10.34.9 (`packageManager` in `package.json`). Install with `pnpm install` at the root; never use npm or yarn, and never commit a `package-lock.json`.
- **Workspace layout.** `pnpm-workspace.yaml` lists `packages/*` and `verify/*`. Shared dev tools (TypeScript, tsx, Vitest, `@types/node`, Biome) live in the root `package.json`. Each package declares only the runtime dependencies it imports, because pnpm does not hoist undeclared packages.
- **Versions.** Pin every dependency exactly (`.npmrc` sets `save-exact`). Choose releases at least one week old (changed from two weeks on 2026-11-18). One exception overrides the age rule: when a pinned dependency has a known vulnerability, move it to the latest release that fixes it, however new, and record the alert in the upgrade commit. Allow dependency build scripts only through `onlyBuiltDependencies` in `pnpm-workspace.yaml`.
- **TypeScript.** ESM everywhere (`"type": "module"`). Packages extend `tsconfig.packages.json`, which adds seven strict flags to `tsconfig.base.json` (strict, ES2024); `verify/*` extends the base only. Harness scripts are `.mjs`; example programs are `.ts`, run with tsx.
- **Lint and format.** Biome checks JS, TS and JSON (`biome.json`): 2-space indent, double quotes, semicolons, trailing commas, 120 columns. Biome skips Markdown and mirrored upstream sources. `noExplicitAny` is off only in `verify/*/examples`.
- **Tool paths.** Never hard-code `node_modules` paths. Resolve tools with `import.meta.resolve("tsx")` or by walking up to the nearest `node_modules/.bin`.
- **Running third-party code.** Spawn it with an allowlisted environment (`PATH`, a temp `HOME`, `TMPDIR`, `LANG` plus what the run needs), never `...process.env`, and block outbound network where the harness allows. Inherited credentials once sent a doc example to a real provider.
- **Our packages follow the guidelines.** Code in `packages/` follows [`docs/guidelines/`](docs/guidelines/README.md): strict and portable TypeScript, one error class per package, named and documented exports, small functions, offline and deterministic tests, plain-English package docs and tested examples. Read the guideline for your change before you start, and update the guideline in its own pull request if you think a rule is wrong.
- **Never patch code just to make a test pass.** When a test fails, find out why: fix the product if it is wrong, or change the test and say why in the commit message ([maintainability](docs/guidelines/maintainability.md#never-patch-code-just-to-make-a-test-pass)).
- **Comments say why, without todo ids.** A comment explains an invariant, a decision or a workaround. An internal comment may cite a decision by id (`D3`, `HD15`); an exported symbol's TSDoc may not, because users read it. Todo ids belong in commit messages and plans, not in `packages/*/src`.
- **Before you commit.** `pnpm check`, `pnpm typecheck` and `pnpm test` must pass.

## Git

- **One pull request per piece of work** (changed from direct pushes to `main` on 2026-11-18). Branch from the latest `main`, named for the work (`todo/<id>-<slug>`, or `docs/<slug>` for work without a todo), push the branch, and open a pull request against `main`.
- **Squash-merge when ready:** CI (`ci.yml`) passes, the todo's definition of done is met, and every finding is fixed or explained in a commit message. That covers the findings of each [code-review round](#every-pull-request-gets-two-rounds-of-code-review), of the [writing review](#every-piece-of-copy-is-drafted-with-the-writing-skill-and-reviewed-once-the-code-is-done) and, for documents, of the fact-check. The squash commit's message is the PR title, a summary of the change, and one line per review giving its effort, its finding count and how many were fixed. Delete the branch after the merge; this session's token cannot delete remote branches, so the owner deletes them or turns on the repository's "Automatically delete head branches" setting.
- **A changeset for each package change.** A pull request that changes what users of the gateway or SDK get adds one with `pnpm changeset`. Under 0.x, a breaking change is a `minor` bump whose summary starts with "Breaking Changes". A change to package files that users don't see, such as an internal rename, takes `pnpm changeset --empty` ([`.changeset/README.md`](.changeset/README.md)). CI enforces the rule once todo L4b ships the first release.
- Snapshots of unfinished work go to the work's own branch, not to separate `wip/*` branches.
- **Conventional Commits** for commit messages and pull request titles: `type(scope): summary` in the imperative mood, with `type` one of `feat`, `fix`, `docs`, `test`, `refactor`, `chore` or `ci`, and `scope` the package or area (`feat(gateway): add createModel retries`). The pull request title becomes the squash commit's first line.
- Never commit secrets or `.env` files.

## Every pull request gets two rounds of code review

Every pull request is reviewed with `/code-review` in two rounds before it merges (the owner's rule, 2026-11-19), whoever wrote it. The first round is one review; its finding count decides whether the second round is one review or two:

1. **First round: one high-effort review.** After you open the pull request, run `/code-review high <PR#> --max-findings default`. The flag matters, because the skill otherwise keeps the cap from its last run. The round's finding count is the number of findings you confirm as real, whether you then fix them or explain why they stay. A finding you show to be false, with the reason in a commit message, doesn't count.
2. **Fix the findings.** Fix one review's findings in one new commit, or in one commit per finding. Each message lists every finding it fixes and how, or why one was left.
3. **Second round.** If the first round counted more than 6 findings, the second round is two reviews: run `/code-review medium <PR#>` and fix its findings, then run `/code-review low <PR#>` and fix those. If it counted 6 or fewer, the second round is one review: run `/code-review low <PR#>` and fix its findings.
4. **Merge** under the [Git](#git) rules, once every review in both rounds, the [writing review](#every-piece-of-copy-is-drafted-with-the-writing-skill-and-reviewed-once-the-code-is-done) and, for documents, the fact-check are done and their findings fixed or explained.

Run the reviews without `--comment`, so findings stay out of PR comments. The fix commits keep the finding-by-finding record on the pull request, and the squash commit's message carries one line per review to `main` ([Git](#git)). On a pull request from someone without these skills, a maintainer runs the rounds and pushes the fixes or asks the author for them.

## Every piece of copy is drafted with the writing skill and reviewed once the code is done

Copy is any text a person reads: documentation, READMEs, plans, ADRs, todos, pull request descriptions, page text and doc comments longer than one line. Draft all of it with `/anthropic-skills:writing`. The writing review comes last, so it reads the copy in its final state:

1. Finish the code changes, including every code-review round's fixes.
2. Run `/anthropic-skills:writing-review` on every piece of copy the pull request adds or changes, including its description.
3. Fix each finding with `/anthropic-skills:writing`, in commits recorded like code-review fixes. A fix that changes only copy, doc comments included, needs no further code review.
4. If a writing fix changed code, run one more `/code-review low <PR#>` and fix its findings. Then run `/anthropic-skills:writing-review` once more on only the copy those last fixes changed, and fix its findings. The process stops there: anything a further pass would find goes in the pull request description as a follow-up.

Writing findings are counted apart from code findings, and the pull request description records the rubric scores before and after. Every document also goes through the five steps in [Every document is drafted, fact-checked and reviewed before it merges](#every-document-is-drafted-fact-checked-and-reviewed-before-it-merges), wherever it lives in the repo.
