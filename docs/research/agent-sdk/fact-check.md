# Fact-check log: agent-SDK research synthesis

- **Date:** 2026-11-18
- **Document checked:** [agent-sdk-research.md](agent-sdk-research.md)
- **Method:** for each claim, I opened the cited file and line under `verify/<sdk>/node_modules/` (as of November 2026: Claude Agent SDK 0.3.327, Pi 1.5.2, OpenAI Agents SDK 0.21.0, `ai@7.0.162`, `langchain@1.6.1`) and compared it with the synthesis text.
- **Legend:** ✅ confirmed as written · ✏️ corrected (the synthesis carries the fixed text; the note it came from still has the old text) · ⚠️ confirmed in part, or rests on a source I could not open

| # | Claim | Check | Result |
|---|---|---|---|
| 1 | Vercel `generateText` and `streamText` default `stopWhen` to `isStepCount(1)` | `verify/vercel-ai-sdk/node_modules/ai/dist/index.js:5199` and `:8822`, both `stopWhen = isStepCount(1)` | ✅ |
| 2 | `ToolLoopAgent` defaults to 20 steps and warns when the default fires | `ai/dist/index.js:10611-10626` (`createDefaultStopCondition` calls `logWarnings`) and `:10675` (`createDefaultStopCondition(20)`) | ✅ |
| 3 | OpenAI `run()` defaults to 10 turns | `@openai/agents-core/dist/runner/constants.js:5`: `DEFAULT_MAX_TURNS = 10` | ✅ |
| 4 | Vercel retries API calls twice by default, with a 2 s initial delay and factor 2 | `ai/dist/index.js:2325` (`maxRetries = 2, initialDelayInMs = 2e3, backoffFactor = 2`) and `:2346` (`defaultMaxRetries = 2`) | ✅ |
| 5 | OpenAI model retries are opt-in | `@openai/agents-core/dist/model.d.ts:218-232`: "Retries remain opt-in; no retries occur unless `policy` returns `true`." | ✅ |
| 6 | Pi disables vendor-SDK retries because their timers ignore the AbortSignal, and fails fast above 60 s | `@earendil-works/pi-ai/dist/utils/provider-retry.js:68-75` | ✅ |
| 7 | Pi drops thinking from a different model and keeps signed or redacted thinking from the same model | `pi-ai/dist/api/transform-messages.js:91-104` | ✅ |
| 8 | LangChain's `AsyncCaller` defaults to 6 retries | `@langchain/core/dist/utils/async_caller.js:182`: `params.maxRetries ?? 6`; doc comment at `async_caller.d.ts:42` | ✅ |
| 9 | LangChain's chat-model stream protocol is content-block start, delta and finish, with only an ordering invariant | `@langchain/core/dist/language_models/chat_models.d.ts:150-170` | ✅ |
| 10 | `@langchain/core` has no `specificationVersion` field | `grep -rl specificationVersion verify/langchain/node_modules/@langchain/core/dist` returns nothing | ✅ |
| 11 | LangChain's recursion limit defaults to 25 | `@langchain/core/dist/runnables/config.js:85`: `recursionLimit: 25`. The "13 model calls" figure comes from the [LangChain guide §9](../../reference/langchain/guide.md), example 06, which I did not rerun | ⚠️ |
| 12 | LangChain middleware has six hooks | `langchain/dist/agents/middleware/types.d.ts:352-417`: `wrapToolCall`, `wrapModelCall`, `beforeAgent`, `beforeModel`, `afterModel`, `afterAgent` | ✅ |
| 13 | LangChain composes `wrapModelCall` with the first middleware outermost | `langchain/dist/agents/nodes/AgentNode.js:197`: "Build composed handler from last to first so first middleware becomes outermost" | ✅ |
| 14 | LangChain tool schemas are Zod or JSON Schema 7, and both are validated | `@langchain/core/dist/tools/types.d.ts:42` (`InteropZodType \| JsonSchema7Type`); `tools/index.js:104-122` (Zod parse, else `validate()`, both throw `ToolInputParsingException`) | ✅ |
| 15 | LangChain turns tool errors into an error `ToolMessage` ending "Please fix your mistakes.", while `wrapToolCall` errors bubble unless `handleToolErrors` is `true` | `langchain/dist/agents/nodes/ToolNode.js:31-46` and `:150-153` | ✅ |
| 16 | LangChain runs tool calls with `Promise.all` in graph v1 and one `Send` task per call in v2, the default | `ToolNode.js:346`; `ReactAgent.js:49` (`#toolBehaviorVersion = "v2"`) and `:397`; option doc at `agents/types.d.ts:692-710` | ✅ |
| 17 | LangChain's `fakeModel()` throws on over-run, records a shallow copy of messages, and has no under-run assertion | `@langchain/core/dist/testing/fake_model_builder.js:144-152`; `fake_model_builder.d.ts:27-104` lists no assertion method. `langchain` re-exports it from `@langchain/core/testing` (`langchain/dist/index.d.ts:46`); the synthesis names the defining package | ✅ |
| 18 | `ScriptedModel` throws `UnexpectedModelCallError` on an extra call | `@openai/agents-core/dist/testing/scriptedModel.mjs:226-229` | ✅ |
| 19 | `MockLanguageModelV4`'s array form returns `undefined` once exhausted | `ai/dist/test/index.js:148`: `doGenerate[this.doGenerateCalls.length - 1]` | ✅ |
| 20 | Pi runs tools in parallel by default, and one sequential tool makes the whole batch sequential | `pi-agent-core/dist/agent.js:147`; `agent-loop.js:372-379` | ✅ |
| 21 | OpenAI's default tool error text is "An error occurred while running the tool. Please try again." and `strict` defaults to true | `@openai/agents-core/dist/tool.js:572-574`; `tool.mjs:694` (`options.strict ?? true`) | ✅ |
| 22 | Claude has 33 hook events, with `onFailure` defaulting to `continue` | `claude-agent-sdk/sdk.d.ts:1032`: 33 quoted names in `HOOK_EVENTS`; `:1044-1062` | ✅ |
| 23 | Claude PostToolUse hooks "run in parallel on the ORIGINAL output" | The note cites `sdk.d.ts:2884`; the sentence is on line 2886 | ✏️ Line reference changed to `C:2886` |
| 24 | Pi has 41 extension events; Vercel's `index.d.ts` has 143 `@deprecated` tags; OpenAI's `agents-core` declarations have none | `pi-coding-agent/dist/core/extensions/types.d.ts:1229-1269` (41 `on(event: …)` overloads); `grep -c @deprecated` gives 143 and 0 | ✅ |
| 25 | Pi ships "Breaking Changes" in patch releases | notes/hooks-events-api.md §5 says the 1.5.2 patch carries one, citing `CHANGELOG.md:3, 29-32`. Line 3 is the 1.5.2 heading, which has only New Features, Changed and Fixed; the section at line 29 belongs to 1.5.1 (line 18). Breaking sections also appear under 1.5.0 (`:143`), 1.2.0 (`:363`) and the 1.0.3 patch (`:498`) | ✏️ Synthesis names the patch releases 1.5.1 and 1.0.3, not 1.5.2 |
| 26 | Vercel's MCP adapter returns an `isError` result as a normal value | `@ai-sdk/mcp/dist/index.js:2934`: `if (result.isError) return result;` | ✅ |
| 27 | LangChain's `initChatModel` infers OpenAI only from `gpt-3`, `gpt-4`, `gpt-5`, `o1`, `o3`, `o4` | `langchain/dist/chat_models/universal.js:171` | ✅ |

The two corrections changed the synthesis's references, not its conclusions. Pi still ships breaking changes in patch releases, so decision 13's rule against breaking patches stands.
