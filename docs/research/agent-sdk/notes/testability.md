# Testability: what makes an agent SDK testable offline and evaluable

Status: research note, 2026-11-18. Working material for the agent-SDK design; the main report supersedes it where they disagree.

**Thesis.** An agent SDK is testable offline when it owns a normalized model boundary and ships a test double for it. That double must replay scripted turns, answer from the request, record every request, fail loudly on a missing or extra call, stream realistically, and make ids and clocks injectable. Three of the four SDKs we verified ship such a double; the Claude Agent SDK ships none, so we had to mock it at the HTTP level. Our own four harnesses then needed the same extra pieces every time: a schema-driven responder, a host-tool deny list, an allowlisted environment and a network guard. Those pieces belong in our SDK's `testing` export and CI. Evals are a separate layer: real models, k trials, graders and sandboxes.

Versions as of November 2026: `@earendil-works/pi-ai` 1.5.2, `@openai/agents-core` 0.21.0, `ai` 7.0.162, `@anthropic-ai/claude-agent-sdk` 0.3.327 (`verify/*/package.json`; `docs/reference/claude-agent-sdk/fact-check.md:3`).

Path abbreviations used below:
- `PI` = `verify/pi/node_modules/@earendil-works/pi-ai/dist/providers/faux.{js,d.ts}`
- `OAI` = `verify/openai-agents-sdk/node_modules/@openai/agents-core/dist/testing/scriptedModel.{mjs,d.ts}`
- `AIT` = `verify/vercel-ai-sdk/node_modules/ai/dist/test/index.{js,d.ts}`
- `OAI-DOC` = `docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/testing.mdx`

## 1. The SDKs ship three different double designs, and all of them converge on "queue plus responder"

| | pi-ai `fauxProvider` | OpenAI `ScriptedModel` | AI SDK `MockLanguageModelV4` | Claude Agent SDK |
|---|---|---|---|---|
| Import | main entry (`pi-ai/dist/index.d.ts:21`) | `@openai/agents/testing` (`verify/openai-agents-sdk/node_modules/@openai/agents/package.json:19-22`) | `ai/test` (`verify/vercel-ai-sdk/node_modules/ai/package.json:38-42`) | none (`.agents/skills/claude-agent-sdk/SKILL.md:76`) |
| Fixed steps | `setResponses`/`appendResponses` (PI.d.ts:59-60) | constructor/`enqueue` (OAI.d.ts:110,120) | `doGenerate` value or array (AIT.d.ts:148-149) | — |
| Request-aware step | `FauxResponseFactory(context, options, state, model)` (PI.d.ts:36-37) | `modelResponder`, `modelStreamResponder` (OAI.d.ts:96,100) | `doGenerate`/`doStream` as a function (AIT.js:147,153) | HTTP mock only |
| Records requests | no; only `callCount`, deferred counts (PI.d.ts:31-35) | frozen snapshots, `calls`/`firstCall`/`lastCall` (OAI.mjs:111-123, 238-247) | raw `doGenerateCalls`/`doStreamCalls` (AIT.js:141-155) | our mock's JSONL log |
| Over-run | stream error "No more faux responses queued" (PI.js:365-370) | throws `UnexpectedModelCallError` (OAI.mjs:226-229) | array form returns `undefined` (AIT.js:148) | — |
| Under-run | `getPendingResponseCount()` (PI.js:472-474) | `assertComplete()` throws `UnconsumedModelStepsError` (OAI.mjs:134-138) | nothing | — |
| Error injection | `stopReason: "error"`, `errorMessage` (PI.d.ts:24-30) | `modelError(err, retryAdvice)` (OAI.d.ts:94) | throw from function | HTTP status |

**Design A, the scripted array.** One step per model call, consumed in order. It is the clearest regression test: OpenAI's docs call this "detect workflow drift". If code later adds an approval, the run stops early and teardown reports an unconsumed step; if orchestration adds a call, the model fails at that call (OAI-DOC:152-156; `docs/reference/openai-agents-sdk/source/examples/docs/testing/workflowDrift.ts:26-48`). The array is brittle by design: it encodes the expected path exactly.

**Design B, the request-aware responder.** A function that reads the request and decides the reply. It is the only way to run *unmodified* third-party code, whose tool names and schemas we can't know in advance. All four of our harnesses use it with the same three-rule policy (after a tool result, answer; else call one offered tool with schema-synthesised arguments; else answer): `verify/pi/scripts/faux-model.mjs:1-8,51-76`, `verify/openai-agents-sdk/scripts/scripted-model.mjs:1-9,46-59`, `verify/vercel-ai-sdk/scripts/mock-model.mjs:1-8,48-69`, `verify/claude-agent-sdk/scripts/mock-anthropic.mjs:5-12,54-88`. OpenAI's guide warns to "prefer fixed response steps; use responders only for request-dependent behavior" (OAI-DOC:377). Pydantic AI ships the same idea twice: `TestModel` calls every tool with JSON-schema-generated arguments, and `FunctionModel` takes a user function over the message history ([pydantic-ai docs/testing.md](https://github.com/pydantic/pydantic-ai/blob/main/docs/testing.md)).

**Design C, the HTTP-level mock.** It's a fake provider API behind the SDK's base-URL setting. It is the only option when the SDK is a binary: the Claude SDK spawns the Claude Code CLI, which honours `ANTHROPIC_BASE_URL` (`mock-anthropic.mjs:1-3`; `verify/claude-agent-sdk/scripts/run-examples.mjs:73-86`). It exercises the real wire path, including SSE framing (`mock-anthropic.mjs:90-131`), `count_tokens` and `/v1/models` (`:149-158`). It also forces the mock to reimplement provider behaviour the SDK layers on top. The CLI defers MCP tools behind `ToolSearch`, so the mock must call `ToolSearch("select:<name>")` first, "as a real model would" (`mock-anthropic.mjs:79-86`; `docs/reference/claude-agent-sdk/fact-check.md:81`). OpenAI's guide draws the same boundary from the other side. Normalized doubles must not test "provider request conversion, HTTP or WebSocket payloads, authentication headers, provider-specific streaming chunks"; those need "the real model adapter with a mocked network transport" (OAI-DOC:371, 399-400).

**Conclusion.** Ship designs A and B as one class at the normalized boundary, as OpenAI does (a step is either a fixed response or a responder, OAI.d.ts:25-48). Ship a mock transport for each provider adapter (design C) as a separate, smaller tool for wire tests.

## 2. A double is only as good as what it lets you assert

The behavioral examples assert on four things.
- **Call counts.** Pi examples assert `faux.state.callCount` (`verify/pi/examples/01-hello-session.ts:11`, `02-custom-tool.ts:41`, `08-triage-agent.ts:99`). OpenAI examples assert `model.calls.length` (`verify/openai-agents-sdk/examples/08-max-turns.ts:27`, `09-triage-agent.ts:87`).
- **Recorded request contents.** The Vercel examples assert the system text, the offered tools, `toolChoice` and the tool message sent back (`verify/vercel-ai-sdk/examples/01-generate-text.ts:14`, `02-tool-loop.ts:43`, `04-prepare-step.ts:28-29`). The Claude example reads the HTTP log to check that a resumed session carried earlier context (`verify/claude-agent-sdk/examples/06-resume-session.ts:15-17`).
- **Completeness.** `model.assertComplete()` (`verify/openai-agents-sdk/examples/01-hello-agent.ts:18`, `02-function-tool.ts:36`, `09-triage-agent.ts:77`). OpenAI recommends calling it in teardown "so an early workflow exit is reported even when another assertion fails first" (`workflowDrift.ts:37-39`).
- **Over-run as failure.** Only OpenAI throws on an extra call. For the AI SDK we wrapped `MockLanguageModelV4` in `scripted()`, which records requests and throws `no turn N` because the raw array form silently returns `undefined` (`verify/vercel-ai-sdk/examples/lib/check.ts:30-42`; AIT.js:148). `mockValues` is worse for loops: it "Returns the last value when the array is exhausted" (`docs/reference/vercel-ai-sdk/source/content/docs/03-ai-sdk-core/55-testing.mdx:17`; AIT.js:370-373). A tool-call reply repeated forever lets an agent loop run until its step cap.

Recording needs care. OpenAI stores "a frozen request snapshot with detached mutable input collections" (OAI.d.ts:17-22). Without that, a recorded array aliases the runner's live history, which keeps mutating after the call. The AI SDK pushes the raw options object (AIT.js:146). Pi records nothing, so request assertions in Pi need a factory that captures `context` itself (PI.d.ts:36). The OpenAI guide adds "assert important request fields instead of private runner state" and "assert structured error fields instead of parsing error messages" (OAI-DOC:376, 382); its errors carry `callIndex`, `remainingSteps` and a `reason` enum (OAI.d.ts:60-90).

Scripted doubles beyond the model pay off. OpenAI also ships `scriptedSandboxSession()` with per-method steps, optional argument matchers, recorded calls and `assertComplete()` (`agents-core/dist/testing/scriptedSandboxSession.d.ts:10-55`), plus a scripted Realtime transport (OAI-DOC:351-357). That pair lets one test cover "tool argument validation, capability routing, sandbox session invocation, tool-result delivery" without a sandbox provider (OAI-DOC:187-189).

## 3. Streaming support must emit realistic deltas and honour abort

- **pi-ai** derives streams from the scripted message. It splits text, thinking and tool-call JSON into token-sized chunks and feeds tool arguments through "the same parser real providers use, so consumers see them grow" (PI.js:233-306, 291-302). It paces chunks by `tokensPerSecond` (PI.js:226-232), checks `signal.aborted` between chunks (PI.js:243-258) and simulates deferred and polled responses (PI.d.ts:42-46; PI.js:404-449). It even estimates prompt-cache reads and writes per `sessionId` (PI.js:134-169), so cost-accounting code can be tested offline.
- **OpenAI** offers automatic streaming from a normalized response, or exact event streams via `modelStream` (OAI.d.ts:97-100). The automatic path emits each output text part as one `output_text_delta` (OAI.mjs:445-466), so chunk-boundary bugs need an explicit stream. Abort is checked at each yield (OAI.mjs:163-191, 500-505).
- **AI SDK** leaves streams to the test: `simulateReadableStream({ chunks, initialDelayInMs, chunkDelayInMs })` with an injectable `_internal.delay` (AIT.d.ts:24-40). Our helper splits text at spaces to produce several deltas (`verify/vercel-ai-sdk/examples/lib/check.ts:51-63`), and the harness mock sends a single delta (`mock-model.mjs:91-105`).
- **HTTP mock** emits real SSE events, but one delta per block (`mock-anthropic.mjs:115-130`).

The takeaway is that the double should chunk by default. Single-delta streams hide accumulator and partial-JSON bugs. Chunking must also be seedable, which leads to the next section.

## 4. Determinism needs injected ids, clocks and randomness, and the SDKs only half provide it

- pi-ai's faux uses `Date.now()` and `Math.random()` for tool-call ids, the API id, timestamps and chunk sizes (PI.js:26-33, 52, 58-60, 174, 319). Two runs of the same script therefore differ unless the test passes `id`, `timestamp` and `tokenSize: {min, max}` equal.
- OpenAI assigns deterministic `scripted-response-N` ids when a script omits one (OAI.d.ts:3-10; OAI.mjs:408, 421-423), but `functionCall` makes `callId` mandatory (OAI.d.ts:54-59), and our skill records that requirement (`.agents/skills/openai-agents-sdk/SKILL.md:77`).
- The AI SDK exposes `_internal: { generateId, generateCallId, now }` on `generateText`/`streamText`, documented as "Internal. For test use only. May change without notice" (`verify/vercel-ai-sdk/node_modules/ai/dist/index.d.ts:5814-5820, 4222-4229`). It also ships `mockId()`, a counter (`verify/vercel-ai-sdk/node_modules/@ai-sdk/provider-utils/dist/test/index.js:59-62`). The capability exists, but it is unstable API.
- Our HTTP mock uses a module-level counter for message and tool-use ids (`mock-anthropic.mjs:19, 95-98`). That is deterministic per process, but the counter is shared by every server in the runner (`run-examples.mjs:71`, `CONCURRENCY` at `:17`).
- Pydantic AI asserts on timestamps and ids with `IsNow`/`IsStr` matchers instead of injecting them ([pydantic-ai docs/testing.md](https://github.com/pydantic/pydantic-ai/blob/main/docs/testing.md)). This works, but it weakens snapshot tests.

Our SDK should make `clock`, `idGenerator` and `random` public, stable run options. Our session log will be append-only and tree-shaped (`AGENTS.md`, planned architecture item 3), and replaying or diffing it requires stable ids.

## 5. Running third-party or doc code safely took five rules, each learned from a failure

1. **Allowlisted environment, never `...process.env`.** Inheriting the env leaked the host's deferred tools and proxy calls into the Claude CLI (`docs/reference/claude-agent-sdk/fact-check.md:94`, F5). The fix appears in all four runners: `verify/claude-agent-sdk/scripts/run-examples.mjs:72-86`, `verify/openai-agents-sdk/scripts/run-examples.mjs:71-80`, `verify/pi/scripts/run-examples.mjs:68-75`, `verify/vercel-ai-sdk/scripts/run-examples.mjs:75-81`. A side effect is that tests must hard-code secrets the SDK reads from the env, such as the AI SDK's approval secret (`.agents/skills/vercel-ai-sdk/SKILL.md:79`).
2. **Never fall through to an ambient real provider.** Pi's default "first available" model plus ambient cloud credentials sent a doc example to Amazon Bedrock (`docs/reference/pi/fact-check.md:85`, F4). The preloads now substitute the faux model for every lookup and set `allowModelNetwork: false` (`verify/pi/scripts/faux-preload.mjs:17-30`). They also replace the OpenAI default provider (`verify/openai-agents-sdk/scripts/scripted-preload.mjs:19-20`) and the AI SDK's default provider and provider imports (`verify/vercel-ai-sdk/scripts/mock-preload.mjs:10-21`; `hooks.mjs:3-10`). Pydantic AI's global `ALLOW_MODEL_REQUESTS = False` is the SDK-level form of this rule ([pydantic-ai docs/testing.md](https://github.com/pydantic/pydantic-ai/blob/main/docs/testing.md)).
3. **Network guard.** Each in-process preload rejects any non-localhost `fetch` (`faux-preload.mjs:7-15`; `scripted-preload.mjs:10-17`; `mock-preload.mjs:23-30`). OpenAI's double replaces model I/O only, and tracing must be disabled separately "so this test makes no network requests" (`workflowDrift.ts:42-44`; `OPENAI_AGENTS_DISABLE_TRACING` at `verify/openai-agents-sdk/scripts/run-examples.mjs:78`). The Claude CLI is a separate binary, so its runner can only steer it through env (`NO_PROXY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `verify/claude-agent-sdk/scripts/run-examples.mjs:80-83`). An in-process guard can't reach it.
4. **Deny host tools by name as well as by type.** OpenAI sandbox agents expose `exec_command`, `write_stdin` and `view_image` as ordinary function tools, and the first type filter let them through (`docs/reference/openai-agents-sdk/fact-check.md:36`). The fix is a name deny list (`scripted-model.mjs:37-38, 50`). Pi denies `bash`/`edit`/`write` (`faux-model.mjs:12-13, 63`), and the AI SDK mock denies a regex of host-sounding names (`mock-model.mjs:12, 57`). Read-only tools run only inside a temp dir (`faux-model.mjs:70-74`).
5. **Finite scripts, timeouts and isolation.** `ScriptedModel` copies its input with `Array.from(inputs, …)` (OAI.mjs:107-109), so an infinite generator of responder steps never returns and exhausts memory. Our harness therefore pre-builds 500 steps (`scripted-model.mjs:62-66`) and Pi's refills 200 (`faux-model.mjs:79-84`). Every run also gets a SIGKILL timeout, a fresh temp cwd and copied fixtures (`verify/claude-agent-sdk/scripts/run-examples.mjs:16, 58-71, 93-96`). Blocks that need external processes, remote endpoints or third-party keys are skipped by pattern, not attempted (`:22-32`).

Each of these rules limits what a pass proves. Because doubles never call host tools, a pass shows "that a configuration loads and the loop completes", not that built-in tools work (`docs/reference/claude-agent-sdk/fact-check.md:38`; `pi/fact-check.md:36`; `openai-agents-sdk/fact-check.md:38`; `vercel-ai-sdk/fact-check.md:39`).

## 6. Recorded fixtures give wire fidelity, but they go stale and can leak secrets

None of the four TypeScript SDKs ships record/replay (no record API in PI.d.ts, OAI.d.ts or AIT.d.ts). VCR-style tools fill the gap at the HTTP layer:
- pytest-recording defaults to VCR's `none` mode "to prevent unintentional network requests". You record with `--record-mode=once` or `rewrite`, block the network globally with `--block-network`, and strip credentials with `filter_headers: ["authorization"]` ([kiwicom/pytest-recording](https://github.com/kiwicom/pytest-recording)). vcrpy's `filter_headers` also accepts a list of (key, value) tuples, where the value is a replacement, `None` to remove the header, or a callable that returns the new value ([vcrpy advanced docs](https://vcrpy.readthedocs.io/en/latest/advanced.html), "Advanced use of filter_headers, filter_query_parameters and filter_post_data_parameters"). LLM headers worth filtering include `x-api-key` (Anthropic, [API overview](https://platform.claude.com/docs/en/api/overview)), `api-key` (Azure OpenAI, [REST reference](https://learn.microsoft.com/en-us/azure/foundry/openai/reference), Authentication) and `x-goog-api-key` (Gemini, [API keys](https://ai.google.dev/gemini-api/docs/api-key)).
- Our Claude mock already records half of a cassette. It appends every request body and offered tool names to `$MOCK_LOG` as JSONL (`mock-anthropic.mjs:12, 143-147`), and the runner derives request and tool-result counts from it (`run-examples.mjs:103-111`).

Recordings carry two risks. The first is staleness. A cassette freezes one model's behaviour and one wire format. Our verification found APIs moving under docs within a release cycle: AI SDK 7.0 renamed `textDelta` (`docs/reference/vercel-ai-sdk/fact-check.md:81`), and Pi's docs site runs ahead of the npm release (`docs/reference/pi/fact-check.md:74`). Cassettes need a provider/model/SDK-version stamp and an expiry. I could not read Polly.js's `expiresIn`/`expiryStrategy` docs (netflix.github.io is outside this session's network allowlist), so that design is unverified here. The second risk is false confidence. Replay tests the client against yesterday's server; it says nothing about today's model choices. That job belongs to evals.

Replay works better at the normalized boundary than at HTTP. A session event log of normalized model responses can be fed back into a scripted model. It survives wire-format changes, and it is the natural shape for our append-only log.

## 7. Unit tests and evals answer different questions and need different machinery

OpenAI's guide draws the boundary explicitly: "model quality, instruction following, and tool-selection quality belong in evaluations or tests that use a real model" (OAI-DOC:399). A scripted `function_call` "does not prove that a real model will follow the agent's instructions or choose the tool" (OAI-DOC:225).

Anthropic's "Demystifying evals for AI agents" supplies the eval vocabulary ([anthropic.com/engineering](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)):
- A task "is a single test with defined inputs and success criteria", and each attempt is a trial.
- A grader is "logic that scores some aspect of the agent's performance". A transcript is "the complete record of a trial". The outcome is "the final state in the environment".
- pass@k is "the likelihood that an agent gets at least one correct solution in k attempts". pass^k is "the probability that all k trials succeed", so 75% per trial gives (0.75)³ ≈ 42% pass^3.
- Each trial should start "from a clean environment", because shared state causes correlated failures and "can also artificially inflate performance".
- It is "often better to grade what the agent produced, not the path it took". Capability evals ("What can this agent do well?") are distinct from regression evals ("Does the agent still handle all the tasks it used to?"). And "You won't know if your graders are working well unless you read the transcripts".

pass^k comes from τ-bench (Yao et al., [arXiv 2406.12045](https://arxiv.org/abs/2406.12045), ICLR 2025). With function calling, GPT-4o scored 61.2% pass^1 on τ-retail (Table 2), and its pass^8 on τ-retail fell below 25% (abstract; §1 says "as low as 25%") ([arXiv 2406.12045 html](https://arxiv.org/html/2406.12045), §1 and §5.1).

Inspect AI's `sandbox_agent_bridge()` evaluates an unmodified harness. A proxy inside the sandbox on localhost port 13131 relays model calls to the eval model and records them. Tools the agent runs itself appear only through its model calls. The in-process `agent_bridge()` has "access to the host's network and files" and should not be used "with an adversarial model" ([inspect_ai docs/agent-bridge.qmd](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/docs/agent-bridge.qmd)). This is design C again, pointed at a real model. A base-URL-overridable gateway therefore serves both our offline mock and Inspect's bridge.

The resulting layering:
- **Unit tests** (every commit): scripted doubles, exact paths, `assertComplete`, offline.
- **Wire tests**: the real adapter plus a mock transport or cassette.
- **Regression evals**: real model, k trials, outcome graders, clean sandbox per trial, target near 100%.
- **Capability evals**: same machinery, low starting pass rate, compared against a mini-swe-agent baseline (`AGENTS.md`, planned architecture item 8).

## Design implications for our SDK

Ship in `@buildanagent/sdk/testing`:
1. **`ScriptedModel`** with fixed steps, `responder`, `stream`, `streamResponder` and `error(err, retryAdvice)` steps. It gets `calls`/`firstCall`/`lastCall` as frozen, detached snapshots, `remainingSteps` and `assertComplete()`, and it throws a typed `UnexpectedModelCallError` on over-run. Evidence: OpenAI's complete design (OAI.d.ts:12-126), the AI SDK's silent `undefined` and `mockValues` repeat (AIT.js:148, 370-373), and our `scripted()` wrapper that had to add a throw (`check.ts:30-42`).
2. **Finite-by-construction scripts.** Accept a `responder` with `maxCalls` instead of requiring N copies, and reject infinite iterables. Evidence: `Array.from` at OAI.mjs:108 and our 500/200-step workarounds (`scripted-model.mjs:62-66`; `faux-model.mjs:79-84`).
3. **Built-in responders**: `autoResponder({ denyTools, preferNamed, outputSchema })`, with schema-synthesised arguments, a host-tool deny list matched by name and capability, and structured-output answers. Evidence: `synth()` and the three-rule policy copied four times (§1), plus the `exec_command` near-miss (`docs/reference/openai-agents-sdk/fact-check.md:36`). Prior art is Pydantic AI's `TestModel`.
4. **Realistic streaming by default.** Chunk text, thinking and tool-call JSON through the production partial-JSON parser, honour `AbortSignal` between chunks, and offer seeded chunk sizes and a `tokensPerSecond` option. Evidence: pi-ai (PI.js:233-306), and single-delta streams in three harnesses (§3).
5. **Public, stable determinism hooks.** Every run takes `clock`, `idGenerator` and `random`, and the doubles default to counters. Evidence: pi-ai's `Date.now`/`Math.random` (PI.js:52, 58-60, 174), and the AI SDK's `_internal` marked unstable (`ai/dist/index.d.ts:5814-5820`).
6. **Scripted doubles for every other boundary we own**: sandbox, approval/permission prompter, MCP client and clock. Each records calls and has `assertComplete()`. Evidence: `scriptedSandboxSession.d.ts:10-55`, and OAI-DOC:187-189 on the coverage it buys.
7. **A simulated usage and cache model** in the double, so the gateway's cost accounting and cache-hit logic are testable offline. Evidence: PI.js:134-169.
8. **A mock transport per provider adapter**, plus a `startMockServer()` for out-of-process harnesses and Inspect-style bridges. It records JSONL and implements provider quirks such as tool-search deferral. Evidence: `mock-anthropic.mjs`, Claude fact-check line 81 and OAI-DOC:371.
9. **Normalized-boundary record/replay.** Record `{request, response}` pairs from real runs into the session log with an SDK, provider and model stamp. Replay them through `ScriptedModel`, fail on request drift, and expire them by age or version. Evidence: §6 staleness; [pytest-recording](https://github.com/kiwicom/pytest-recording) defaults to replay-only.
10. **An `allowModelRequests(false)` global** that makes any non-test model or provider construction throw. Evidence: Pi's ambient-Bedrock leak (`docs/reference/pi/fact-check.md:85`); prior art in Pydantic AI's `ALLOW_MODEL_REQUESTS`.

Rules our CI should enforce:
- Spawned test processes get an allowlisted env (`PATH`, temp `HOME`, `TMPDIR`, `LANG` and explicit test vars). A lint rejects `...process.env` in spawn calls. Evidence: Claude F5.
- A network guard rejects non-localhost egress in unit tests, and telemetry exporters are off by default under test. Evidence: the preload guards; OpenAI tracing (`workflowDrift.ts:42-44`).
- Every test that creates a scripted double calls `assertComplete()` in teardown. A test helper can register this automatically. Evidence: `workflowDrift.ts:37-39`.
- Doubles never execute host-mutating tools. Read-only tools run in a temp cwd only. Evidence: §5 rule 4.
- Every spawned example gets a per-test timeout with SIGKILL and a step cap. Evidence: `run-examples.mjs:93-96`.
- Snapshot tests run with injected clock and ids. A second run must produce byte-identical session logs.
- Cassettes and recorded fixtures are scanned for secrets and auth headers, and are failed when older than their expiry or stamped with a different SDK version.
- Evals run separately from `pnpm test`, against real models in a clean sandbox per trial. They report pass@k and pass^k with transcripts kept. Evidence: Anthropic's post; τ-bench.

## Unresolved gaps

- I could not read Polly.js expiry docs (netflix.github.io) or pydantic.dev, which are outside the network allowlist; the Pydantic claims come from the GitHub copy of its docs.
- No TypeScript LLM-specific cassette library was evaluated, and LangChain's VCR usage was not found.
- I did not check whether pi-ai exposes a seed for faux chunking beyond `tokenSize` min = max.
- The OOM from an infinite step iterable is inferred from `Array.from` (OAI.mjs:108) and our harness comment, not reproduced.
- The τ-bench numbers were re-checked against the paper on 2026-11-18 ([fact-check](../fact-check.md), R1).
