# GitHub Copilot SDK docs: the strict-marked examples hold up and the runtime behaves as tested, but the permission docs describe the wrong default

A developer who copies an example from the Copilot SDK docs needs it to compile and run against the release they installed. To test that promise, I checked the docs in `github/copilot-sdk` at tag `v1.0.31` (commit `15de061`, 2026-11-10) against `@github/copilot-sdk@1.0.31` and the Copilot runtime 1.0.109 that it bundles. The mirror holds 53 pages with 440 TypeScript and JavaScript blocks, plus 15 TypeScript example and sample files. The runtime is a separate process that owns the agent loop, so every run used the real runtime. Its model calls went to a local mock through the SDK's BYOK provider, inside a network namespace that reaches only loopback. Four automated tiers did the checking: type-checks, offline runs, an API-surface diff and behavioral tests. All of them live in [`verify/copilot-sdk/`](../../../verify/copilot-sdk/), with raw output in `verify/copilot-sdk/results/`. The results split cleanly. None of the 68 blocks the docs mark `docs-validate: strict` has an API error, and 22 of 23 documented behaviors held. The one that failed matters most: a session without a permission handler denies tool calls instead of leaving them pending. Most remaining problems sit in the hook pages. The rest are an untyped event family, two blocks that use an unstarted client, thin reference coverage and custom tools lost on resume, and four defaults make an embedded agent a full coding agent.

## Reproduce the checks in three commands

```bash
pnpm install              # at the repo root: installs every harness, including the runtime's platform package
cd verify/copilot-sdk
pnpm run fetch-docs       # mirror the docs from tag v1.0.31 (committed; MIT)
pnpm run verify           # extract -> type-check -> triage -> run docs examples -> API diff -> our tests
```

The runner needs Linux user and network namespaces (`unshare -rn`). To rerun one example without rewriting `results/`, run `node scripts/run-examples.mjs examples --only 09-triage-agent --verbose` from `verify/copilot-sdk`.

## Tier 1: 132 of 455 sources compile as written, and every mismatch sits in the hook pages

I compiled each block and example file on its own against the pinned package, with `tsc` 7 in strict mode, and a script sorted the errors into kinds (`scripts/typecheck-examples.mjs`, `results/typecheck-docs.json`). Most pages build a `client` or `session` in one block and use it in the next, so most blocks are fragments.

| Status | Sources | Meaning |
|---|---|---|
| pass | 132 | Compiles cleanly; 117 import the SDK, and 83 look complete enough to run |
| fragment | 298 | Uses names defined elsewhere on the page, usually `client` or `session` |
| syntax | 19 | Deliberate snippets, such as bare object literals of options |
| api-mismatch | 6 | Five hook pages that import types the package doesn't export (F2), and one hook that returns `null` (F4) |

**A second pass re-checked 218 fragments with `client` and `session` declared.** It declared only the names a block was missing, as `CopilotClient` and `CopilotSession`. Of the 218, 138 then passed, 44 stayed fragments because of other undeclared names, and 36 showed API mismatches the missing names had hidden. Two blocks are excluded by hand: one whose `session` is Electron's, and one whose schema lives in a hidden twin block (`PRELUDE_CONTEXT_IDS`).

**The docs' own validation markers predict the result.** Upstream marks blocks with `<!-- docs-validate: strict -->`, `hidden` or `skip`, and the extractor records the nearest marker. None of the 68 blocks marked `strict` has an API error in either pass. All 42 blocks with API errors come from `docs/hooks/` and `docs/features/hooks.md`, and they carry no marker (37) or only `hidden` (5). A `hidden` block is a complete twin of the visible fragment that follows it, with the imports and `declare` lines that a check needs.

`scripts/mismatch-causes.mjs` groups the API errors from both passes by cause (`results/mismatch-causes.json`):

| Cause | Errors | Blocks | Finding |
|---|---|---|---|
| Hook handler returns `null` | 51 | 37 | F4 |
| Hook type imported from the package root, which doesn't export it | 15 | 5 | F2 |
| `ToolResultObject` field that doesn't exist | 4 | 3 | F5 |

## Tier 2: 50 of 83 complete doc blocks ran, and 3 failed

I ran every complete, type-clean block, 83 in all, with the real SDK and runtime (`scripts/run-examples.mjs`, `results/run-docs.json`). A preload injected the mock provider into each `createSession` and `resumeSession` call, replacing any provider the block set, because the CLI's own `COPILOT_PROVIDER_*` variables do not configure SDK sessions. A block counts as run once its last statement executes. The runner then waits 3 seconds and stops it, because 29 blocks never call `client.stop()` and the runtime child keeps them alive.

| Outcome | Blocks | Notes |
|---|---|---|
| ran, model called | 15 | Getting started, image input, persistence, skills, steering, the Microsoft Agent Framework page, `bundled-cli.md`, the README Quick Start and `basic-example.ts` |
| ran, no model call | 35 | Blocks that configure or inspect without sending a prompt |
| skipped | 30 | An external runtime server (11), third-party credentials (4), a CLI at a fixed path (4), cloud sessions or AHP hosts (4), `declare` placeholders (3), an MCP process or remote endpoint (2), a diagnostics tail that never ends (1), stdin (1) |
| error | 3 | Two call `client.rpc` before `start()` (F3); `plugin-directories.md:483` needs enterprise managed settings, an environment limit rather than a docs error |

This tier has one deliberate limit. The mock calls only tools a block registers, and it denies the runtime's host tools by name, so no doc block ran `bash`, `edit` or `web_fetch`. Only three blocks reached a tool call at all: `get_weather` in `getting-started.md:905`, `GetWeather` in `microsoft-agent-framework.md:204` and `lookup_fact` in `nodejs/examples/basic-example.ts`. A pass therefore shows that the runtime accepts a block's configuration and completes its turn, not that the built-in tools behave as described.

## Tier 3: the package has everything the docs name, except 11 hook-related types, and it has much more

A script compares the documented surface with the package's `.d.ts` files (`scripts/factcheck-api.mjs`, `results/factcheck-api.json`). Apart from the hook types, every difference runs one way: the package has more than the docs describe.

| Surface | Docs | Package | Differences |
|---|---|---|---|
| Root imports | 31 names | 1,027 exports | 11 documented names the root doesn't export: ten hook input and output types and `HookInvocation` (F2) |
| `CopilotClientOptions` | 15 | 21 | README omits 6, such as `clientInfo`, `entra`, `network` and `requestHandler` (F7) |
| `createSession` config | 22 in the README | 98 | 42 of the other 76 appear on some page, such as `availableTools`, `mcpServers` and `streaming`; 34 appear on none, such as `toolSearch`, `onEvent` and `managedSettings` (F7) |
| Client methods | 11 | 19 | README omits 8, such as `getAuthStatus`, `listModels` and `rpc` |
| Session methods | 13 | 21 | README omits 8, such as `getRawEvents`, `log` and `rpc` |
| Event types | 50 | 191 typed | 141 typed events are undocumented; 10 emitted `model.*` types are not typed at all (F6) |
| Tool fields | 11 | 12 | `namespace` is undocumented |
| Permission result kinds | 7 | 8 | `approve-read-only-for-session` is undocumented; 9 legacy past-tense kinds are also accepted |
| Permission request kinds | 8 | 12 | `workflow` and three `extension-*` kinds are undocumented |
| Hooks | 12 | 12 | None |
| `ProviderConfig` | 8 | 15 | `byok.md` omits 7, such as `headers`, `transport` and `maxOutputTokens` (F7) |

## Tier 4: 22 of 23 documented behaviors held

Ten programs in `verify/copilot-sdk/examples/` assert behavior against the real runtime, and all ten pass offline. Example 00 checks the sandbox itself. Doc pages are under `source/`.

| Claim (doc page) | Test | Result |
|---|---|---|
| `sendAndWait` resolves with the final `assistant.message` (`nodejs/README.md`, "sendAndWait") | 01 | ✅ |
| A turn emits `assistant.turn_start`, `assistant.message`, `assistant.turn_end`, then `session.idle` (`docs/features/streaming-events.md`) | 01 | ✅ |
| By default the runtime exposes its first-party tools, "similar to running the CLI with `--allow-all`" (`README.md`, FAQ) | 01, 04 | ✅ 19 built-ins, `bash` included |
| `defineTool` converts a Zod schema to JSON Schema and passes parsed arguments to the handler (`nodejs/README.md`, "Tools") | 02 | ✅ |
| The permission handler runs before each tool, custom tools included (`nodejs/README.md`, "Permission Handling") | 02 | ✅ kind `custom-tool` |
| A handler's return value reaches the model as the tool result (`nodejs/README.md`, "Tools") | 02 | ✅ |
| `reject` denies the call and surfaces `feedback` to the agent (`nodejs/README.md`, "Permission Result Kinds") | 03 | ✅ The handler never runs |
| Without `onPermissionRequest`, requests are "emitted as events and left pending" (`nodejs/README.md:404`, `:1957`) | 03 | ❌ Denied at once, with no event (F1) |
| `availableTools` and `excludedTools` compose: a tool must match the first and not the second (`availableTools` JSDoc, `dist/types.d.ts`) | 04 | ✅ |
| `BuiltInTools.Isolated` excludes host tools (`dist/toolSet.d.ts`) | 04 | ✅ `bash` and `view` absent; `task` present |
| `mode: "empty"` requires the app to opt in to its tools (`docs/setup/multi-tenancy.md`, `CopilotClientMode` JSDoc) | 04 | ✅ A session without `availableTools` is refused |
| `streaming: true` emits `assistant.message_delta` events (`nodejs/README.md`, "Streaming") | 05 | ✅ The deltas concatenate to the final message |
| A stopped session resumes by id from a new client, with its history (`docs/features/session-persistence.md`) | 06 | ✅ |
| `createSession` starts the client on demand, while `listSessions` needs `start()` (`nodejs/README.md`) | 06 | ✅ "Client not connected" before `start()` |
| A local MCP server's tools appear as `<server-key>-<tool-name>` (`nodejs/README.md`) | 07 | ✅ `orders-order_status` |
| MCP calls go through the permission handler (`nodejs/README.md`, "Custom Permission Handler") | 07 | ✅ kind `mcp` |
| A server's `tools: []` offers none of its tools (`docs/features/mcp.md`) | 07 | ✅ |
| `onPreToolUse` can deny a call and give a reason (`docs/hooks/pre-tool-use.md`) | 08 | ✅ It runs before `onPermissionRequest`, which is never asked |
| `onPostToolUse` can replace the result with `modifiedResult` (`docs/hooks/post-tool-use.md`) | 08 | ✅ |
| `skipPermission: true` runs a tool without a permission prompt (`nodejs/README.md`, "Skipping Permission Prompts") | 09 | ✅ |
| `no-result` leaves a request pending for another answer (`nodejs/README.md`, "Permission Result Kinds") | 09 | ✅ `permissions.handlePendingPermissionRequest` decides it later |
| `sendAndWait(prompt, schema)` returns the parsed value (`nodejs/README.md`, "Structured output (preview)") | 09 | ✅ |
| The typed overload throws on a schema mismatch (same section) | 09 | ✅ `ZodError` |

Example 06 also shows a behavior the docs leave out: custom tools are gone after a resume that doesn't pass them again (F9).

## Ten findings: four doc errors, three type disagreements, two doc gaps and one set of risky defaults

### Doc errors: code or claims that don't match the release

**F1. A session without `onPermissionRequest` denies tool calls, while the docs say it leaves them pending.** The README (`nodejs/README.md:404` and `:1957`) and the `SessionConfigBase.onPermissionRequest` JSDoc (`dist/types.d.ts:2578`) say that without a handler, requests are "emitted as events and left pending" for the pending-permission RPC. The SDK sends `requestPermission: !!config.onPermissionRequest` (`dist/client.js:1711`), and the runtime then denies each call at once. The model reads that permission "could not request permission from user", no `permission.requested` event fires, the handler never runs, and `permissions.pendingRequests()` lists nothing. Example 03 asserts each step. The behavior fails closed, so it is safe, but an app built on the documented flow waits for requests that never arrive. To hold a request for a person, return `{ kind: "no-result" }` from a handler, as example 09 does.

**F3. `docs/features/usage-and-billing.md` calls `client.rpc` on a client it never started.** The blocks at `:920` (`client.rpc.models.list`) and `:1192` (`client.rpc.account.getQuota`) compile, but `new CopilotClient()` followed by `client.rpc` throws "Client is not connected. Call start() first." (`dist/client.js:471–474`). `createSession` starts the client on demand; `rpc`, `listSessions` and the other client methods don't. Both blocks are `hidden` twins, and the visible fragments that follow work if the reader's `client` is already started. Example 06 asserts the same rule for `listSessions`.

**F5. `docs/hooks/post-tool-use.md` reads `ToolResultObject` fields that don't exist (by types; not checked at runtime).** The page reads `input.toolResult.exitCode` (`:445`), writes `modifiedResult: { error, stack }` and reads `.stack` (`:464–470`), and reads `.items` (`:525–527`). `ToolResultObject` (`dist/types.d.ts:534`) has only `textResultForLlm`, `binaryResultsForLlm`, `resultType`, `error`, `sessionLog`, `toolTelemetry` and `toolReferences`. The type checker reports 4 errors in 3 blocks. I did not run these blocks, because they need the built-in shell tool, which the mock never calls, so whether the runtime sends extra fields remains unverified.

**F10. Hook examples match tool names the runtime doesn't offer.** Three hook examples branch on `input.toolName === "shell"` (`docs/hooks/pre-tool-use.md:404`, `post-tool-use.md:445`, `docs/features/hooks.md:1072`), and others list `read_file`, `write_file`, `delete_file`, `list_directory` or `search_codebase`. The README's override note names `edit_file` and `read_file` as built-ins. With our harness's model id (`claude-sonnet-4.5`) on Linux, a one-off probe listed the runtime's 19 built-ins, and none of those names is among them: the shell tool is `bash`, and the file tools are `view`, `create` and `edit`. `shell` is a permission request *kind*, not a tool name. The audit example at `features/hooks.md:1072` asks for confirmation on `shell` and returns `allow` for everything else, so on this runtime it would allow `bash`. Tool names can vary by model and platform (`docs/auth/byok.md`, "Model identity and editing tools"), so match the names your sessions actually see. I found this one while re-checking the draft findings.

### Types that disagree with the docs or the runtime

**F2. The hook pages import ten types the package root doesn't export, and one type that doesn't exist.** `docs/hooks/pre-tool-use.md:17`, `post-tool-use.md:22–26`, `session-lifecycle.md:21`, `user-prompt-submitted.md:17` and `error-handling.md:17` import the input and output types of five hooks, such as `PreToolUseHookInput`, plus `HookInvocation`, from `@github/copilot-sdk`. `dist/types.d.ts` declares the ten hook types, but `dist/index.d.ts` doesn't re-export them, although it does export the matching types of four newer hooks, such as `AgentStopHookInput`. `HookInvocation` exists nowhere; the handlers type their second argument inline as `{ sessionId: string }`. All five failing blocks are `hidden` validation twins, so the docs' own check should have caught them. Until the SDK exports them, derive the types from the exported `SessionHooks`, for example `Parameters<NonNullable<SessionHooks["onPreToolUse"]>>[0]`.

**F4. The hook pages return `null`, which the handler types reject and the runtime accepts.** The TypeScript blocks in `docs/hooks/*.md` and `docs/features/hooks.md` contain 50 `return null` statements. Every hook handler type returns `Output | void` (for example `PreToolUseHandler`, `dist/types.d.ts:1373`), so strict TypeScript reports TS2322: 51 errors in 37 blocks across both passes. The hidden signature blocks on the same pages declare `Promise<Output | null | undefined>`, so the docs and the types disagree outright. At runtime, `null` behaves like no output: example 08 returns `null` from both hooks, and the turn completes normally. Either the types should allow `null`, or the docs should return `undefined`.

**F6. The runtime emits ten `model.*` event types that `SessionEvent` doesn't include.** A plain turn delivers `model.turn_started`, `model.log`, `model.call_start`, `model.model_call_started`, `model.model_call_success`, `model.message`, `model.response`, `model.call_final_result`, `model.turn_ended` and `model.messages_snapshot` to `session.on(handler)`. None appears among the 191 typed event types in `dist/generated/session-events.d.ts`, and no doc page mentions them. A `switch (event.type)` that TypeScript treats as exhaustive therefore meets undeclared values. Example 01 prints the observed types, and `results/factcheck-api.json` lists the gap. I saw these events with the BYOK Anthropic provider and the mock; whether GitHub-hosted models produce the same set is unverified.

### Doc gaps

**F7. The reference covers a fraction of the configuration surface.** The README's `createSession` list documents 22 of 98 `SessionConfig` fields. Of the other 76, 42 appear on some other page, `availableTools` and `mcpServers` among them, and 34 appear on none, including `toolSearch`, `largeOutput`, `onEvent`, `onExitPlanModeRequest`, `onMcpAuthRequest`, `skipCustomInstructions` and `managedSettings`. The README also omits 6 of 21 client options, and `byok.md`'s table omits 7 of 15 `ProviderConfig` fields. Tier 3 lists the permission kinds it omits.

**F9. Custom tools are not kept across a resume, and the docs don't say so.** Resuming without `tools` offers the model none of the session's custom tools (example 06). `docs/features/session-persistence.md:7` says the runtime maintains "tool state", and its table of resume options (`:316–334`) lists `availableTools`, `excludedTools` and `mcpServers` but not `tools`. The page's limitations table says only that "in-memory tool state is lost" (`:825`), which describes handler state, not tool definitions. The README marks other options, such as `skillProvider` and `autopilot`, as "not persisted", but not `tools`. Pass `tools` again on every resume.

### Defaults that matter for an embedding

**F8. A default client and session is a full coding agent with host access.** Each default is documented, and each widens reach:
- `mode` defaults to `"copilot-cli"`, whose JSDoc warns that its tools "can access the host OS environment" (`dist/types.d.ts:236–246`). The model is offered 19 built-ins (examples 01 and 04). A one-off probe, a session run through the harness runner that printed the tools in its first model request, listed them: `bash`, `read_bash`, `stop_bash`, `list_bash`, `view`, `create`, `edit`, `web_fetch`, `semantic_code_search`, `skill`, `run_dynamic_workflow`, `dynamic_workflows_manage`, `sql`, `read_agent`, `list_agents`, `write_agent`, `grep`, `glob` and `task`.
- The Quick Start pairs that mode with `onPermissionRequest: approveAll`, which approves shell commands (`nodejs/README.md`, "Quick Start").
- `env` defaults to inheriting `process.env` (`nodejs/README.md:286`, `dist/client.js:634`).
- `useLoggedInUser` defaults to `true`, so ambient GitHub tokens and logins apply (`nodejs/README.md:299`).

Safe embedding needs `availableTools` on every session, or `mode: "empty"`, which refuses a session without it (example 04). `BuiltInTools.Isolated` is narrower but still includes `task`, which starts sub-agents.

## Corrections to the draft findings

The S8a harness produced nine draft findings (`verify/copilot-sdk/results/findings-draft.md`). I re-checked each against its file and line in `source/` or `node_modules`, and reran examples 03 and 09 with `--only`. All nine held. Seven changed in detail, and one finding is new:

| Draft | Draft claim | Correction | Evidence |
|---|---|---|---|
| F2 | Five hook pages import types the root doesn't export | Kept. All five blocks are `hidden` validation twins, and the root does export the same types for four newer hooks, so this is an export gap for five hooks. The draft's line numbers ran one to four lines early; the imports sit at `:17`, `:21` and `:22–26` | `dist/index.d.ts` line 20; the mirror |
| F3 | Two blocks call `client.rpc` before `start()` | Kept. Both are `hidden` twins; the visible fragments rely on a `client` from context | `usage-and-billing.md:918–934`, `:1190–1200` |
| F4 | 50 `return null` statements contradict `Output \| void` | Kept, with the count confirmed as TypeScript-only. The pages' own hidden signature blocks declare `\| null \| undefined`, so the docs contradict the types explicitly | `pre-tool-use.md:17–21`; per-language count of the hook pages |
| F5 | Lines `:444`, `:460`, `:517` | The fields sit at `:445`, `:464–470` and `:525–527`. Still unverified at runtime | `post-tool-use.md` |
| F6 | Ten `model.*` events are untyped | Kept, with a scope note: seen with the BYOK Anthropic provider only | Example 01 |
| F8 | The model is offered `web_fetch` and `sql` among 19 built-ins | The examples asserted only `bash`, `view`, `create` and `edit`. A one-off probe confirmed the full list of 19, and showed that `BuiltInTools.Isolated` contains `task` | The probe, run through the harness runner: a default session's first model request, and `BuiltInTools.Isolated` printed |
| F9 | Neither page says tools must be passed again | Kept, reworded: the limitations table does mention lost "in-memory tool state", which concerns handler state; the resume-options table omits `tools` | `session-persistence.md:316–334`, `:825` |
| (new) F10 | | Hook examples match `shell`, `read_file` and other names absent from the runtime's tool list | The probe above; `grep` over the mirror |

F1 and F7 needed no change. The draft numbering is kept, so F10 follows F9.

## What we could not verify

Five areas stayed outside the offline harness:
- **Built-in tools.** The mock never calls `bash`, `edit`, `web_fetch` or the other host tools, so their behavior, the `shell` and `write` permission kinds, and F5's tool-result fields went untested.
- **GitHub authentication and hosted models.** Every run used BYOK. The login, token-priority and billing claims in `docs/auth/` were read, not run, and F6 may differ with GitHub-hosted models.
- **Server and cloud setups.** Blocks that need an external runtime server, cloud sessions, AHP hosts, managed settings or a CLI at a fixed path were skipped (Tier 2).
- **Later releases.** The S8a log records that F1–F3 were still present in 1.0.34 on 2026-11-18. I did not repeat that check.
- **Other languages.** The parity notes for Python, Go, .NET, Java and Rust come from their READMEs in the mirror; no non-TypeScript code was run.

## Verdict: trust the strict-marked examples, and set the permission handler yourself

The Copilot SDK behaves as its docs describe in 22 of the 23 behaviors we tested. Its sessions, custom tools, tool filters, hooks, streaming, MCP, resume and structured output all held against the real runtime. The blocks upstream marks `strict` have no API errors, and the type errors cluster in the hook pages: unexported types (F2), `null` returns (F4), nonexistent result fields (F5) and tool names the runtime doesn't use (F10). The one behavioral miss reverses a default: a session with no permission handler denies every tool call rather than leaving it pending (F1). Before you embed the SDK, give every session a permission handler and an `availableTools` list, use `mode: "empty"` on servers, pass an allowlisted `env` (F8), and pass `tools` again on resume (F9). Then rerun `pnpm run verify` at each upgrade, starting with F1 and F9.
