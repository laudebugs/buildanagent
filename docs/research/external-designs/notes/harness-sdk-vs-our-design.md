# Strands harness-sdk compared with our harness design and our eight verified SDKs (as of November 2026)

> **Working material** for the [Strands harness-sdk report](../strands-harness-sdk.md) (todo U10, 2026-11-18). The report and its [fact-check log](../fact-check-strands-harness-sdk.md) supersede these notes where they disagree; corrections are logged there, and the text below is left as written.

Scope note. These notes compare the `strands-agents/harness-sdk` monorepo with our harness plan component by component. Another researcher covers its internals in depth; these notes cover its component list, the key API shapes and how each compares.

**Pins.** All source citations are to commit `84d814b31810acc8d9f452f6cdd7333d2ed8c223` (committed 2026-11-18T13:50:44-05:00, "feat(context)!: offload conditions decide granularity (python) (#6101)"), shallow-cloned on 2026-11-18. Source links take the form `https://github.com/strands-agents/harness-sdk/blob/84d814b/<path>#L<n>`; below they are abbreviated as `path:line` links. Released versions on 2026-11-18, from the npm and PyPI registries: `@strands-agents/harness` 0.4.0 (published 2026-11-12, first release 0.1.0 on 2026-09-21); `@strands-agents/sdk` 1.25.0 (published 2026-11-13; the package was created 2025-11-28); `@strands-agents/cli` 0.3.0 (2026-11-10); PyPI `strands-harness` 0.4.0 (2026-11-12) and `strands-agents` 1.65.0 (2026-11-13). In-repo `package.json` versions read `0.0.1-development`, so the shallow clone is `main`, ahead of these tags. Its contents may differ from the 0.4.0 / 1.25.0 releases (inference; release tags were not fetched). — [npm registry @strands-agents/harness](https://registry.npmjs.org/@strands-agents/harness); [npm registry @strands-agents/sdk](https://registry.npmjs.org/@strands-agents/sdk); [npm registry @strands-agents/cli](https://registry.npmjs.org/@strands-agents/cli); [PyPI strands-harness](https://pypi.org/pypi/strands-harness/json); [PyPI strands-agents](https://pypi.org/pypi/strands-agents/json)

Our files are cited as repo-relative paths with line numbers or section anchors, as they stand on 2026-11-18.

## What harness-sdk is, and what its component list and API shapes are

### Takeaway
"harness-sdk" is no longer only a harness. It is the Strands monorepo, which holds the Python and TypeScript SDKs (`strands-py`, `strands-ts`), a thin batteries-included harness on top of them (`harness-py`, `harness-ts`, entry `create_harness()` / `createHarness()`), the `strands` CLI, an MCP docs server, the docs site and design docs. The harness is a ~5,900-line TypeScript composition layer that returns a plain SDK `Agent`. Nearly every component we plan for our harness lives in the Strands **SDK**, not in the harness package.

### Cited Findings
- The monorepo contains `harness-py/` ("fully assembled agent via `create_harness()`"), `harness-ts/` (`createHarness()`), `strands-cli/`, `strands-py/` and `strands-ts/` ("agent loop, model providers, tools"), `strands-mcp/`, `site/`, `team/` (tenets, decisions, `designs/`) and `test-infra/`. — [README.md:50-62](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L50-L62)
- Evals, Box (sandbox) and Shell are linked as separate repos (`strands-agents/evals`, `/box`, `/shell`). — [README.md:33-38](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L33-L38)
- The project calls itself "the Strands Harness SDK" and pitches "Build an agent harness. Control it end-to-end." — [README.md:64-71](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L64-L71); [README.md:111](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L111)
- The TypeScript harness source totals 5,890 lines across 25 files (`wc -l harness-ts/src/**/*.ts`). The largest are `tools/subagent.ts` (824), `config.ts` (837), `models.ts` (772) and `tools/programmatic-tool-caller.ts` (579). — measured in the clone at `84d814b`.
- `createHarness(options)` is async and returns an SDK `Agent`. It destructures `model, effort, instructions, tools, plugins, mcpServers, builtinTools, backgroundTasks, caching, contextManager, session, skills, memory, builtinPlugins, interventions` and passes every other `AgentConfig` field through. — [harness-ts/src/agent.ts:349-367](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/agent.ts#L349-L367); [harness-ts/src/agent.ts:513-524](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/agent.ts#L513-L524)
- The README documents the full option surface with defaults: `model: 'bedrock/global.anthropic.claude-opus-5-5'`, `effort: 'auto'`, `builtinPlugins: ['environment']`, `caching: 'auto'`, `contextManager: 'auto'`, `session: true`, `skills: true`, `memory: true`, `interventions: undefined`. — [harness-ts/README.md:58-77](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L58-L77)
- Defaults: built-in tools `shell, read, write, edit, web_fetch, web_search, programmatic_tool_caller, subagent`; subagent max depth 2; sessions under `./.agent/sessions`; skills under `./.agent/skills`; memory under `./.agent/memory`. — [harness-ts/src/defaults.ts:5-39](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/defaults.ts#L5-L39)
- The Python harness has the same interface (`create_harness` at [harness-py/src/strands_harness/agent.py:243](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-py/src/strands_harness/agent.py#L243)), and JSON profiles port between the two ("JSON keys are camelCase in both"). — [harness-ts/README.md:51-52](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L51-L52); [harness-ts/README.md:197-200](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L197-L200)
- The TS SDK's subsystems are directories under `strands-ts/src/`: `agent, hooks, interventions, vended-interventions (cedar, hitl, steering, dogwood), middleware, context-manager, conversation-manager, session, storage, sandbox, mcp, telemetry, background-tasks, memory, multiagent, a2a, decisions, injection, models (anthropic, openai, bedrock, google, vercel, routing), vended-tools, vended-plugins`. — directory listing of `strands-ts/src` at `84d814b`.
- The harness is versioned 0.x apart from the SDK, and minor releases carry breaking changes. — [harness-ts/README.md:563-570](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L563-L570)

### Inferences
- In our layering, Strands' SDK covers both our SDK layer and most of our harness layer: session manager, context manager, sandbox, interventions, MCP, telemetry. Its "harness" package is closer to the *defaults and assembly* step that our `harness` package and CLI would do. It also does part of our agent plan's job, through a tuned prompt and a tool set. The closest analogue among our references is Pi, where `pi-coding-agent` assembles a ready agent over `pi-agent-core`.
- "harness-sdk" is a product name for the monorepo, not a separate harness SDK. A report should say "the Strands SDK (`@strands-agents/sdk` 1.25.0) and the Strands harness (`@strands-agents/harness` 0.4.0), both in the `harness-sdk` monorepo".

### Gaps
- The GitHub REST API was blocked, so stars, contributor counts, the repo's rename history and release tags were not read. Whether `strands-agents/sdk-python` was renamed into `harness-sdk` is inferred from identical `HEAD` commits (next section).

## Do our earlier, unverified Strands claims hold?

### Takeaway
Most of our earlier Strands claims hold. One citation has drifted, three gaps can now be closed from source, and one classification needs updating; none of the claims is plainly false. Five claims need fact-check rows: the citation drift, the closed compaction and session-backend gaps, the tier change and the star count. The tier change is the substantive one: Strands now ships an assembled harness as well as a library loop, so the "library loop you embed" tier undersells it.

### Cited Findings
- **Main report table row** ([docs/research/agent-sdks-and-harness-design.md:23](../../../research/agent-sdks-and-harness-design.md)): "AWS Strands | You: model-driven loop | Bedrock default; Anthropic, OpenAI, Gemini | Sessions, context management | Lifecycle hooks, steering, `create_harness()` | Apache-2.0". **Holds.** The README says "First-class support for Amazon Bedrock, Anthropic, OpenAI, and Gemini" ([README.md:69](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L69)). The TS SDK "uses Amazon Bedrock by default" ([README.md:147](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L147)). `create_harness()` exists ([harness-py/src/strands_harness/__init__.py:3](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-py/src/strands_harness/__init__.py#L3)). Steering ships at `strands-ts/src/vended-interventions/steering/` (directory listing). The licence is Apache-2.0 ([harness-ts/package.json](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/package.json), `"license": "Apache-2.0"`).
- **Main report recommendation** ([docs/research/agent-sdks-and-harness-design.md:128](../../../research/agent-sdks-and-harness-design.md)) lists Strands among library SDKs to "adopt … plus Temporal/DBOS for durability". **Holds, but incomplete.** Strands now also ships a full assembled harness with a coding toolset, sessions, memory and a CLI ([harness-ts/README.md:108-125](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L108-L125)).
- **vendor-sdks.md line 37** ("A higher-level `create_harness()` / `createHarness()` returns an assembled agent — [strands-agents/sdk-python]"). **The claim holds; the citation has drifted.** The harness lives in `harness-py/` and `harness-ts/` of the `harness-sdk` monorepo, not in a Python SDK repo. `git ls-remote https://github.com/strands-agents/sdk-python HEAD` returned `84d814b31810acc8d9f452f6cdd7333d2ed8c223`, the same commit as `harness-sdk` HEAD. `strands-agents/sdk-typescript` returned a different HEAD (`00e04880…`). Both outputs were observed on 2026-11-18. (Inference: `sdk-python` was renamed to `harness-sdk` and GitHub redirects the old URL; `sdk-typescript` is a separate, probably frozen repo. Not verified through the API.)
- **vendor-sdks.md line 89** (three ownership tiers, with Strands in tier 2 "Library loop you embed and compose"). **Needs updating.** Strands now spans tier 2 (SDK `Agent`) and a pre-assembled harness tier like Pi's coding agent ([README.md:77](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L77): "a fully assembled, state-of-the-art agent … benchmarked defaults"). Unlike tier 1, the loop still runs in-process and the result is "a plain Strands `Agent`" ([harness-ts/README.md:123-125](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L123-L125)).
- **vendor-sdks.md line 95** ("Whether … Strands expose pluggable compaction/summarization hooks was not confirmed … mentions 'context management' only in general terms"). **The gap can now be closed.** `contextManager` takes `'auto' | 'agentic' | ContextManagerConfig | ContextManager | false`, and `'auto'` is truncation of tool results over 1,500 tokens plus summarization at 85% utilization keeping 4 recent messages ([strands-ts/src/context-manager/context-manager.ts:40-67](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/context-manager/context-manager.ts#L40-L67)). Named strategy presets exist ([strands-ts/src/context-manager/presets.ts:26-53](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/context-manager/presets.ts#L26-L53)).
- **vendor-sdks.md line 158** ("Strands' AgentCore integration and session-manager backends were not verified"). **Partly closed.** The TS SDK has file and S3 snapshot storage (`strands-ts/src/session/file-storage.ts`, `s3-storage.ts`), and the harness uses AgentCore for `web_search` on Bedrock ([harness-ts/README.md:324-336](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L324-L336)). AgentCore *deployment* was not checked.
- **vendor-sdks.md line 174** ("Python 3.10+ and TypeScript (Node 22+, ESM)"). **Holds.** — [README.md:115](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L115); [README.md:133](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L133)
- **vendor-sdks.md line 163** (graph/swarm multi-agent). **Holds.** It ships `vended-tools/graph`, `vended-tools/swarm` and `multiagent/` (directory listing), plus A2A (`a2a/`, peer `@a2a-js/sdk`).
- **vendor-sdks.md line 176** ("strands-agents/sdk-python about 9.2k" stars). **Unverifiable now.** If the rename inference is right, the figure now describes the whole monorepo.
- **fact-check-2026-11-18.md line 49** (`strands-agents` 1.65.0, Apache-2.0). **Holds.** PyPI latest is 1.65.0, uploaded 2026-11-13. — [PyPI](https://pypi.org/pypi/strands-agents/json)

### Inferences
- Proposed fact-check rows. (1) The source link for `create_harness()` should be `strands-agents/harness-sdk` (`harness-py/`, `harness-ts/`), not `sdk-python`. (2) Compaction is pluggable and now confirmed (gap closed). (3) Session backends are file and S3 snapshots (gap closed). (4) The tier classification changes to "library SDK plus an assembled harness". (5) The star count is stale and its subject ambiguous.

### Gaps
- The rename and its date could not be confirmed (API blocked).

## Session format and storage

### Takeaway
**Different approach; ours is better for our goals.** Strands stores a session as a *mutable* `snapshot_latest.json` that is overwritten on every save, plus optional immutable UUIDv7 checkpoints taken when a trigger fires. Ours is an append-only, typed JSONL tree with HEAD, a writer lock and pauses as entries. Strands is simpler and pluggable (file, S3, custom `SessionManager`). It has no tree, no per-entry history and no lock, and it says so: its docs declare it single-writer with no lock.

### Cited Findings
- `SessionManager` keeps two kinds of snapshot. "`snapshot_latest`: A single mutable snapshot that is overwritten on each save" and "Immutable snapshots: Append-only snapshots with unique IDs (UUID v7), created only when `snapshotTrigger` fires". — [strands-ts/src/session/session-manager.ts:30-47](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/session/session-manager.ts#L30-L47)
- `saveLatestOn` defaults to `'invocation'`. It can also hook `MessageAddedEvent` (`'message'`) or `AfterModelCallEvent`. — [strands-ts/src/session/session-manager.ts:154](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/session/session-manager.ts#L154); [:185-205](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/session/session-manager.ts#L185-L205)
- File layout: `<baseDir>/<sessionId>/scopes/<scope>/<scopeId>/snapshots/snapshot_latest.json` plus `immutable_history/snapshot_<uuid7>.json` and `manifest.json`. Writes go to a temp file and are then renamed. — [strands-ts/src/session/file-storage.ts:7-75](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/session/file-storage.ts#L7-L75); [:168-175](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/session/file-storage.ts#L168-L175)
- The harness default is `saveLatestOn: 'message'` under `./.agent/sessions`, with a fresh random 8-hex id each run (no auto-resume). Offloaded context goes to `LocalFileStorage` in the session's folder. — [harness-ts/src/agent.ts:440-460](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/agent.ts#L440-L460); [harness-ts/README.md:374-393](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L374-L393)
- "Text still streaming and unfinished tool calls are not yet saved." — [harness-ts/README.md:392-393](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L392-L393)
- "Concurrency is single-writer … The built-in managers take no distributed lock … Run one writer per session id; if you fan out, add your own lock." — [site/src/content/docs/user-guide/harness/configure/checkpoints-and-memory.mdx:116-124](https://github.com/strands-agents/harness-sdk/blob/84d814b/site/src/content/docs/user-guide/harness/configure/checkpoints-and-memory.mdx#L116-L124)
- Ours: "The session log is a JSONL file of typed entries, each with `id`, `parentId`, `type` and `timestamp`, and it is the only source of truth … run state is rebuilt from the log, so no separate run-state blob exists." — [docs/guides/agent-harness.md:23](../../../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries); HD1 one entry per content block ([docs/plans/build-harness.md:51](../../../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-provisional)); HD2 lease lock ([:52](../../../plans/build-harness.md#hd2-a-lock-file-with-a-renewed-lease-on-local-disk-only-provisional)); HD11 retention and schema ([:61](../../../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-accepted)).

### Inferences
- In our §2 table ([docs/guides/agent-harness.md:27-35](../../../guides/agent-harness.md)), Strands would be a new row: "snapshot JSON + optional immutable checkpoints | no branch in place (restore a checkpoint) | latest snapshot or checkpoint id | no lock, single writer by contract | yes, interrupt state in the snapshot (README claim, not run)". That places it nearest OpenAI's `RunState` blob, the run-state-blob design our harness decision 1 rejects.
- **Copy:** the explicit "checkpoint vs long-term memory" split and doc page, and a pluggable storage interface with an S3 backend. **Note:** its atomic temp-file-plus-rename write is the minimum our JSONL appends also need. **Avoid:** an overwritten latest snapshot as the record of truth, because compaction that splices messages (next section) then destroys history in the session file itself.

### Gaps
- We did not run a resume or kill test against Strands, so pending-approval survival across restart is the README's claim only.

## Compaction and context policy

### Takeaway
**Partly aligned, different mechanics.** Strands has a strategy pipeline (`Offload.truncate / summarize / drop` with `.when()` conditions) that maps well onto our layers 1–3 and 5, and it stashes offloaded originals behind a retrieval tool. It differs from us in two ways. First, it mutates the message list in place (splice), so originals survive only in the stash, not in a log. Second, its defaults are tuning values that "may change between releases". Our plan keeps every compaction as an appended entry and pins defaults behind ablation.

### Cited Findings
- `'auto'` preset: `Offload.truncate('toolResults', …).when({ blockThreshold: 1_500 })`, then `Offload.summarize('*').when({ contextUtilization: '85%', preserveRecent: 4 })`. `'agentic'` preset: truncate at 8,000 tokens and summarize at 100%, with "Model-driven context management via injected tools". — [strands-ts/src/context-manager/context-manager.ts:46-67](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/context-manager/context-manager.ts#L46-L67)
- Named strategy presets are `proactiveSummarization` (oldest 30% at 70%), `largeToolOffloading` (results over 2,500 tokens cut to a 1,000-token preview), `overflowProtection` (drop oldest at 100%, keep 4) and `staleToolCleanup` (drop results outside the newest 5). "Preset definitions … are internal defaults and may change between releases." — [strands-ts/src/context-manager/presets.ts:1-53](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/context-manager/presets.ts#L1-L53)
- "When the ContextManager offloads content from the context window, the original is persisted here so the agent can retrieve it on demand via the retrieval tool." — [strands-ts/src/context-manager/stash.ts:1-8](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/context-manager/stash.ts#L1-L8)
- Trimming splices the message array (`messages.splice(start, run.length)`). The older summarizing conversation manager replaces the summarized span with a summary message. — [strands-ts/src/context-manager/message-trimming.ts:183](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/context-manager/message-trimming.ts#L183); [strands-ts/src/conversation-manager/summarizing-conversation-manager.ts:179](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/conversation-manager/summarizing-conversation-manager.ts#L179)
- The harness turns on prompt caching by default for Bedrock, Anthropic and OpenAI (cache points on GPT-5.6+). Asking for it explicitly on an unsupported provider throws. The `todos` plugin is opt-in because it "breaks the cached prefix". — [harness-ts/README.md:349-364](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L349-L364); [:451-454](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L451-L454)
- Ours: five removable layers, cheapest first ([docs/guides/agent-harness.md:55-62](../../../guides/agent-harness.md#3-context-policy-should-run-five-removable-layers-cheapest-first-and-keep-every-compaction-visible-and-reversible)); HD3 turns on layers 1, 2, 3 and 5 with budget `min(window − 16,384, 200,000)` ([docs/plans/build-harness.md:53](../../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional)); "Every compaction is an appended entry, originals are never deleted" ([docs/guides/agent-harness.md:62](../../../guides/agent-harness.md)).

### Inferences
- Mapping: `truncate('toolResults')` + stash + retrieval tool ≈ our layer 1 (write-time cap with spill-to-file). `drop('toolResults')` outside the newest N ≈ our layer 2 masking, except that Strands drops from the message list instead of masking at read time. `summarize` ≈ layer 3. `overflowProtection` ≈ a drop-based variant of layer 5. No explicit mid-turn layer 4 was found (not exhaustively checked).
- **Copy:** the declarative `strategy.when({contextUtilization, preserveRecent, blockThreshold})` shape. It makes each layer a removable, ablatable value, which suits our §11. Also copy the stash-plus-retrieval-tool pattern for offloaded tool output. **Avoid:** splicing originals out of the session record. **Note:** "agentic" (model-driven context tools) is a mode we have no equivalent for and could ablate later.

### Gaps
- Summary template quality and whether the summarizer sees the whole discarded span were not read.

## Approvals and permissions

### Takeaway
**Different approach, and on balance ours is safer by default. Strands has two ideas worth copying.** Strands' "interventions" are ordered handlers over five lifecycle points returning `proceed | deny | guide | confirm | transform`. Deny short-circuits and guide feedback accumulates. Its harness presets are `ask`, `smart` (LLM risk classifier) and a natural-language rubric, and Cedar policy files are supported. The default is no gate at all. The classifier lets low-risk calls run with no human, which ADR 0029 and HD12 forbid outside the host callback. Pending approvals pause through interrupt/resume and are not signed (no HMAC found), unlike our HD5. Two things are worth copying: `guide` (steer instead of block) and Cedar policies over tool calls.

### Cited Findings
- `InterventionAction = Proceed | Deny | Guide | Confirm | Transform`. `LifecycleEvent` covers BeforeInvocation, BeforeToolCall, AfterToolCall, BeforeModelCall and AfterModelCall. `Confirm` is "Only supported on beforeToolCall". Without a `response` it "breaks out of the agent loop to pause for external resume". — [strands-ts/src/interventions/actions.ts:25-152](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/interventions/actions.ts#L25-L152)
- `Guide` on afterModelCall: "the response is discarded and the model retries with the feedback injected as a user message". — [strands-ts/src/interventions/actions.ts:58-78](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/interventions/actions.ts#L58-L78)
- `InterventionHandler` is an abstract class with `name`, `onError: 'throw' | 'proceed' | 'deny'` (default `'throw'`) and the five methods. — [strands-ts/src/interventions/handler.ts:21](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/interventions/handler.ts#L21); [:44-70](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/interventions/handler.ts#L44-L70)
- The registry dispatches "in registration order, with short-circuiting on Deny (and denied Confirms) and accumulation for Guide". — [strands-ts/src/interventions/registry.ts:21-28](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/interventions/registry.ts#L21-L28)
- Harness sugar: `'off' | 'ask' | 'smart'`, a path ending `.cedar` (Cedar via optional `@cedar-policy/cedar-wasm`) or any other string as the classifier's system prompt. Two handlers with the same name throw. — [harness-ts/src/interventions.ts:10-18](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/interventions.ts#L10-L18); [:43-88](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/interventions.ts#L43-L88)
- "By default the agent runs every tool call without asking." A subagent inherits the policy, and calls from inside `programmatic_tool_caller` are gated too. "those inner calls fire the agent's hooks but not tool middleware or guards". — [harness-ts/README.md:482-513](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L482-L513)
- The HITL classifier: "low-risk calls run on their own and risky ones are escalated to the human". Trust responses (`t`/`trust`) remember a tool for the session under state key `hitl:trustedTools`, and "trusting a tool disables argument-level risk classification for that tool name". — [strands-ts/src/vended-interventions/hitl/hitl.ts:15-16](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/vended-interventions/hitl/hitl.ts#L15-L16); [:90-101](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/vended-interventions/hitl/hitl.ts#L90-L101); [:195-196](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/vended-interventions/hitl/hitl.ts#L195-L196)
- Interrupt flow: halt with `stopReason: 'interrupt'`, resume "by invoking agent with `interruptResponse` content blocks". — [strands-ts/src/interrupt.ts:1-10](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/interrupt.ts#L1-L10). A grep for `hmac|signature|sign(` in `interrupt.ts`, `interventions/`, `vended-interventions/hitl/` and `session/` found nothing (observed; absence ≠ proof).
- The CLI installs a Cedar intervention that auto-permits workspace-local `read` "after canonical-path and symlink checks". Other calls get Allow once / Always allow / Deny once / Always deny, saved to user-level `~/.strands/cli.toml`. "the CLI does not load a project config file that could silently enable bypass mode", and "Shell scopes match command text; they do not sandbox what commands execute." — [strands-cli/README.md:395-419](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-cli/README.md#L395-L419)
- Ours: ordered, deny-first, fail-closed pipeline; no-match means ask interactively and deny headless ([docs/guides/agent-harness.md:110](../../../guides/agent-harness.md#5-the-permission-pipeline-should-be-ordered-deny-first-and-fail-closed-and-its-approvals-should-be-signed-entries)); HD5 HMAC-signed approvals ([docs/plans/build-harness.md:55](../../../plans/build-harness.md)); HD12 no classifier allow outside the host callback ([:62](../../../plans/build-harness.md)); ADR 0029 "Let no classifier approve a triage-agent call" ([docs/decisions/0029-no-classifier-approval.md](../../../decisions/0029-no-classifier-approval.md)); "Always allow must never widen to an interpreter" ([docs/guides/agent-harness.md:131](../../../guides/agent-harness.md)); SDK approvals end the run in a signed resumable state ([docs/guides/agent-sdk.md:149](../../../guides/agent-sdk.md#7-an-approval-should-end-the-run-in-a-signed-resumable-log-state-not-block-a-callback)).

### Inferences
- Strands fits our §5 table ([docs/guides/agent-harness.md:116-123](../../../guides/agent-harness.md)) as: "ordered intervention handlers over five lifecycle points; Cedar or classifier | interrupt state in the session snapshot | none found (unsigned)". That puts it beside OpenAI and LangChain, not Vercel.
- The "trust" response that turns off classification for a whole tool name for the session is the kind of sticky widening our §5 warns about. A trusted `shell` would cover every command (inference from hitl.ts:96-97).
- **Copy:** (a) `guide` as a first-class gate outcome. It maps to our "deny with a message to the model", but it also works after the model call (discard and retry with feedback), a steering point we do not name. (b) Cedar as a declarative policy backend behind our rule step. (c) The CLI's rule that bypass mode comes only from user-level config, never project config, which matches our §7 project-trust gate. (d) Gating calls made from inside code execution through the same pipeline, which matches our "code-initiated calls through the same pipeline" (N40 in [docs/plans/build-harness.md:25](../../../plans/build-harness.md)). Their documented hole is that inner calls skip middleware and guards, and our plan should test that case. **Avoid:** default no gate, classifier allows, unsigned resumable pauses, tool-wide trust.

### Gaps
- Whether a resumed interrupt is re-evaluated against the policy was not checked.

## Sandboxing and the credential boundary

### Takeaway
**Something they lack.** Strands has a clean pluggable `Sandbox` abstraction (six operations; local, Docker and SSH backends), and every harness tool routes through it. The default on Node, however, is `NotASandboxLocalEnvironment`, which "Runs on the host with no isolation" and passes the full `process.env` to every command. It has no credential boundary and no egress proxy, and nothing separates a `SandboxPolicy` from an `ApprovalPolicy`. Our HD4 (srt/Docker, `none` only with an unsafe flag) and HD15 (credential proxy) have no counterpart.

### Cited Findings
- `abstract class Sandbox` has `executeStreaming`, `executeCodeStreaming`, `readFile`, `writeFile`, `removeFile`, `listFiles` and `getTools()`. — [strands-ts/src/sandbox/base.ts:42-120](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/sandbox/base.ts#L42-L120)
- Node registers `NotASandboxLocalEnvironment` as the default sandbox. — [strands-ts/src/sandbox/register-node-defaults.ts:6-8](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/sandbox/register-node-defaults.ts#L6-L8)
- "Runs on the host with no isolation. Used as the default when no sandbox is configured." — [strands-ts/src/sandbox/not-a-sandbox-local-environment.ts:51-53](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/sandbox/not-a-sandbox-local-environment.ts#L51-L53)
- `hostEnvWith()` starts from `{ ...process.env }` and passes it to spawned commands. — [strands-ts/src/sandbox/not-a-sandbox-local-environment.ts:31-41](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/sandbox/not-a-sandbox-local-environment.ts#L31-L41); [:70](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/sandbox/not-a-sandbox-local-environment.ts#L70); [:97](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/sandbox/not-a-sandbox-local-environment.ts#L97)
- `DockerSandbox` and `SshSandbox` extend `PosixShellSandbox`. — [strands-ts/src/sandbox/docker.ts:36](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/sandbox/docker.ts#L36); [strands-ts/src/sandbox/ssh.ts:92](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/sandbox/ssh.ts#L92)
- The harness drops sandbox-vended tools (e.g. `sandbox_bash`) because its built-ins "already route through it". `web_fetch` defaults to `curl` inside the sandbox "so the sandbox's network controls apply". — [harness-ts/src/agent.ts:302-306](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/agent.ts#L302-L306); [harness-ts/src/types/agent.ts:23-40](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/types/agent.ts#L23-L40)
- Production guide: `programmatic_tool_caller` "runs model-authored code in Monty, which isolates the code but not the tools it calls". The default agent "can run shell commands and edit files; gate what it does with interventions and confine what it can reach with a sandbox." — [site/src/content/docs/user-guide/harness/production.mdx:66-72](https://github.com/strands-agents/harness-sdk/blob/84d814b/site/src/content/docs/user-guide/harness/production.mdx#L66-L72)
- CLI: "Unless a caller supplies a Strands `sandbox`, the harness's shell, file, MCP, delegate, and Background Task work runs in the host process with the user's permissions." — [strands-cli/README.md:424-428](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-cli/README.md#L424-L428)
- Ours: separate `SandboxPolicy` and `ApprovalPolicy`, honest tiers with `none` labelled unsafe ([docs/guides/agent-harness.md:139](../../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both)); secrets leak "mostly through inherited environments" ([:164](../../../guides/agent-harness.md)); HD4 ([docs/plans/build-harness.md:54](../../../plans/build-harness.md); ADR [0020](../../../decisions/0020-default-sandbox-backend.md)); HD15 default-deny egress and sentinel credential injection ([docs/plans/build-harness.md:65](../../../plans/build-harness.md)); AGENTS.md coding standard "Spawn it with an allowlisted environment … never `...process.env`" ([AGENTS.md](../../../../AGENTS.md#coding-standards)).

### Inferences
- Strands belongs in our deep comparison's "defaults that reach outside your process" list ([docs/comparison/deep-comparison.md:65-73](../../../comparison/deep-comparison.md#six-of-eight-sdks-have-a-default-that-reaches-outside-your-process)) next to Claude and Copilot (inherited env). It also has an AWS-credential default similar to Pi's ambient cloud credentials, since the default model is Bedrock ([harness-ts/src/defaults.ts:5](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/defaults.ts#L5)).
- The class name `NotASandboxLocalEnvironment` is a good example of our "honest tiers" principle: the name itself warns the user. **Copy:** the six-operation `Sandbox` interface (with code execution as an operation) and routing every built-in through it, including `web_fetch` via in-sandbox `curl`. **Avoid:** an unconfined default and an inherited env.

### Gaps
- Docker backend flags (cap-drop, network) were not read.

## MCP

### Takeaway
**Aligned, with one smaller difference.** Both build on `@modelcontextprotocol/client` 2.x. Strands namespaces tools `<server>_<tool>`, lets a failed server contribute no tools (non-fatal by default), supports elicitation and the MCP tasks extension, and offers an `mcp-router` tool for runtime connection. Our plan adds a registry-level canonical-name check with exposure modes (`direct/deferred/hidden`) and per-server protocol-era negotiation. Strands checks name collisions for built-ins only before connect and says MCP collisions can still slip through.

### Cited Findings
- The SDK peer-depends on `@modelcontextprotocol/client` `^2.0.0` and depends on `@modelcontextprotocol/ext-tasks` `^0.2.2`. — [strands-ts/package.json](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/package.json) (dependencies, peerDependencies)
- `elicitationCallback` advertises elicitation support (form + url modes). — [strands-ts/src/mcp/client.ts:279-283](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/mcp/client.ts#L279-L283); [:433](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/mcp/client.ts#L433)
- The harness calls `McpClient.loadServers(mcpServers, { continueOnError: true }, { prefixWithServerName: true })`. — [harness-ts/src/agent.ts:398](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/agent.ts#L398)
- "A server that fails to start contributes no tools rather than taking the agent down … namespaced as `<server>_<tool>`". — [harness-ts/README.md:306-310](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L306-L310)
- "MCP tool names are only known once a client connects, so the pre-flight above skips them … a server keyed to a built-in name … still can [clash]." — [harness-ts/src/agent.ts:498-501](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/agent.ts#L498-L501)
- The design doc "Cache friendly/Cost reducing Tool management" is dated 2026-10-15 and scoped to Python and TypeScript. — [team/designs/0021-cache-friendly-tool-management.md:1-7](https://github.com/strands-agents/harness-sdk/blob/84d814b/team/designs/0021-cache-friendly-tool-management.md#L1-L7)
- Ours: one registry, canonical names, duplicates refused, exposure per source ([docs/guides/agent-harness.md:94](../../../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension)); per-server protocol eras ([:102](../../../guides/agent-harness.md)); HD14 `@modelcontextprotocol/client` 2.4.0 behind `McpConnection` ([docs/plans/build-harness.md:64](../../../plans/build-harness.md); ADR [0021](../../../decisions/0021-mcp-client-base.md)).

### Inferences
- The shared client base confirms our HD14 choice. Strands' non-fatal default for a failed server is a reasonable behaviour to copy, with a per-server `continueOnError: false` override. A collision check that runs after connect is a gap in Strands that our registry closes by design.

### Gaps
- Whether Strands defers MCP tool schemas (tool search) was not determined; design 0021 suggests work in progress.

## Hooks and steering

### Takeaway
**Aligned in moments, different in structure.** Strands has 17 typed hook event classes and a separate interventions layer on top of them, plus a middleware layer. That gives it observers (hooks), gates and steering (interventions) and wrappers (middleware): three layers where we plan observers plus six interceptors. Steering exists as a vended intervention. We found no steering *queue* (mid-run user messages), though background tasks cover asynchronous tool work.

### Cited Findings
- Hook event classes: `InitializedEvent, BeforeInvocationEvent, AfterInvocationEvent, MessageAddedEvent, BeforeToolCallEvent (Interruptible), AfterToolCallEvent, BeforeModelCallEvent, AfterModelCallEvent, ModelStreamUpdateEvent, ContentBlockEvent, ModelMessageEvent, ToolResultEvent, ToolStreamUpdateEvent, AgentResultEvent, InterruptEvent, BeforeToolsEvent (Interruptible), AfterToolsEvent`. — [strands-ts/src/hooks/events.ts:137-830](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/hooks/events.ts#L137-L830)
- A middleware layer exists (`strands-ts/src/middleware/` with `stages.ts`, `interrupt.ts`). Steering ships under `strands-ts/src/vended-interventions/steering/` with `handlers/llm.ts` and `providers/`. — directory listing at `84d814b`.
- The harness's `environment` plugin injects platform, date, cwd, `AGENTS.md` contents and links before each turn, read "through the agent's sandbox". — [harness-ts/README.md:455-458](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L455-L458)
- Background tasks: "`subagent` always runs in the background … The harness waits for the work to finish and continues the parent model with its result." — [harness-ts/README.md:216-221](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L216-L221)
- Ours: six interceptors `beforeModelCall, transformContext, afterModelCall, beforeToolCall, afterToolCall, shouldStop`, separate from observers, and a gate that fails closed ([docs/guides/agent-sdk.md:129-137](../../../guides/agent-sdk.md#6-hooks-should-be-six-typed-interceptors-and-separate-observers-each-taking-one-event-object)); ADR [0006](../../../decisions/0006-interceptor-names.md); AGENTS.md lists a "steering queue" among the hooks ([AGENTS.md](../../../../AGENTS.md#planned-architecture-when-code-starts)).

### Inferences
- Strands' handlers mutate events (`transform`'s `apply` mutates in place; [actions.ts:110-131](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/interventions/actions.ts#L110-L131)). Our rule 2 prefers returning a new value ([docs/guides/agent-sdk.md:135](../../../guides/agent-sdk.md)). Intervention `onError` defaults to `'throw'`, which is close to our fail-closed rule, but a handler can opt into `'proceed'`.
- Their five lifecycle points line up with our interceptors except `transformContext` (they use the ContextManager) and `shouldStop`. **Note:** three layers (hooks, interventions, middleware) is more surface than we want; the README admits inner calls skip middleware. That supports our choice of one pipeline.

### Gaps
- No mid-run "steer" or "followUp" API equivalent to Pi's was found (not exhaustively searched).

## Streaming event model

### Takeaway
**Aligned.** `agent.stream()` yields one union, `AgentStreamEvent`, of 16 classes: model deltas, content-block and message completions, tool stream updates and results, lifecycle events, interrupts and a final `AgentResultEvent`. The hook events double as stream events. That is close to our "one closed, layered union whose end events carry the authoritative item".

### Cited Findings
- `AgentStreamEvent` = `ModelStreamUpdateEvent | ContentBlockEvent | ModelMessageEvent | ToolStreamUpdateEvent | ToolResultEvent | BeforeInvocationEvent | AfterInvocationEvent | BeforeModelCallEvent | AfterModelCallEvent | BeforeToolsEvent | AfterToolsEvent | BeforeToolCallEvent | AfterToolCallEvent | MessageAddedEvent | InterruptEvent | AgentResultEvent`. — [strands-ts/src/types/agent.ts:699-715](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/types/agent.ts#L699-L715)
- Ours: [docs/guides/agent-sdk.md §5](../../../guides/agent-sdk.md#5-the-event-stream-should-be-one-closed-layered-union-whose-end-events-carry-the-authoritative-item) (line 115).

### Inferences
- `ContentBlockEvent` / `ModelMessageEvent` play the role of our `*_end` events, which HD1 persists per content block. Strands persists per *message* (`saveLatestOn: 'message'`), not per block (inference from session-manager.ts:188-189).

## Telemetry (OTel gen_ai)

### Takeaway
**Mostly aligned on spans, different on defaults.** Strands emits `invoke_agent <name>`, `chat` and `execute_tool <name>` spans with `gen_ai.*` attributes. Older and latest semconv are chosen by `OTEL_SEMCONV_STABILITY_OPT_IN`, and the GenAI metric uses seconds. The harness stays off unless `OTEL_TRACES_EXPORTER` is set, which matches our "only exporter is an explicitly configured OTLP endpoint". Once on, message and tool-argument content is recorded as span events by default; we found no switch that turns content off. Our plan has content off by default, an approval-wait span, a pinned convention commit and cost attributes.

### Cited Findings
- Span names: `invoke_agent ${agentName}`, `chat`, `execute_tool ${tool.name}`. — [strands-ts/src/telemetry/tracer.ts:282-283](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/telemetry/tracer.ts#L282-L283); [:369-373](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/telemetry/tracer.ts#L369-L373); [:441-447](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/telemetry/tracer.ts#L441-L447)
- `OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` switches to the latest conventions (e.g. `gen_ai.system` → `gen_ai.provider.name`). `gen_ai_tool_definitions` adds tool schemas, and `gen_ai_span_attributes_only` moves content from events to attributes. — [strands-ts/src/telemetry/tracer.ts:170-252](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/telemetry/tracer.ts#L170-L252)
- Tool inputs are written as `gen_ai.tool.message` events (legacy) or as `gen_ai.tool.call.arguments` plus `gen_ai.input.messages` (latest), with no content gate in that code path. — [strands-ts/src/telemetry/tracer.ts:452-478](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/telemetry/tracer.ts#L452-L478)
- "OTel GenAI semconv requires seconds for this metric". — [strands-ts/src/telemetry/meter.ts:388](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/telemetry/meter.ts#L388)
- Harness: "Unset means off — the harness does not honor OTEL's spec default of `otlp`"; setup runs once per process. — [harness-ts/src/telemetry.ts:1-15](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/telemetry.ts#L1-L15); [:33-66](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/telemetry.ts#L33-L66)
- Ours: [docs/guides/agent-harness.md §9](../../../guides/agent-harness.md#9-telemetry-should-be-a-projection-of-the-log-with-content-off-by-default-and-cost-recorded-on-every-entry) (line 207); HD7 pins semconv-genai `d28355d` and `agent_speak.cost.usd` ([docs/plans/build-harness.md:57](../../../plans/build-harness.md); ADR [0017](../../../decisions/0017-telemetry-convention-pin-and-cost-attributes.md)).

### Inferences
- In our §9 defaults table ([docs/guides/agent-harness.md:215-221](../../../guides/agent-harness.md)), Strands would read: "off until `OTEL_TRACES_EXPORTER` is set (harness) | **recorded** (no content-off switch found) | OTLP or console". **Copy:** the "unset means off, never the spec default" rule and once-per-process setup. **Avoid:** content on whenever telemetry is on.

### Gaps
- Whether the bare SDK (without the harness) registers a tracer by default was not checked; the harness comment implies a plain `Agent` "has nowhere to send them". No approval-wait span or cost attribute was found (not exhaustively searched).

## Evals

### Takeaway
**Different approach, and complementary to ours.** Strands Evals is a separate, Python-only SDK (`strands-agents-evals`) with evaluators, detectors, red teaming and simulators. The team published a 94,000-trial cross-harness benchmark on Harbor that reports estimated cost beside accuracy, which is the same "cost beside pass rate" stance as our §10. We plan Inspect plus a mini-swe-agent baseline.

### Cited Findings
- "Strands Evals is how you measure an agent before you ship it … Score its output and its trajectory, detect and diagnose failures, probe it for unsafe behavior, and simulate the users and tools". Install is `pip install strands-agents-evals strands-agents`. — [site/src/content/docs/user-guide/evals-sdk/index.mdx:9-12](https://github.com/strands-agents/harness-sdk/blob/84d814b/site/src/content/docs/user-guide/evals-sdk/index.mdx); [quickstart.mdx:34](https://github.com/strands-agents/harness-sdk/blob/84d814b/site/src/content/docs/user-guide/evals-sdk/quickstart.mdx#L34)
- Blog (2026-10-13), vendor's own benchmark: ~94,000 trials, 8 benchmarks (ALFWorld, ContextBench, GAIA, LoCoMo, SWE-bench Pro, τ³-bench, Terminal-Bench 2.1, WebShop), 12 models and 6 harnesses (Strands harness, OpenCode, Claude Code, oh-my-pi, Codex, DeepSeek Harness), run on Harbor with a snapshot from 2026-09-17. Dollar figures are estimates, because Strands harness had no billed costs. — [site/src/content/blog/we-ran-94000-trials-to-measure-the-cost-of-harness-choice.mdx:37-45](https://github.com/strands-agents/harness-sdk/blob/84d814b/site/src/content/blog/we-ran-94000-trials-to-measure-the-cost-of-harness-choice.mdx#L37-L45)
- Vendor claim: on OpenAI models Strands harness had "the lowest estimated cost (~$0.20 per trial) and the highest accuracy (71.02%)". — [same file:93](https://github.com/strands-agents/harness-sdk/blob/84d814b/site/src/content/blog/we-ran-94000-trials-to-measure-the-cost-of-harness-choice.mdx#L93). The launch post's title claims "frontier performance with 28% lower token cost" ([site/src/content/blog/introducing-strands-harness.mdx:2-3](https://github.com/strands-agents/harness-sdk/blob/84d814b/site/src/content/blog/introducing-strands-harness.mdx#L2-L3)). Both are self-reported vendor benchmarks and were not reproduced.
- Ours: Inspect + mini-swe-agent, cost beside pass^k ([docs/guides/agent-harness.md §10](../../../guides/agent-harness.md#10-evals-should-run-on-inspect-against-mini-swe-agent-and-report-cost-per-task-beside-pass-rate), line 233); HD8 30-task seed suite ([docs/plans/build-harness.md:58](../../../plans/build-harness.md)).

### Inferences
- **Note:** Harbor and its Strands adapter are a second eval runner, beside Inspect, that already drives several harnesses. The blog's matched-subset method (compare only on shared model-and-dataset combinations) is the same discipline as our §10. Their benchmark does not include a mini-swe-agent baseline.

### Gaps
- The evals repo itself and Harbor were not read.

## Testing with a fake model

### Takeaway
**Something they lack (publicly).** The TS SDK has a `MockMessageModel` only in internal `__fixtures__`. No `testing` export appears in the package's export map, and the harness tests hand-roll `Model` subclasses. Our SDK D1 / §8 ships a strict `ScriptedModel` in a public `testing` subpath, and our verification harnesses depend on such a model.

### Cited Findings
- `export class MockMessageModel extends Model<BaseModelConfig>` lives in `strands-ts/src/__fixtures__/mock-message-model.ts:32`. — [link](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/src/__fixtures__/mock-message-model.ts#L32)
- The `exports` subpaths in `strands-ts/package.json` include `./vended-memory-stores/test-memory-store` but no model test subpath (full list read on 2026-11-18). — [strands-ts/package.json](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/package.json)
- Harness test: `class RetrievingModel extends Model`. — [harness-ts/test/agent.test.ts:119](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/test/agent.test.ts#L119)
- Ours: "Four of the eight SDKs ship a test model, one borrows another's, and three ship none" ([docs/guides/agent-sdk.md:177](../../../guides/agent-sdk.md#8-the-sdk-should-ship-a-strict-scripted-test-model-in-a-testing-export-from-the-first-release)).

### Inferences
- A future verified Strands reference would test offline the ADK way: subclass `Model`, or mock Bedrock or Anthropic through a base URL.

### Gaps
- The Python SDK was not checked for a public mock model.

## Interfaces and protocol

### Takeaway
**Different approach.** Strands has no single typed harness protocol under all its interfaces. The library is the in-process interface. The CLI has four modes, Ink TUI, plain, print and an **ACP server** over newline-delimited stdin/stdout (`@agentclientprotocol/sdk` 1.3.0); A2A is also supported. Our plan defines our own JSON-RPC 2.0 protocol (HD6) with stdio first. Strands' ACP choice is a credible alternative for the editor-facing transport.

### Cited Findings
- CLI modes: "Ink", "Plain", "Print", "ACP server — Serve the agent over newline-delimited ACP on stdin/stdout". — [strands-cli/README.md:120-128](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-cli/README.md#L120-L128)
- The CLI depends on `"@agentclientprotocol/sdk": "1.3.0"`, and `acp.ts` builds the agent with `createHarness`. — [strands-cli/package.json:64](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-cli/package.json#L64); [strands-cli/src/cli/acp.ts:1-2](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-cli/src/cli/acp.ts#L1-L2)
- "Print and ACP-server mode never prompt", and they have "no permission UI and therefore use stock harness tool behavior". — [strands-cli/README.md:366](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-cli/README.md#L366); [:426-428](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-cli/README.md#L426-L428)
- The SDK peer-depends on `@a2a-js/sdk` `^0.3.10` (A2A). — [strands-ts/package.json](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-ts/package.json)
- Ours: one typed protocol under SDK, CLI and RPC ([docs/guides/agent-harness.md §8](../../../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport), line 182); HD6 strict JSON-RPC 2.0, 12 methods ([docs/plans/build-harness.md:56](../../../plans/build-harness.md); ADR [0016](../../../decisions/0016-protocol-json-rpc-framing.md)).

### Inferences
- ACP is JSON-RPC 2.0 over stdio, so it is broadly compatible with HD6 framing (inference from general knowledge of ACP; not re-checked here). **Note for the report:** consider an ACP adapter over our protocol rather than ACP as our protocol, because ACP lacks our session-tree and signed-approval operations (inference). **Avoid:** headless modes that silently run with no gate. Our headless default is deny ([docs/guides/agent-harness.md:110](../../../guides/agent-harness.md)).

## Components Strands has that our plan lacks or treats lightly

### Takeaway
Five Strands features are worth noting for the harness or agent plans: long-term memory with background extraction; `programmatic_tool_caller`, a code-mode sandbox in Monty; a delegation tool whose children can never gain tools the parent lacks; per-provider reasoning `effort` mapping; and portable JSON harness profiles. Our main report's staged path defers memory, subagents and code-execution mode until an eval justifies them ([docs/guides/agent-harness.md:255](../../../guides/agent-harness.md#11-every-component-should-be-removable-because-the-value-of-harness-scaffolding-decays-as-models-improve)), so these are "note", not "copy now".

### Cited Findings
- Memory: facts extracted "every few turns on a small, cheap model" into markdown under `./.agent/memory`, plus a `search_memory` tool. A subagent shares it read-only, and extraction runs in the background, so `memoryManager.flush()` is needed at shutdown. — [harness-ts/README.md:395-421](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L395-L421)
- `programmatic_tool_caller` is "a sandbox where it writes code that chains, loops over, and parallelizes its other tools", runs in `@pydantic/monty` `0.0.23` (pinned exactly), and takes `{ allowedTools, timeout }`. — [harness-ts/README.md:115-117](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L115-L117); [:193-196](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L193-L196); [harness-ts/package.json](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/package.json)
- Subagent: "The child's tools are restricted to a subset of this agent's own (it can never gain a capability the parent lacks), and delegation depth is bounded". Children run with sessions off. — [harness-ts/README.md:229-236](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L229-L236); [harness-ts/src/agent.ts:402-403](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/agent.ts#L402-L403)
- Name collisions between consumer tools and built-ins throw ("nothing is silently shadowed"). — [harness-ts/README.md:212-214](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L212-L214); [harness-ts/src/agent.ts:491-497](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/src/agent.ts#L491-L497)
- Skills follow the Agent Skills format: "the model sees the metadata up front and loads the full instructions on demand via a `skills` tool". — [harness-ts/README.md:424-445](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/README.md#L424-L445)

### Inferences
- The tool-collision throw matches our registry's "refuses duplicates at registration" and our "shadowing as a startup error". Strands' "subset of parent tools plus inherited interventions" is a concrete delegation rule our agent plan could adopt if subagents are added.
- Strands loads skills through a `skills` tool, whereas our design has the model read `SKILL.md` by path ([docs/guides/agent-harness.md:174](../../../guides/agent-harness.md)). Both are on-demand; theirs is a tool call, which is easier to gate and log.

## Where Strands sits among our eight verified SDKs, and whether it merits a verified reference

### Takeaway
Architecturally, Strands most resembles **Pi**: an in-process library loop plus an assembled coding agent with a CLI, a skills format and a sandbox seam. On safety and state it resembles **OpenAI Agents**: a run-state snapshot, per-call interrupts that resume as data, OTel spans, and AWS (not OpenAI) as the home cloud. It is a strong candidate for a ninth verified reference. It is Apache-2.0 (mirror can be committed), TypeScript-first-class at SDK 1.25.0, actively released (weekly cadence) and it publishes a full docs site in the repo. The caveats are a young 0.x harness, a fast-moving `main` ahead of the release and no public test model.

### Cited Findings
- Our feature table covers eight SDKs at fixed pins: `@anthropic-ai/claude-agent-sdk@0.3.327`, `@earendil-works/pi-coding-agent@1.5.2`, `@openai/agents@0.21.0`, `ai@7.0.162`, `langchain@1.6.1`, `agents@0.33.0` (+ `@cloudflare/think@0.23.0`), `@google/adk@2.5.0` and `@github/copilot-sdk@1.0.31`, all TypeScript. — [docs/comparison/feature-table.md:3](../../../comparison/feature-table.md)
- Loop-ownership spectrum: Claude and Copilot own the loop in a runtime; Pi and others are in-process. — [docs/comparison/deep-comparison.md:42](../../../comparison/deep-comparison.md#loop-ownership-decides-how-much-you-can-replace)
- State locations: Pi writes a tree; OpenAI and ADK use session services; Vercel is stateless; LangChain uses a checkpointer. — [docs/comparison/deep-comparison.md:52-63](../../../comparison/deep-comparison.md#state-lives-in-eight-places)
- Safety poles: Claude has six ordered steps and Pi none; OpenAI, Vercel, LangChain, Cloudflare and ADK sit between. — [docs/comparison/deep-comparison.md:44-48](../../../comparison/deep-comparison.md#safety-defaults-range-from-six-permission-steps-to-none)
- Strands licence: Apache-2.0 for the harness, SDK and CLI packages (npm `license` field). TypeScript SDK on Node 22+ ESM ([README.md:133](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L133)). Release cadence: SDK 1.23.0 (2026-10-30), 1.24.0 (2026-11-04), 1.25.0 (2026-11-13); harness 0.3.3 (2026-10-30), 0.3.4 (2026-11-04), 0.4.0 (2026-11-12). — [npm registry](https://registry.npmjs.org/@strands-agents/sdk)
- The harness requires `@strands-agents/sdk >=1.25.0 <2.0.0` as a peer and declares `engines.node >=22.0.0`. — [harness-ts/package.json](https://github.com/strands-agents/harness-sdk/blob/84d814b/harness-ts/package.json)
- The docs site is in-repo (Astro/Starlight) under `site/`, with harness pages for sessions, interventions, context and caching, MCP and so on. — [README.md:60](https://github.com/strands-agents/harness-sdk/blob/84d814b/README.md#L60); `site/src/content/docs/user-guide/harness/` listing.
- Our process requires mirroring docs from the git tag that matches the pinned npm version and committing the mirror only for MIT or Apache-2.0. — [AGENTS.md](../../../../AGENTS.md#process-for-documenting-an-sdk)

### Inferences
- A one-line placement for the report: "Strands = Pi's shape (library + assembled agent + CLI) with OpenAI's state model (snapshot + interrupt resume) and Claude-like breadth (Cedar, classifier, sandbox seam), but with the weakest safety defaults of the group after Pi: no gate, no isolation, inherited env, content-on telemetry."
- Feasibility of a verified reference: high. (1) The Apache-2.0 docs mirror can be committed. (2) Pin `@strands-agents/sdk@1.25.0` and `@strands-agents/harness@0.4.0`; on 2026-11-18 they are six and five days old (published 2026-11-12 and 2026-11-13), so they clear the repo's one-week age rule on 2026-11-19 and 2026-11-20; a pin made earlier must take the previous releases (harness 0.3.4, SDK 1.24.0, both 2026-11-04). (3) Offline tests need a hand-written `Model` subclass or an HTTP mock of the Anthropic API, because there is no public test model. (4) The default Bedrock model and `NotASandboxLocalEnvironment` mean the harness must scrub AWS credentials and pass a `sandbox` explicitly. This is exactly the AGENTS.md rule about inherited credentials.
- The docs site renders `main`, which runs ahead of the release (in-repo versions read `0.0.1-development`). Per our step 1 we would mirror from the tag for 1.25.0 / 0.4.0 and record pages where the live site is ahead.

### Gaps
- Release tags and the tag-to-commit mapping were not fetched (the API was blocked), so how far `main` sits from 0.4.0 is unknown.
- Community size (stars, contributors) is unknown for the same reason.

## Copy / avoid / note summary (for the report writer)

### Takeaway
Copy seven ideas, avoid six defaults, and note four approaches as alternatives to watch. Each is backed by the sections above.

### Cited Findings
- **Copy:** (1) declarative context strategies `Offload.*.when({...})` and the stash-plus-retrieval tool (Compaction section); (2) `guide` as a gate outcome, including after-model retry (Approvals section); (3) Cedar as a policy backend (Approvals section); (4) bypass mode settable only from user-level config (Approvals section, [strands-cli/README.md:415-418](https://github.com/strands-agents/harness-sdk/blob/84d814b/strands-cli/README.md#L415-L418)); (5) the six-operation `Sandbox` interface with honest naming of the no-isolation tier (Sandbox section); (6) telemetry "unset means off", set up once per process (Telemetry section); (7) a non-fatal MCP server failure per server, and collisions that throw (MCP and extras sections).
- **Avoid:** an overwritten snapshot as the session record; splicing originals out of context with no log entry; no gate by default and silent headless runs; classifier allows and tool-wide trust; unsigned resumable approvals; an unconfined default sandbox with inherited `process.env`; content-on telemetry.
- **Note:** ACP as an editor transport; Harbor as a cross-harness eval runner; long-term memory extraction; `programmatic_tool_caller` (code mode); the subagent "subset of parent tools plus inherited interventions" rule.

### Inferences
- Strands is a useful contrast case for our §6 claim that the sandbox and the credential boundary are separate components. It has the sandbox seam but no credential boundary.
