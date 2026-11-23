# The Claude Agent SDK docs match the package: a four-tier fact-check

A developer who copies an example from SDK docs needs it to compile and run against the release they installed. To test that promise, I checked all 32 pages under `code.claude.com/docs/en/agent-sdk/`, fetched on 2026-11-18, against `@anthropic-ai/claude-agent-sdk@0.3.327` and its bundled CLI. Four automated tiers did the checking: type-checks, mock-model runs, an API-surface diff and behavioral tests. All of them live in [`verify/claude-agent-sdk/`](../../../verify/claude-agent-sdk/), with raw output in `verify/claude-agent-sdk/results/`. The docs passed. Across 385 TypeScript blocks, no complete example contradicts the package's types, and every behavior we tested matched its description. The problems I found are small: one misleading SDK error, one racy example, examples that need placeholder values, reference gaps, and an isolation leak through inherited environment variables.

## Reproduce the checks in two commands

```bash
pnpm install              # at the repo root: installs every harness
cd verify/claude-agent-sdk
pnpm run fetch-docs       # mirror the docs (gitignored, © Anthropic)
pnpm run verify           # extract -> type-check -> run docs examples -> API diff -> our tests
```

## Tier 1: every TypeScript block compiles, apart from intentional fragments

I compiled each of the 385 ```` ```typescript ```` blocks from 27 pages on its own, against the pinned package, with `tsc` 7 in strict mode. A script then sorted the errors into kinds (`scripts/typecheck-examples.mjs`). Only one block failed for an API reason, and that failure comes from the platform rather than the docs:

| Status | Blocks | Meaning |
|---|---|---|
| pass | 232 | Compiles cleanly; 93 of these import the SDK |
| fragment | 121 | Uses names defined elsewhere on its page; no API errors |
| signature | 13 | Reference-style signatures without bodies, from `typescript.md` |
| documented-removed | 11 | `typescript-v2-preview.md` shows `unstable_v2_*` APIs that it says 0.3.142 removed, and the package agrees |
| syntax | 7 | Intentional partial snippets, such as a `return` outside a function |
| api-mismatch | 1 | `typescript.md:31` imports the macOS binary package `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`, which Linux installs omit |

## Tier 2: 69 of 87 complete examples run against the mock API

I ran every block that looked complete and passed Tier 1, 87 in all, with the real SDK and its bundled CLI (`scripts/run-examples.mjs`). `ANTHROPIC_BASE_URL` pointed each run at the mock API, a local mock of the Anthropic Messages API (`scripts/mock-anthropic.mjs`). Each block also got a fresh temp `cwd`, files from `fixtures/`, an allowlisted environment and a 60-second timeout. In three blocks, the harness replaced placeholder paths such as `/path/to/repo` with the temp directory. The 18 runs that fell short failed for reasons outside the docs' control:

| Outcome | Count | Notes |
|---|---|---|
| ran | 69 | Exited 0 after at least one model request |
| exited-no-model-call | 8 | Define tools without calling `query()` (6), resume the placeholder session id `"..."` (1), or enable the sandbox on a host without bubblewrap (1). That last block (`typescript.md:6129`) stops with "Sandbox required but unavailable", as its comment predicts, because `failIfUnavailable` defaults to true |
| skipped | 6 | Need an external MCP server process or a remote URL (5), or Bedrock or Vertex (1) |
| error | 4 | `hosting__03` and `hosting__04` reference `declare const` placeholders; `sessions__03` resumes `"..."`; `streaming-vs-single-mode__03` has a race (finding F3) |

This tier has one deliberate limit. The mock API calls custom `mcp__*` tools, `ToolSearch` and `StructuredOutput`, but never Bash, Edit or other built-in tools, so docs code can't change the host. For most doc examples, a pass therefore shows that the CLI accepts the configuration and completes the loop. A pass doesn't show that built-in tools behave as described, and only one doc example reached a tool call.

## Tier 3: the reference omits some exports but contradicts none

A script compares `typescript.md` with `sdk.d.ts` and `sdk-tools.d.ts` (`scripts/factcheck-api.mjs`). In every surface it checks, the package contains everything the docs describe, and the differences run one way: the package has more.

| Surface | Docs | Package | Differences |
|---|---|---|---|
| Permission modes | 6 | 6 | None |
| Hook events | 33 | 33 | None |
| `SDKMessage` members | 39 | 40 | The reference omits `SDKSessionWritesLostMessage`, which fires when a full disk loses transcript writes |
| `Options` fields | 66 | 70 | The reference omits 5 fields (below). The docs list `outputStyle` but correctly mark it "Not an `Options` field" |
| Exported functions | 13 | 21 | The reference omits 8 functions (below) |
| Built-in tool input schemas | 40 | 44 | Names differ by convention: docs `Edit`, `Read` and `Write` map to `FileEdit*`, `FileRead*` and `FileWrite*` types. The docs keep entries for the removed `REPL` and `TaskOutput` tools, with removal notes that match the package. The reference omits 6 schemas: `ClaudeDesign`, `OfferChromeSetup`, `ProposeGoal`, `ProposeSkills`, `ReadNotifications` and `SendFeedback` |

**The five omitted `Options` serve niche or multi-client setups.** The package documents each one in JSDoc:
- `mcpServersDelivery` and `pluginDelivery` take `'argv' | 'initialize'`. A future release plans to deprecate the `argv` default for MCP servers, with a `DeprecationWarning`.
- `onUserDialog`, `supportedDialogKinds` and `perTaskStopAffordance` handle dialogs and background-task stopping when several clients share a session.

**The eight omitted functions cover sessions and alpha features:**
- `archiveSession`, `unarchiveSession` and `deleteSession` manage sessions; only `session-storage.md` mentions `deleteSession`.
- `getSubagentMessages`, `listSubagents` and `foldSessionSummary` appear in `session-storage.md` but not in the reference.
- `importSessionToStore` and `filterEscalatingDefaultMode` carry `@alpha` tags.

## Tier 4: every behavioral claim we tested held

Seven programs in `verify/claude-agent-sdk/examples/` assert documented behavior against the mock API, and all seven pass:

| Claim (doc page) | Test | Result |
|---|---|---|
| A run yields `system/init` first and ends with a `result` carrying `session_id`, `total_cost_usd` and `num_turns` (agent-loop) | 01 | ✅ |
| Custom tools receive Zod-validated args and appear as `mcp__<server>__<tool>` (custom-tools) | 02 | ✅ |
| Unlisted tools fall through to `canUseTool` (permissions, step 6) | 03a | ✅ |
| `allowedTools` approves before `canUseTool`, and the SDK warns `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` (permissions) | 03b | ✅ |
| `disallowedTools` wins even in `bypassPermissions`, and `canUseTool` never runs (permissions, step 2) | 03c | ✅ The CLI removes the tool from the model's list entirely |
| A `PreToolUse` hook `deny` blocks a tool that `allowedTools` would approve (permissions, step 1) | 03d | ✅ |
| A hook `allow` leaves deny rules in force (permissions, step 1) | 03e | ✅ |
| `dontAsk` denies without calling `canUseTool` (permissions, step 6) | 03f | ✅ |
| Exhausting `maxTurns` yields `error_max_turns` without `result` text, and `query()` then throws "Reached maximum number of turns" (agent-loop) | 04 | ✅ |
| Structured output goes through the `StructuredOutput` tool and lands on `result.structured_output` (structured-outputs) | 05, 07 | ✅ |
| The SDK validates schemas as draft-07 and rejects Zod's default 2020-12 output (structured-outputs) | 05, first draft | ✅ The CLI exits 1 with `--json-schema is not a valid JSON Schema` |
| `resume` keeps the session id and sends the earlier turns (sessions) | 06 | ✅ |
| `tools: []` removes the built-in tools (custom-tools) | 07 | ✅ |
| Tool search runs by default behind an `ANTHROPIC_BASE_URL` gateway and defers MCP tools behind `ToolSearch` (tool-search) | mock API behavior | ✅ MCP tools stayed out of the initial list until `ToolSearch select:` loaded them |
| `hosting.md` claims about resources, `SessionStore` and limitations | — | Checked by reading only; see `docs/research/fact-check-2026-11-18.md` |

## Five findings: one SDK error, one racy example, two doc gaps and one isolation lesson

**F1. A missing `cwd` produces a misleading SDK error.** With `cwd: "/does/not/exist"`, `query()` throws: *"Claude Code native binary at … exists but failed to launch. This usually means the binary does not match this system's libc…"*. The real cause is the missing directory, and `troubleshooting.md` doesn't cover it. Until the SDK fixes the message, check that `cwd` exists before calling `query()`.

**F2. Placeholder values make complete-looking examples fail at runtime.** Several runnable-looking blocks work only after you replace values such as `/path/to/repo`, `/work/session-a`, the session id `"..."` or `declare const prompt`. The docs present these blocks as templates, which is reasonable, but a straight copy and paste fails, sometimes with F1's misleading error.

**F3. The interrupt example crashes when the model answers quickly.** In `streaming-vs-single-mode.md:231`, a `setTimeout` calls `interrupt()` three seconds after `init`. When the conversation finishes first, `interrupt()` rejects with `Query closed before response received`. Because the async timer callback has no `try`, that rejection goes unhandled and crashes the process. Wrapping the call in `try`/`catch`, or skipping it once the result arrives, fixes the example.

**F4. The reference omits 20 items the package exports.** Tier 3 lists them: 8 functions, 5 options, 1 message type and 6 tool schemas. Most carry `@alpha` tags or serve niche setups.

**F5. Inherited environment variables leak host configuration into the CLI.** The first harness passed `process.env` to each run. On this cloud host, the spawned CLI then offered the host's extra deferred tools, such as `ListPlugins` and `SuggestConnectors`, even with a private `CLAUDE_CONFIG_DIR` and `settingSources: []`, and it called the host's agent-proxy endpoint. After the runner switched to an allowlisted environment (`PATH`, a temp `HOME`, `TMPDIR`, `LANG` and the mock settings), those tools and that request disappeared, and the host has no managed-settings file. The inherited environment was therefore the cause. Production deployments should build the CLI's `env` from an allowlist and audit `init.tools`.

## Update to @anthropic-ai/sdk 1.8.0 (2026-11-23)

The weekly update job moved the harness's `@anthropic-ai/sdk` from `0.129.0` to `1.8.0`, a major release published 2026-11-10 (PR #372). The package under test, `@anthropic-ai/claude-agent-sdk`, stays at 0.3.327. It declares `@anthropic-ai/sdk >=0.93.0` as a peer dependency, so 1.8.0 satisfies it. The owner merged #372 before this sweep, so this section follows the merge. I compared the committed results before the bump (commit `a393130b`, the parent of #372's merge commit) with the merged ones, block by block.

| Measure | 0.129.0 run | 1.8.0 run |
|---|---|---|
| Blocks type-checked | 385 | 385, same ids |
| Type-check status or error list changed | n/a | 0 blocks |
| Doc blocks that ran, skipped, exited without a call, errored | 69 / 6 / 8 / 4 | 69 / 6 / 8 / 4 |
| Doc blocks whose outcome, exit code, request count or tool-result count changed | n/a | 0 |
| Own examples that ran | 10 of 10 | 10 of 10 |
| Transcripts under `results/transcripts/` | n/a | unchanged |

- **The line numbers moved because the docs did, not the SDK.** The bump commit's `typecheck-docs.json` and `run-docs.json` shift `line` values and three blocks (`typescript__60`, `__158`, `__180`) grew by one or two lines. Those pages come from the regenerated live-site mirror. Ignoring `line` and `lines`, no block changed its status or its error codes and messages.
- **Other run-to-run noise.** Machine paths, timings, session ids and node process ids differ in `run-docs.json` and `run-examples.json`. `03-permission-order.ts` shows 14 model requests in the merged file against 13 before. The cause is who ran it, not the SDK: the earlier file came from a local run as root, and the update job's file from CI as a non-root user. The CLI refuses `bypassPermissions` as root, so query c) never reaches the model in a root run (verify README, "Transcripts"). A root run on 1.8.0, which I repeated here, gives 13 again.
- **The peer is not on the request path.** The package imports `@anthropic-ai/sdk` only in `sdk.d.ts`, for the types `BetaMessage`, `BetaRawMessageStreamEvent`, `BetaUsage` and `MessageParam`. Its JavaScript never loads it, and the bundled CLI makes the API calls, so the harness's mock Messages API still receives the CLI's requests. The 1.x client sends its key as `Authorization: Bearer`, where 0.x sent `x-api-key`, but that client never calls the mock. The mock, the harness scripts, the examples and the transcripts mention neither header, and the runner passes a placeholder `ANTHROPIC_API_KEY`.
- **The API-surface diff is unchanged.** `factcheck-api.json` differs only by its `checkedAt` time.
- **Nothing in the reference, skill or manual cites the peer's version or its types.** The manual's fact-check logs name `sdk.d.ts` for `claude-agent-sdk` only, which did not change.

## TypeScript parity

Anthropic ships the SDK in TypeScript and Python, and the [TypeScript gap report](../../comparison/typescript-gaps.md#claude-agent-sdk-typescript-leads-python-and-trails-it-in-two-small-places) compares 0.3.327 with Python `claude-agent-sdk` 0.2.183 at tag `v0.2.183`. TypeScript is the richer package: it declares 33 hook events against Python's 10, plus runtime controls such as `applyFlagSettings` and options such as `persistSession` that the docs mark TypeScript-only. Python leads in two small places. It ships a session-store conformance suite in the package, where TypeScript users copy one from the examples, and it can run the CLI as another OS user, which TypeScript leaves to `spawnClaudeCodeProcess`. Neither Python-only item touches the agent loop.

## Verdict: trust the examples, and test the edges yourself

The Claude Agent SDK docs hold up under automated checking. Their TypeScript examples compile against the release they describe, and their descriptions of the agent loop, the permission order, structured output and sessions match what the package does. A team can build on the examples directly, provided it substitutes the placeholder values (F2), wraps `interrupt()` in `try` (F3), and validates `cwd` itself (F1). For features beyond the reference, such as session archiving and multi-client dialogs, read `sdk.d.ts` and rerun `npm run verify` after every SDK upgrade.
