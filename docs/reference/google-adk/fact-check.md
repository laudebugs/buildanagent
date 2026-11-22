# Google ADK TypeScript docs: the code runs, but the TypeScript prose lags the 2.5.0 package

A developer who copies a TypeScript example from the ADK docs needs it to compile and run against the release npm installed. They also need the prose around it to say what the TypeScript package does, on a site written mostly for Python. To test both, I checked `google/adk-docs` at commit `ff7a5f56` (2026-11-17) and the `google/adk-js` samples at tag `main-v2.5.0` against `@google/adk@2.5.0` with `@google/genai@2.32.0` and `zod@4.6.7`. The owner chose the 2.5.0 pin on 2026-11-18, six days after its release. Together they hold 304 TypeScript sources: 179 blocks from 88 pages, 63 snippet files and 62 samples. ADK ships no test model, so every run used a scripted `BaseLlm` subclass, offline. Four automated tiers did the checking: type-checks, offline runs, an API-surface diff and behavioral tests. All of them live in [`verify/google-adk/`](../../../verify/google-adk/), with raw output in `verify/google-adk/results/`. The code held up well. No runnable doc source failed, every documented option exists, and 19 of 22 documented behaviors held. The failures sit in the TypeScript-specific prose. The docs deny TypeScript a confirmation option it has, show a plugin hook with the wrong signature, and promise an `outputSchema` guarantee that only Python keeps.

## Reproduce the checks in three commands

```bash
pnpm install              # at the repo root: installs every harness
cd verify/google-adk
pnpm run fetch-docs       # mirror adk-docs at ff7a5f56 and adk-js at main-v2.5.0 (committed; both Apache-2.0)
pnpm run verify           # extract -> type-check -> triage -> run docs examples -> API diff -> our tests
```

The triage step needs network, to compare the names a block misses with adk-js main. The docs repo has no release tags, and the site renders its main branch, so the mirror pins a commit ([harness README](../../../verify/google-adk/README.md#why-the-docs-mirror-is-from-main)).

## Tier 1: 221 of 304 sources compile as written, and 9 disagree with the package

I compiled every TypeScript source against the pinned packages in strict mode (`scripts/typecheck-examples.mjs`, `results/typecheck-docs.json`). A source that fails only because a name is defined elsewhere on its page, or because it imports a package outside the pinned set, counts as a fragment. The 7 sources that import `@google/adk-integrations` count as fragments, because the pin decision covered `@google/adk` only.

| Source | Count | pass | fragment | syntax | api-mismatch | ahead of release |
|---|---|---|---|---|---|---|
| Page blocks (69 of the 88 pages; the rest only include snippets) | 179 | 104 | 54 | 12 | 9 | 0 |
| Snippet files (`examples/typescript/snippets/`) | 63 | 61 | 2 | 0 | 0 | 0 |
| adk-js samples (`samples/`, `dev/samples/`) | 62 | 56 | 6 | 0 | 0 | 0 |
| **Total** | **304** | **221** | **62** | **12** | **9** | **0** |

The 12 syntax blocks are method bodies and pseudocode. No source runs ahead of the release: no mismatch uses a name that only adk-js main exports, although main exports 46 names that 2.5.0 lacks (`results/latest-releases.json`). `scripts/mismatch-causes.mjs` groups the 9 api-mismatch sources by cause (`results/mismatch-causes.json`):

| Cause | Errors | Sources | Finding |
|---|---|---|---|
| An SDK value imported with `import type` (TS1361) | 6 | 4 | F3 |
| Event helpers imported from `@google/genai` (TS2305) | 5 | 2 | F4 |
| A `BaseAgent` subclass without `runLiveImpl` (TS2515) | 2 | 2 | F5 |
| A plugin hook with positional parameters (TS2416) | 2 | 1 | F1 |
| `state.get` with a default that narrows to a literal (TS2367) | 1 | 1 | F7 |
| A plain function passed as a tool (TS2322) | 1 | 1 | F6 |

Every mismatch is a doc error, and the snippet files and samples have none.

## Tier 2: 109 of 163 runnable sources ran, and none failed

I ran every complete, type-clean source, 163 in all (`scripts/run-examples.mjs`, `results/run-docs.json`). Doc sources ran unmodified under a preload that registers the scripted model with `LLMRegistry` under Gemini's patterns, and that refuses every non-local request. Most snippets and every sample export a `rootAgent` for `npx adk run` and never run it themselves. For those 125 sources, the runner wrote a probe that sends one user message through an `InMemoryRunner` and fails on an error event or an empty run.

| Outcome | Page blocks | Snippets | Samples | Total |
|---|---|---|---|---|
| ran, model called | 7 | 37 | 20 | 64 |
| ran, no model call | 0 | 19 | 26 | 45 |
| skipped | 43 | 1 | 10 | 54 |
| error or timeout | 0 | 0 | 0 | 0 |

The no-model runs are function-only graphs and samples that bring their own deterministic model. The 54 skipped sources need an external MCP server (42), host code execution (3), Google API OAuth (2), a Google Cloud service or external database (2), a package outside the pinned set (2), the live API (1), computer use (1) or a third-party credential (1). The probe is shallow: a run that passes shows that the agent starts, offers its tools and answers, not that every branch works. The scripted model never calls a tool whose name suggests host access, such as `shell`, `exec`, `write` or `delete`.

## Tier 3: every documented option exists, and many declared options go undocumented

`scripts/factcheck-api.mjs` compares the names the TypeScript sources use with the `.d.ts` files (`results/factcheck-api.json`). Nothing the docs use is missing from the package:

| Surface | Docs use | Package declares | Not in package | Undocumented examples |
|---|---|---|---|---|
| `LlmAgent` options | 23 | 33 | 0 | `globalInstruction`, `retryConfig`, `timeout`, `stateSchema` |
| Agent callbacks | 6 | 6 | 0 | |
| Plugin hooks | 3 | 16 | 0 | `onToolErrorCallback`, `onModelErrorCallback`, `beforeRunCallback` |
| `SequentialAgent`, `ParallelAgent`, `LoopAgent` options | 3, 3, 4 | 14, 14, 15 | 0 | All three are `@deprecated` (F13) |
| Graph runtime | 9 names, 2 `Workflow` options | 69 exports, 13 options | 0 | `maxConcurrency`, `retryConfig`, `timeout` |
| `Runner` members and config keys | 7 and 7 | 14 and 10 | 0 | `runLive`, `resumabilityConfig`, `autoCreateSession` |
| Session service members | 3 | 6 | 0 | `listSessions`, `deleteSession`, `getOrCreateSession` |

The same script reads every "Supported in ADK" tag. Of 261 tags, 97 include TypeScript, none names a TypeScript version above 2.5.0, and 152 list Python but not TypeScript. The parity section below follows those 152.

## Tier 4: 19 of 22 documented claims held

Eight programs in `verify/google-adk/examples/` assert documented behavior on the scripted model, and all eight pass offline (`results/run-examples.json`). I reran them for this page with `node scripts/run-examples.mjs examples --only <ids>`. Doc pages are under `source/adk-docs/docs/`.

| Claim (doc page) | Test | Result |
|---|---|---|
| A zod schema becomes the tool's function declaration (`tools-custom/function-tools.md`) | 01 | ✅ |
| A non-object return is wrapped as `{result}` (`tools-custom/function-tools.md`, "Return type") | 01 | ✅ |
| Parallel tool execution is a Python feature (`tools-custom/performance.md`, tagged Python only); TypeScript runs calls in sequence | 01 | ✅ consistent (F11) |
| `SequentialAgent` runs in order, and `outputKey` feeds `{key}` templating (`agents/workflow-agents/sequential-agents.md`) | 02 | ✅ |
| `ParallelAgent` runs each sub-agent on its own branch with shared state (`agents/workflow-agents/parallel-agents.md`) | 02 | ✅ |
| `LoopAgent` stops at `maxIterations` or on escalation (`agents/workflow-agents/loop-agents.md`) | 02 | ✅ |
| Constructing a workflow agent emits a deprecation warning (`workflows/patterns.md`) | 02 | ✅ |
| A node's output is the next node's input (`graphs/index.md`) | 03 | ✅ |
| A `route` picks the branch (`graphs/routes.md`) | 03 | ✅ |
| A `JoinNode` collects every branch's output (`graphs/routes.md`) | 03 | ✅ |
| `RequestInput` pauses the workflow, and the next message resumes it (`graphs/human-input.md`) | 03 | ✅ |
| `user:`, `app:` and `temp:` prefixes scope state as documented (`sessions/state.md`) | 04 | ✅ |
| `appendEvent` applies a `stateDelta` and drops `temp:` keys (`sessions/state.md`) | 04 | ✅ |
| Mutating a fetched `Session` does not update the stored state (`sessions/state.md`, warning) | 04 | ✅ (it has no effect at all) |
| Before-callbacks skip the step, and after-callbacks replace the result (`callbacks/types-of-callbacks.md`) | 05 | ✅ |
| A plugin hook that returns a value pre-empts the agent callback (`plugins/index.md`) | 05 | ✅ |
| `CountInvocationPlugin`'s positional hook receives the agent and the context (`plugins/index.md`) | 05 | ❌ `context` is `undefined` (F1) |
| `outputSchema` becomes `responseSchema`, and `outputKey` stores the result (`agents/llm-agents.md`) | 06 | ✅ |
| The final response "*must*" conform to `outputSchema` (`agents/llm-agents.md`) | 06 | ❌ violations are only logged (F10) |
| `requireConfirmation: true` pauses a TypeScript `FunctionTool` for approval (`graphs/human-input.md`) | 07 | ✅ |
| Approval runs the tool, and rejection returns an error (`tools-custom/confirmation.md`) | 07 | ✅ |
| TypeScript must implement confirmation by hand in `execute` (`tools-custom/confirmation.md`) | 07 | ❌ `requireConfirmation` exists (F2) |

## Sixteen findings: nine doc errors, six SDK behaviors and one unverified note

Each finding was triaged as a docs error, an SDK behavior, or a TypeScript gap against Python. Harness faults were fixed instead, and the [harness README](../../../verify/google-adk/README.md#gotchas-found-while-building-it) records them. Paths such as `agents/functions.ts` are adk-js source files at tag `main-v2.5.0`, which the mirror omits. I re-read each one at the tag, alongside the compiled `dist/esm/` file in the installed package.

### Doc errors

**F1. The plugin example uses positional hook parameters, but `BasePlugin` hooks take one object.** `plugins/index.md:141` (`count_plugin.ts`) declares `beforeAgentCallback(agent: BaseAgent, context: Context)` at `:162–165` and `beforeModelCallback(context, llmRequest)` at `:174–177`. The package declares `beforeAgentCallback(_params: { agent; callbackContext })` and `beforeModelCallback(_params: { callbackContext; llmRequest })` (`dist/types/plugins/base_plugin.d.ts:215`, `:281`). `tsc` reports TS2416 twice. At run time, the first parameter receives the params object and `context` is `undefined`, as example 05's last two checks show. The page's counter still works only because it never reads its arguments.

**F2. The confirmation page says TypeScript has no `requireConfirmation`, but 2.5.0 has it.** `tools-custom/confirmation.md:48–54` says TypeScript implements confirmation "manually within the `execute` function". The note at `:79–81` says "ADK for TypeScript currently requires manual implementation", and `:129` says the same for the predicate form. The page's TypeScript snippet builds it by hand with `toolContext.requestConfirmation`. Yet `ToolOptions.requireConfirmation` takes a boolean or a predicate (`dist/types/tools/function_tool.d.ts:31`, `:85`), and `checkConfirmation` pauses with `adk_request_confirmation` and returns `{error: "This tool call is rejected."}` on rejection (`tools/function_tool.ts:417–418`). The docs also contradict themselves: `graphs/human-input.md:251` tells TypeScript users to "Set `requireConfirmation: true` on a `FunctionTool`". Examples 07 and 08 verify the pause, approval, rejection and the predicate. One limit appears only in the `.d.ts`: a `requireConfirmation` tool used directly as a graph node "does not pause" and returns the confirmation error as its output (`function_tool.d.ts:80–83`).

**F3. Four blocks import a runtime function with `import type`, so they fail at run time.** `agents/custom-agents.md:323` imports `import type { Event, createEventActions }` and calls `createEventActions()` at `:332`. The same pattern recurs in the blocks at `:590` and `:927` (`createEvent`), and in `workflows/patterns.md:666` three times. `tsc` reports TS1361, 6 errors in 4 sources. A type-only import is erased, so each call throws a `ReferenceError`.

**F4. Two blocks import ADK's event helpers from `@google/genai`.** `agents/custom-agents.md:930` imports `Part, createEvent, Event` from `@google/genai`, and `workflows/patterns.md:669` imports `Event, createEvent, createEventActions` from it. Only `@google/adk` exports the three ADK names (`dist/types/common.d.ts:90–92`). `tsc` reports TS2305, 5 errors.

**F5. Two `BaseAgent` subclasses omit the abstract `runLiveImpl`.** `context/index.md:167` (`MyAgent`) and `:1652` (`MyControllingAgent`) extend `BaseAgent` without it. `BaseAgent` declares `runLiveImpl` abstract (`dist/types/agents/base_agent.d.ts:207`), so neither class compiles (TS2515).

**F6. A partner page passes a plain function as a tool.** `integrations/zespan.md:164` sets `tools: [getWeather]`, where `getWeather` is `(city: string) => object`. Python accepts plain functions, but TypeScript's `ToolUnion` is `BaseTool | BaseToolset | BaseNode` (`dist/types/agents/llm_agent.d.ts:120`), so the function needs a `FunctionTool` around it (TS2322).

**F7. (Minor) A pseudocode block's typed default makes its own comparison impossible.** `context/index.md:559` calls `state.get('user_display_preference', 'default_mode')`. `State.get<T>` infers `T` as the literal `'default_mode'`, so the next line's `=== 'dark_mode'` fails with TS2367. It is a typing slip in pseudocode, not a behavior bug.

**F8. (Minor) The graphs overview omits that TypeScript's `Workflow` is experimental, and so do the types.** `graphs/index.md:4` tags graphs "TypeScript v2.0.0", and its only experimental note, at `:19–21`, covers Kotlin. 2.5.0 marks the class `@experimental` (`workflow/workflow.ts:135`), so constructing one logs "Class Workflow is experimental and may change in the future." (`dist/esm/utils/experimental.js`; seen in example 03's output, not asserted). The `.d.ts` drops the decorator, so an editor shows no warning either. One page does warn: `graphs/retry.md:25–29` calls the TypeScript workflow APIs behind retries and timeouts experimental.

**F9. (Minor) The plugin page says only Python registers plugins on an `App`.** `plugins/index.md:726–727` says "on the `Runner`, or in Python on the `App`". TypeScript's `AppOptions.plugins` exists (`dist/types/apps/app.d.ts:35`), and the adk-js sample `samples/confirm_writes/agent.ts:178` uses it.

### SDK behavior

**F10. `outputSchema` is not enforced.** A reply that isn't JSON, or JSON that fails the schema, is only logged at ERROR level. The run succeeds with no error event, and `outputKey` stores the raw text or the invalid object (`agents/llm_agent.ts:896–919`; `dist/esm/agents/llm_agent.js:434–456`). A comment there calls rejection "defensible, but … a separate behaviour change". The check runs only inside the `outputKey` save, so an agent without `outputKey` never validates its output at all; I read this in the code but did not test it. The docs say the final response "*must* be a JSON string conforming to this schema" (`agents/llm-agents.md:487–489`). Python 2.14.1 calls `validate_schema` on the same path (`adk-python` `src/google/adk/agents/llm_agent.py:1144`), and pydantic's `model_validate_json` raises (`utils/_schema_utils.py:260`). Example 06 verifies the TypeScript side, and the capstone re-validates with zod for this reason.

**F11. Several tool calls in one model turn run sequentially.** The loop awaits each call inside `for (const functionCall of filteredFunctionCalls)` (`agents/functions.ts:571`). In example 01, the second of two 100 ms tools started after the first ended. Python has run them concurrently since 1.10.0, through `_gather_or_cancel` (`flows/llm_flows/tools/_batch_executor.py:246`). The docs claim parallel execution for Python only (`tools-custom/performance.md:4`), so this is a parity gap, not a doc error.

**F12. Plugin hooks and agent callbacks name the same parameters differently.** Agent callbacks receive `({ tool, args, context })` and `({ context, request })` (`dist/types/agents/llm_agent.d.ts:43–46`, `:83–87`). Plugin hooks receive `({ tool, toolArgs, toolContext })` and `({ callbackContext, llmRequest })` (`base_plugin.d.ts:281–284`, `:377–381`). Strict TypeScript flags a wrong name in an annotated override, but untyped or `any`-typed code reads `undefined`, as F1's positional hook does. Example 05 uses both forms.

**F13. All three workflow agents are deprecated in 2.5.0.** Constructing `SequentialAgent`, `ParallelAgent` or `LoopAgent` logs "X is deprecated in favor of Workflow and will be removed in a future version. Workflow cannot yet be used as an LlmAgent sub-agent." (`dist/esm/agents/sequential_agent.js:90`, `parallel_agent.js:56`, `loop_agent.js:80`). The `.d.ts` files mark them `@deprecated`. The docs agree (`agents/workflow-agents/index.md:13–19`, `workflows/patterns.md:12–19`), so this is recorded as a fact, not a doc error. Example 02's last check verifies the warnings.

**F14. Invalid tool arguments go back to the model as `{error}`.** `FunctionTool.runAsync` validates the arguments with zod before `execute` runs, and on failure throws `Error in tool '<name>': <zod issues>` (`tools/function_tool.ts:283–299`). The agent loop catches the throw, offers it to the plugins' `onToolErrorCallback`, and otherwise returns `{ error: e.message }` to the model (`agents/functions.ts:654–679`). The tool body never runs, and the run continues. Example 01 verifies it. The same path handles an `execute` that throws.

**F15. A confirmation with an unknown call id runs nothing, and the tool asks again.** A confirmation `functionResponse` whose call id ADK never issued does not run the tool. ADK treats the message as a new turn, the model calls the tool again, and a fresh `adk_request_confirmation` follows. This behavior is safe, and example 07's last two checks verify it.

**F16. (Unverified note) Transfer recursion can exhaust the stack before the call limit.** While the harness was being built, an earlier scripted model bounced `transfer_to_agent` between two agents in `dev/samples/agent_transfer_return.ts`. The run failed with "Maximum call stack size exceeded", reported as an `UNKNOWN_ERROR` event, before the default 500-call limit (`dist/types/agents/run_config.d.ts:164`) raised `LlmCallsLimitExceededError`. With `--stack-size=2000`, the limit error fired instead. The current scripted model transfers at most once, and the sample now runs with 2 model calls, so nothing reproduces this. Only a pathological model triggers it. Treat it as a lead, not a result.

## Corrections to the draft findings

The S7a harness produced 16 draft findings (`verify/google-adk/results/findings-draft.md`). I re-checked each one against its evidence before writing this page. None was dropped. Seven changed, and the other nine held as drafted.

| Draft | Draft claim | Correction | Evidence |
|---|---|---|---|
| F2 | The confirmation docs say TypeScript has no `requireConfirmation` | The docs contradict themselves: `graphs/human-input.md:251` documents the option for TypeScript. Added the `.d.ts`-only limit for graph nodes | `graphs/human-input.md`; `function_tool.d.ts:80–83` |
| F3 | The pattern appears at `custom-agents.md:599` | `:599` is a call site; the failing blocks start at `:320`, `:590` and `:927` | `results/typecheck-docs.json` |
| F8 | The docs don't mark `Workflow` experimental for TypeScript | `graphs/retry.md:25–29` does, for the APIs behind retries and timeouts. The overview and the `.d.ts` omit it | `graphs/retry.md`; `graphRuntime.experimental: false` in `results/factcheck-api.json` |
| F10 | `outputSchema` is not enforced | Narrowed: the check runs only while saving `outputKey`, in both languages; Python's line is `:1144`, not `:1143` | `dist/esm/agents/llm_agent.js:406–456`; adk-python v2.14.1 `llm_agent.py` |
| F12 | Moved code "compiles only where the types are spelled out" | Restated: strict TypeScript flags a wrong name, and untyped code reads `undefined` | `llm_agent.d.ts`, `base_plugin.d.ts` |
| F14 | Invalid arguments "don't throw" | `runAsync` does throw; the agent loop catches it, after `onToolErrorCallback`, and returns `{error}` | `agents/functions.ts:654–679` |
| F15 | A forged call id "restarts the turn" | Worded as observed: the tool runs nothing and asks for confirmation again; no claim about why | `examples/07-tool-confirmation.ts` |

F16 stays an unverified note, as the draft marked it. The draft's citations of adk-js `core/src/` and adk-python files point outside the mirror. I re-read them at the tags (`main-v2.5.0`, `v2.14.1`) and found each line within two of where the draft put it.

## TypeScript parity: 14 features missing, 2 weaker, 15 documented only for Python

Python `google-adk` 2.14.1 is ADK's primary implementation. The guide's [TypeScript parity section](guide.md#14-typescript-parity-250-lacks-14-python-features-has-2-in-weaker-form-and-has-15-the-docs-show-only-for-python) lists every gap, and [`results/parity-draft.md`](../../../verify/google-adk/results/parity-draft.md) holds the Python and TypeScript evidence for each. The [TypeScript gap report](../../comparison/typescript-gaps.md#google-adk-the-port-trails-python-by-14-features-but-the-docs-undersell-it-by-15) sets these counts beside the other SDKs. In short:
- **Missing from 2.5.0 (14):** among them LiteLLM, context caching, session rewind and `set_default_model`. `AuthenticatedFunctionTool` is already on adk-js main.
- **Weaker (2):** `outputSchema` enforcement (F10) and parallel tool execution (F11).
- **In TypeScript, documented only for Python (15):** among them `requireConfirmation` (F2), `App` plugins (F9), resumability, `runLive`, planners and the database session service.

For this page, I searched the 2.5.0 `.d.ts` files for 27 names. The 10 names the draft lists as missing, such as `LiteLlm` and `rewind`, are absent. The 17 names it lists as documented only for Python or as TypeScript-only, such as `runLive` and `ChromeBuiltInLlm`, are declared. I re-read the Python source for F10 and F11 only. The other Python entries rest on class names that the S7a check found, and no Python code ran.

## U18 memory findings: the TypeScript memory service cannot delete (2026-11-19)

The retrieval and memory research (U18) read the memory typings of `@google/adk` 2.5.0 on 2026-11-19 and compared them with Python ADK 2.14.1, and the owner approved recording what it found ([U18 report](../../research/memory/retrieval-and-memory.md#all-eight-sdks-retrieve-through-tools-six-ship-long-term-memory-and-none-expires-it-in-the-process); [SDK notes](../../research/memory/notes/sdks-cloudflare-adk-copilot-pi.md)). These findings add to the parity count above without changing it.

**M1. `BaseMemoryService` has no delete method.** The TypeScript interface declares only `addSessionToMemory` and `searchMemory` (`dist/types/memory/base_memory_service.d.ts:37–52`), and no memory typing in the package names a delete. Python ADK 2.14.1 declares `delete_memory` on its base service ([ADK Python source at tag v2.14.1](https://github.com/google/adk-python/blob/v2.14.1/src/google/adk/memory/base_memory_service.py)). A TypeScript agent cannot forget a memory through ADK.

**M2. The in-memory service matches whole lowercase words only.** The adk-js guide says matching "is whole-word, so `flight` does not match `flights`" (`source/adk-js/docs/guides/memory/index.md:66`), so a recall query must use words that appear in the stored events. No example tests `InMemoryMemoryService` yet.

## U19 A2A findings: the `basePath` default drifts, and the guide uses the old card path (2026-11-19)

The A2A research (U19) read the A2A code of `@google/adk` 2.5.0 on 2026-11-19, and the owner approved recording what it found (owner decision 2026-11-19; [A2A report](../../research/a2a/agent-to-agent-protocols.md#one-of-our-eight-sdks-ships-a2a-in-typescript-and-it-speaks-03-not-10); [SDK notes](../../research/a2a/notes/sdk-support.md#google-adk-googleadk-250)). None of the three findings changes the counts above. A3 came from T45's example, which ran both paths on 2026-11-22.

**A1. `ToA2aOptions.basePath` documents a default the code does not use.** The typing says "The base path for the A2A RPC URL (default: "a2a")" (`dist/types/a2a/agent_to_a2a.d.ts:39`), but the code sets `const basePath = options.basePath || ""` (`dist/esm/a2a/agent_to_a2a.js:82`) and mounts the card, `/rest` and `/jsonrpc` under it (`:116`, `:120`, `:128`). An unset `basePath` therefore serves the endpoints at the root, not under `/a2a`. A caller who builds URLs from the documented default reaches nothing.

**A2. The agents guide's `RemoteA2AAgent` example uses the pre-0.3 card path.** It passes `agentCard: 'https://billing-agent.example.invalid/.well-known/agent.json'` (`source/adk-js/docs/guides/agents/index.md:333`). ADK itself serves the card at `.well-known/agent-card.json`: it re-exports `AGENT_CARD_PATH` from `@a2a-js/sdk` (`dist/types/a2a/a2a_remote_agent.d.ts:6` and `:12`), and `@a2a-js/sdk` 0.3.14 declares that value (`dist/index.d.ts:15`). The error is minor, because the URL names an example host.

**A3. The card string is a base URL resolved like a relative URL, so the guide's example would fetch a doubled path.** `RemoteA2AAgent` hands `agentCard` to `@a2a-js/sdk`'s `DefaultAgentCardResolver.resolve(baseUrl, path)`, which builds `new URL(path ?? AGENT_CARD_PATH, baseUrl)` (`@a2a-js/sdk` 0.3.14 `dist/client/index.js:719–720`) and so resolves `.well-known/agent-card.json` against whatever it is given, as a relative URL. The guide's full card URL (A2) therefore resolves to `/.well-known/.well-known/agent-card.json`, and the card fetch returns a 404. A base URL with a path and no trailing slash loses its last segment (`http://host/a2a` gives `http://host/.well-known/agent-card.json`), so a server mounted under `basePath: "/a2a"` needs `http://host/a2a/`. `verify/google-adk/examples/09-a2a-delegation.ts` runs both: an origin, a `/a2a` base that fails without the slash and a `/a2a/` base that succeeds. The fix to A2 is the base URL, not `agent-card.json`.

## What we could not verify

Five areas stayed outside the offline harness:
- **Real models.** The scripted model shows that the loop, tools, state and pauses work, not how Gemini behaves, including how it handles `responseSchema` and `set_model_response`.
- **Integrations.** The 42 MCP sources, code execution, Google Cloud services, OAuth and `@google/adk-integrations` (Claude, BigQuery, LangChain, CrewAI) need servers, credentials or a package outside the pin.
- **Live streaming.** `runLive` needs the bidi API, and the scripted model refuses live connections.
- **Persistent sessions.** Only `InMemorySessionService` ran; the database and Vertex AI services did not.
- **Python behavior.** The parity check reads Python docs and source and runs no Python, and F16 stays unreproduced.

## Verdict: trust the TypeScript code, not the TypeScript prose

ADK's TypeScript package does what its code examples show. No runnable doc source failed: 109 ran, and 54 were skipped for a stated external need. Every documented option exists in 2.5.0, and 19 of 22 documented behaviors held. Its 9 compile failures are slips in hand-written page blocks; the snippet files and samples have none. The prose is where TypeScript readers lose time. The docs are written for Python first, and 152 support tags leave TypeScript off, so they describe the port as weaker than it is (F2, F9) and occasionally stronger (F10). Two behaviors deserve a deliberate choice before launch: re-validate `outputSchema` output yourself, and expect tool calls to run in sequence. Check the 2.5.0 `.d.ts` before you trust a "Python only" tag, compile each copied example, and rerun `pnpm run verify` at each upgrade to catch the next drift.
