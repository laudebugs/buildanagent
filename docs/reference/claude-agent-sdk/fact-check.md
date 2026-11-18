# Claude Agent SDK docs: fact-check

**Docs:** the 32 pages under `code.claude.com/docs/en/agent-sdk/`, fetched 2026-11-18.
**Package:** `@anthropic-ai/claude-agent-sdk@0.3.327` (TypeScript), with its bundled CLI.
**How:** four automated tiers plus our own behavioral tests, all in [`verify/claude-agent-sdk/`](../../../verify/claude-agent-sdk/). The raw results are in `verify/claude-agent-sdk/results/`.

**Bottom line:** the docs are accurate. Across 385 TypeScript blocks, no complete example disagrees with the published types, apart from a page that deliberately documents removed APIs. Every behavioral claim we tested held. The issues found are small: gaps in the reference, one example with a race, and an SDK error message that sends you the wrong way.

## Tier 1: every TypeScript block type-checks against the package

Each of the 385 ```` ```typescript ```` blocks across 27 pages was compiled on its own against the pinned package (`tsc` 7, strict). Errors were then classified (`scripts/typecheck-examples.mjs`).

| Status | Blocks | Meaning |
|---|---|---|
| pass | 232 | Compiles cleanly (93 of these import the SDK) |
| fragment | 121 | Only "missing context" errors: the block uses names defined elsewhere on the page. No API errors |
| signature | 13 | Reference-style signatures with no body, from `typescript.md` |
| documented-removed | 11 | `typescript-v2-preview.md` documents `unstable_v2_*` APIs that the page itself says were removed in 0.3.142. The package agrees |
| syntax | 7 | Intentional partial snippets: a `return` outside a function, or object-literal fragments |
| api-mismatch | 1 | `typescript.md:31` imports `@anthropic-ai/claude-agent-sdk-darwin-arm64/claude`, the macOS binary package, which isn't installed on Linux. Platform-specific, **not drift** |

**Result: zero real API drift in the docs' TypeScript examples.**

## Tier 2: complete examples run against a mock model

All 87 blocks that were complete and passed Tier 1 were run end to end (`scripts/run-examples.mjs`). Each ran with the real SDK and its bundled CLI, with `ANTHROPIC_BASE_URL` pointed at a local mock of the Messages API (`scripts/mock-anthropic.mjs`) and a 60-second timeout, in a fresh temp `cwd`. Placeholder paths such as `/path/to/repo` were replaced with that temp dir in 3 blocks, and `fixtures/` supplies files the examples expect.

| Outcome | Count | Notes |
|---|---|---|
| ran | 70 | Exit 0 after at least one model request |
| exited-no-model-call | 7 | Define tools without calling `query()` (5), or resume a placeholder session id `"..."` (1). `typescript__08` defines a tool only |
| skipped | 6 | Need an external MCP server process or a remote URL (5), or Bedrock/Vertex (1) |
| error | 4 | `hosting__03` and `hosting__04` use `declare const` placeholders that are undefined at runtime. `sessions__03` resumes `"..."`. `streaming-vs-single-mode__03` has a race, see finding F3 |

**Scope limit.** The mock calls custom (`mcp__*`) tools, `ToolSearch` and `StructuredOutput`, but never built-in tools like Bash or Edit. That's deliberate, so that running docs code can't change the host. For most doc examples, this tier therefore proves the CLI accepts the configuration and completes the loop. It does not prove built-in tool behavior. Only one doc example reached a tool call.

## Tier 3: documented API surface vs the package's types

`scripts/factcheck-api.mjs` compares `typescript.md` with `sdk.d.ts` and `sdk-tools.d.ts`.

| Surface | Docs | Package | Differences |
|---|---|---|---|
| Permission modes | 6 | 6 | None |
| Hook events | 33 | 33 | None |
| `SDKMessage` members | 39 | 40 | `SDKSessionWritesLostMessage` is undocumented: it fires when disk is full and transcript writes are lost |
| `Options` fields | 66 | 70 | 5 undocumented (below). `outputStyle` is listed in the docs table but marked "Not an `Options` field", which is correct |
| Exported functions | 13 | 21 | 8 not in the reference (below) |
| Built-in tool input schemas | 40 | 44 | Names differ by convention: docs `Edit`/`Read`/`Write` are `FileEdit*`/`FileRead*`/`FileWrite*` types. The docs keep entries for removed `REPL` and `TaskOutput`, with removal notes that match the package. 6 schemas are undocumented: `ClaudeDesign`, `OfferChromeSetup`, `ProposeGoal`, `ProposeSkills`, `ReadNotifications`, `SendFeedback` |

**Undocumented `Options`.** All five have JSDoc in the package; they're niche or multi-client:
- `mcpServersDelivery` and `pluginDelivery`: `'argv' | 'initialize'`. The `argv` default for MCP servers is slated for deprecation with a `DeprecationWarning`.
- `onUserDialog`, `supportedDialogKinds` and `perTaskStopAffordance`: these handle dialogs and background-task stopping for multi-client sessions.

**Functions missing from the reference:**
- `archiveSession`, `unarchiveSession`, `deleteSession`: session management. `deleteSession` is mentioned only in `session-storage.md`.
- `getSubagentMessages`, `listSubagents`, `foldSessionSummary`: covered in `session-storage.md`, but not in the reference.
- `importSessionToStore` and `filterEscalatingDefaultMode`: tagged `@alpha`.

## Tier 4: behavioral claims tested by our own examples

Seven programs in `verify/claude-agent-sdk/examples/` assert documented behavior against the mock. All pass.

| Claim (doc page) | Test | Result |
|---|---|---|
| A run yields `system/init` first and ends with a `result` carrying `session_id`, `total_cost_usd`, `num_turns` (agent-loop) | 01 | ✅ |
| Custom tools get Zod-validated args and are named `mcp__<server>__<tool>` (custom-tools) | 02 | ✅ |
| Unlisted tools fall through to `canUseTool` (permissions, step 6) | 03a | ✅ |
| `allowedTools` approves before `canUseTool`, and the SDK warns `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` (permissions) | 03b | ✅ |
| `disallowedTools` wins even in `bypassPermissions`, and `canUseTool` isn't called (permissions, step 2) | 03c | ✅ (the tool is removed from the model's tool list entirely) |
| A `PreToolUse` hook `deny` blocks a tool that `allowedTools` would approve (permissions, step 1) | 03d | ✅ |
| A hook `allow` does not override deny rules (permissions, step 1) | 03e | ✅ |
| `dontAsk` denies without calling `canUseTool` (permissions, step 6) | 03f | ✅ |
| `maxTurns` exhaustion gives `error_max_turns` with no `result` text, and `query()` then throws "Reached maximum number of turns" (agent-loop) | 04 | ✅ |
| Structured output goes through the `StructuredOutput` tool and lands on `result.structured_output` (structured-outputs) | 05, 07 | ✅ |
| The SDK validates schemas as draft-07, so a Zod default 2020-12 schema is rejected (structured-outputs) | 05 (first draft) | ✅. The CLI exits 1 with `--json-schema is not a valid JSON Schema` |
| `resume` keeps the session id and sends the earlier turns (sessions) | 06 | ✅ |
| `tools: []` removes built-in tools (custom-tools) | 07 | ✅ |
| Tool search is on by default behind an `ANTHROPIC_BASE_URL` gateway, deferring MCP tools behind `ToolSearch` (tool-search) | mock behavior | ✅. MCP tools were absent from the initial tool list until `ToolSearch select:` loaded them |
| `hosting.md`'s resource, `SessionStore` and limitation claims | — | Checked by reading, not by execution (see the repo's `docs/research/fact-check-2026-11-18.md`) |

## Findings

**F1. A nonexistent `cwd` produces a misleading error.** This is an SDK issue, not a docs error. With `cwd: "/does/not/exist"`, `query()` throws: *"Claude Code native binary at … exists but failed to launch. This usually means the binary does not match this system's libc…"*. The real cause is the missing directory. `troubleshooting.md` doesn't mention it. Workaround: check that `cwd` exists before calling `query()`.

**F2. Placeholder values in "complete-looking" examples.** Several runnable-looking blocks only work after you edit them: `/path/to/repo`, `/work/session-a`, session id `"..."`, `declare const prompt`. The docs present these as templates, which is reasonable, but copy-paste fails at runtime, sometimes with F1's misleading error.

**F3. Race in the interrupt example.** In `streaming-vs-single-mode.md:231`, `interrupt()` runs in a `setTimeout` three seconds after `init`. If the conversation finishes first (fast model, short answers), `interrupt()` rejects with `Query closed before response received`. The async timer callback has no `try`, so the rejection is unhandled and the process crashes. The fix is to wrap the call in `try`/`catch` or skip it once the result has arrived.

**F4. Reference gaps.** Covered in Tier 3: 8 functions, 5 options, 1 message type and 6 tool schemas exist in the package but not in `typescript.md`. Most are `@alpha` or niche.

**F5. Host configuration leaks into test isolation.** This is environment-specific. On this cloud host, the spawned CLI offered extra deferred tools (such as `ListPlugins` and `SuggestConnectors`) and extra agent types, even with a private `CLAUDE_CONFIG_DIR` and `settingSources: []` in example 07. The likely sources are inherited `CLAUDE_CODE_*` environment variables (the runner passes `process.env` through) or managed settings. We didn't isolate which. In production, build the subprocess `env` explicitly and audit `init.tools`.

## Reproduce

```bash
cd verify/claude-agent-sdk
npm install
npm run fetch-docs   # mirror the docs (gitignored, © Anthropic)
npm run verify       # extract -> type-check -> run docs examples -> API diff -> our tests
```
