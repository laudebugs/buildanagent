# The OpenAI Agents SDK docs match 0.21.0, apart from two small errors

A developer who copies an example from the OpenAI Agents SDK docs needs it to compile and run against the release npm installed. To test that promise, I checked the docs at git tag `v0.21.0` against `@openai/agents@0.21.0`, the newest release at least two weeks old. The docs are 32 English pages, plus the 178 example files they embed through `?raw` imports. Four automated tiers did the checking: type-checks, offline runs, an API-surface diff and behavioral tests. All of them live in [`verify/openai-agents-sdk/`](../../../verify/openai-agents-sdk/), with raw output in `verify/openai-agents-sdk/results/`. The docs passed: no source has an API error, all 16 agent options and the `maxTurns` default match the package, and every behavior we tested works as written except one: the handoff tool's name. That naming error and one wrong "required" mark are the only inaccuracies I found; the rest are omissions.

## Reproduce the checks in three commands

```bash
pnpm install              # at the repo root: installs every harness
cd verify/openai-agents-sdk
pnpm run fetch-docs       # mirror the docs from tag v0.21.0 (committed; MIT)
pnpm run verify           # extract -> type-check -> run docs examples -> API diff -> our tests
```

## Tier 1: 178 of 182 sources compile, and none has an API error

I compiled 182 TypeScript sources against the pinned packages with `tsc` 7 in strict mode (`scripts/typecheck-examples.mjs`). They were the 178 example files, 164 of which the pages show, and the 4 inline code blocks. To make every embedded file checkable, the harness also installs the optional packages the docs tell readers to add: `ai` and `@ai-sdk/openai` for the AI SDK extension, and `valibot` for the schema guide.

| Source | pass | fragment | api-mismatch |
|---|---|---|---|
| Example files (178) | 177 | 1 | 0 |
| Inline code blocks (4) | 1 | 3 | 0 |

The fragments depend on context outside them. Three inline blocks use a `session` or `agent` defined elsewhere on the page, and `voice-agents/serverAgent.ts` imports the `server-only` marker package. The clean result fits how the docs are maintained: the `examples/docs` package has a `build-check` script that runs `tsc --noEmit` over these files.

## Tier 2: 50 of 66 complete examples ran offline

I ran every example that imports the SDK, runs an agent, and passed Tier 1, 66 in all (`scripts/run-examples.mjs`). Each ran unmodified under a preload (`scripts/scripted-preload.mjs`) that replaces the default model provider with the SDK's own `ScriptedModel`, driven by a request-aware `modelResponder()`. Each run also got a temp working directory, an allowlisted environment with tracing disabled, and a network guard that rejects any non-local `fetch`:

| Outcome | Count | Notes |
|---|---|---|
| ran, model answered | 41 | Includes tool calls, handoffs, approvals and seven sandbox-agent examples |
| ran, no model call | 9 | Five `testing/` examples drive their own `ScriptedModel`; four set up AI SDK UI streams or a server without running |
| skipped | 14 | Server-side sessions on the Conversations API (4), an explicit OpenAI client or model (3), external MCP servers (3), Docker or Codex (2), a real AI SDK model (1), a tracing API key (1) |
| error | 2 | `guardrails/guardrails-input.ts` and `-output.ts` assert that the guardrail trips; the scripted guardrail model answers `false`, so neither trips. Example 04 proves both tripwires with scripted input instead |

Two harness faults surfaced on the way, and both are fixed. First, `examples/docs/package.json` lacks `"type": "module"`, so the copied files compiled as CommonJS and top-level `await` failed. Upstream only type-checks these files, and a reader's project would be ESM, so the harness marks the copies as ESM. Second, sandbox agents expose `exec_command`, `write_stdin` and `view_image` as ordinary *function* tools, which my type filter allowed. A replay shows the earlier runs only ever called `view_image`, with a placeholder path, and never `exec_command`. The scripted model now denies those tools by name.

This tier has one deliberate limit. The scripted model calls only function tools you define, never hosted, computer, shell, apply-patch or sandbox tools. A pass therefore shows that a configuration loads and the loop completes, not that those tools behave as described.

## Tier 3: every documented option exists, and a few package items are missing from the tables

A script compares the guides' option tables, event list and error list with the package's declarations (`scripts/factcheck-api.mjs`). The guides describe nothing that's absent from the package:

| Surface | Docs | Package | Differences |
|---|---|---|---|
| `Agent` options (`agents.mdx`) | 16 | 16 | None, but see F2 |
| `maxTurns` default (`running-agents.mdx`) | 10 | 10 | None |
| `run()` arguments (`running-agents.mdx`) | 17 | 18 | `outputGuardrailBlockedMessage` is missing from the table; `guardrails.mdx` covers it |
| `RunConfig` fields (`running-agents.mdx`) | 21 | 22 | `outputGuardrailBlockedMessage` again |
| Run-item stream events (`streaming.mdx`) | 9 | 10 | `compaction_item_created` appears on no page |
| Error classes (`running-agents.mdx` "Exceptions") | 8 | 11 | `InvalidToolOutputError` is documented in `tools.mdx`; `InvalidToolInputError` and `SystemError` appear on no page |

## Tier 4: ten of eleven documented claims held, and handoff naming differs

Nine programs in `verify/openai-agents-sdk/examples/` assert documented behavior on `ScriptedModel`, and all nine pass. Example 03 asserts the package's actual behavior, which differs from the docs:

| Claim (doc page) | Test | Result |
|---|---|---|
| A run returns `finalOutput` and `lastAgent`, and `instructions` become the system instructions (agents, running-agents) | 01 | ✅ |
| A function tool's `execute()` gets Zod-parsed arguments, and its result reaches the next request (tools, testing) | 02 | ✅ |
| A handoff is a tool; the specialist answers and becomes `lastAgent` (handoffs) | 03 | ✅ |
| "Refund Agent" gets the handoff tool `transfer_to_refund_agent` (handoffs) | 03 | ❌ The package produces `transfer_to_Refund_Agent` (F1) |
| Input and output guardrails throw their tripwire errors (guardrails) | 04 | ✅ |
| With `runInParallel: false`, a tripped input guardrail stops the run before the model is called (guardrails) | 04 | ✅ |
| `needsApproval` pauses the run; `RunState` serialises; `approve()` runs the tool once, `reject()` never (human-in-the-loop) | 05 | ✅ |
| A session carries history into the next run (sessions) | 06 | ✅ |
| A Zod `outputType` yields a typed `finalOutput`, and bad output throws `ModelBehaviorError` (agents, results) | 07 | ✅ |
| Exceeding `maxTurns` throws `MaxTurnsExceededError` with the run state (running-agents) | 08 | ✅ |
| `ScriptedModel`, `assertComplete()` and `tracingDisabled` keep tests offline (testing) | 01–09 | ✅ |

## Five findings: two doc errors, three gaps

**F1. Handoff tool names keep the agent name's case.** `handoffs.mdx:15` gives an example. "If you hand off to an agent called `Refund Agent`," it says, "the tool name would be `transfer_to_refund_agent`." In 0.21.0, `handoff(new Agent({ name: "Refund Agent" })).toolName` is `transfer_to_Refund_Agent`: the SDK replaces spaces but keeps the capitals. Code or guardrails that match on the documented name will miss. Set `toolNameOverride` when the name matters.

**F2. `instructions` is optional, though the docs mark it required.** The table in `agents.mdx` marks both `name` and `instructions` as required. `AgentOptions` requires only `name`, examples 02, 03 and 06 construct agents without `instructions`, and the SDK's JSDoc says only that it "strongly recommends" them.

**F3. The quickstart presents tracing as a feature but never says how to turn it off.** `tracing.mdx` documents the default. Tracing is on in Node.js, Deno and Bun, and each run's model calls, tool calls, handoffs and guardrails go to OpenAI's Traces dashboard. The quickstart's "View your traces" section says only that the SDK "automatically generates traces" and links the dashboard. The section omits that the data leaves your process and how to disable it. Teams that handle sensitive input should decide on tracing before their first run.

**F4. Three package items appear on no page.** The `compaction_item_created` stream event and the `InvalidToolInputError` and `SystemError` classes exist in the package but in none of the 32 pages. `outputGuardrailBlockedMessage` and `InvalidToolOutputError` are covered on other pages but missing from the option and error lists.

**F5. One embed lives outside `examples/docs`.** `models.mdx` embeds `examples/basic/prompt-id.ts`. That's harmless for readers, but a mirror or checker that assumes every embed sits in `examples/docs` misses it, as my first extractor did.

## TypeScript parity

Python `openai-agents` is the SDK's primary implementation, so the [TypeScript gap report](../../comparison/typescript-gaps.md#openai-agents-sdk-typescript-lacks-storage-backends-the-voice-pipeline-and-developer-utilities) compares 0.21.0 with Python 0.24.0 at tag `v0.24.0`. The core loop is at parity: tools, guardrails, handoffs, approvals, MCP, tracing, realtime and sandbox agents all exist in both. The JavaScript package lacks nine Python features, among them the SQLite, Redis, SQLAlchemy and other database sessions, `EncryptedSession`, nested handoff history, the `VoicePipeline`, `run_demo_loop` and `draw_graph`. Two more are weaker: no run-level history limit, and five listed tracing integrations against Python's 31. In the other direction, only JavaScript has the browser WebRTC transport, the Twilio and Cloudflare realtime transports and the `aisdk()` bridge. Plan to write your own durable `Session`, because only memory and OpenAI-hosted sessions ship.

## Verdict: build from the examples, and check names before you match on them

The OpenAI Agents SDK docs are the most accurate of the three references so far. Every one of their 182 sources compiles against 0.21.0 without an API error, every documented option exists, and the loop, guardrails, approvals, sessions and structured output behave as written. Two small errors remain: handoff tool names keep their case (F1), and `instructions` is optional (F2). A team can build from the docs' examples as written, provided it treats tracing as an explicit decision (F3) and reruns `pnpm run verify` at each upgrade.
