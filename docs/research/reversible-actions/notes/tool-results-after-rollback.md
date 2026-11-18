# Tool results after a rollback: how tool errors are represented and what the model should be told (as of November 2026)

*Working material for the [server rollback report](../server-rollback.md); the report and its [fact-check log](../fact-check-server-rollback.md) supersede this note where they disagree.*

Scope: wire formats for tool errors, what our eight verified SDKs do with thrown vs returned errors, vendor guidance on error text, and how to design the result a backend returns after a write was rolled back, rejected, partially applied or has an unknown outcome. Web pages fetched 2026-11-18 with `curl -sSL --max-time 30`. Repo paths are relative to the repo root; package-source line numbers refer to the exact pins in `verify/<sdk>/package.json`.

## 1. Wire formats for tool errors (Anthropic, OpenAI, MCP, Gemini)

### Takeaway
Only Anthropic (`is_error`) and MCP (`isError`) carry a boolean error flag on the tool result; OpenAI's `function_call_output` and Gemini's `functionResponse` carry no flag, so the error must be encoded in the payload itself (Gemini documents an `"error"` key; OpenAI leaves the format to the developer). None of the four defines "rolled back", "partially applied" or "unknown outcome" states, so any such taxonomy must live in the result body.

### Cited Findings

**Anthropic Messages API**
- A `tool_result` block has an optional `is_error`: "Set to `true` if the tool failed or the call was invalid." — [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md) (fetched 2026-11-18; page description: "handle errors with is_error").
- "When a client tool fails or a call is invalid, send a `tool_result` block with `is_error` set to `true`. Claude might then call the tool again … so limit how many retries your loop allows." — [Handle tool calls, "Handling errors with is_error"](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md)
- Example content: `"ConnectionError: the weather service API is not available (HTTP 500)"` with `"is_error": true`; and `"Error: Missing required 'location' parameter"` for an invalid call. — [same page](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md)
- Guidance (quote ≤25 words): "Instead of generic errors such as `"failed"`, include what went wrong and what Claude should try next (for example, `"Rate limit exceeded. Retry after 60 seconds."`)." — [same page, Tip](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md)
- Server tools differ: "you don't send `is_error` results for server tools. When a server tool hits an error … the API returns the error inside the tool's result block." — [same page, "Server tool errors"](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md)
- Every `tool_use` id needs a matching `tool_result` immediately after, or the API errors ("tool_use ids were found without tool_result blocks immediately after"). — [same page](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md). Implication for rollback: a rolled-back call still must get a result block; it cannot be silently dropped.

**OpenAI (Responses / Chat Completions)**
- "The result you pass in the `function_call_output` message should typically be a string, where the format is up to you (JSON, error codes, plain text, etc.). The model will interpret that string as needed." — [OpenAI function calling guide, "Formatting results"](https://developers.openai.com/api/docs/guides/function-calling.md)
- "If your function has no return value (for example, `send_email`), return a string that indicates success or failure, such as `"success"`." — [same](https://developers.openai.com/api/docs/guides/function-calling.md)
- Images or files may be passed as an array instead of a string. — [same](https://developers.openai.com/api/docs/guides/function-calling.md)
- I found no error flag on `function_call_output` in the guide; the absence is from reading the guide, not the full API reference (see Gaps).
- Because there is no flag, the Vercel AI SDK's OpenAI adapter encodes tool errors as JSON `{"error": <value>}` in the output string (`verify/vercel-ai-sdk/node_modules/@ai-sdk/openai/dist/index.js:1190-1193, 5191-5192, 6040-6042`, `@ai-sdk/openai@4.0.108`), while its Anthropic adapter sets `is_error: true` for `error-text`/`error-json` outputs (`@ai-sdk/anthropic/dist/index.js:2978`, `@ai-sdk/anthropic@4.0.96`). Read from installed package source; not exercised by a verify example.

**MCP**
- Current revision is **2026-07-28** ("The current protocol version is 2026-07-28") — [MCP versioning](https://modelcontextprotocol.io/specification/versioning.md). Previous revision 2025-11-25 has the same error-handling text in substance — [2025-11-25 tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools.md).
- `CallToolResult.isError` doc comment (2026-07-28 schema): "Any errors that originate from the tool SHOULD be reported inside the result object, with `isError` set to true, _not_ as an MCP protocol-level error response." and "Otherwise, the LLM would not be able to see that an error occurred and self-correct." Errors in *finding* the tool or unsupported tool calls "should be reported as an MCP error response." If unset, `isError` "is assumed to be false". — [schema.ts 2026-07-28, `CallToolResult`](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.ts) (lines ~1812-1841)
- Spec text, "Error Handling": two mechanisms. Protocol errors (unknown tool, malformed request, server errors) are JSON-RPC errors that "models are less likely to be able to fix". Tool execution errors (API failures, input validation, business logic errors) "contain actionable feedback that language models can use to self-correct and retry with adjusted parameters". "Clients **SHOULD** provide tool execution errors to language models to enable self-correction." "Clients **MAY** provide protocol errors to language models". — [MCP 2026-07-28, Tools, Error Handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md)
- 2026-07-28 example error result now carries `"resultType": "complete"` alongside `isError: true` (`CallToolResultResponse.result` is `CallToolResult | InputRequiredResult`). — [same page](https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md); [schema.ts](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.ts)
- New in 2026-07-28 tools page (state handles): "A call against an expired or unknown handle should return a tool execution error that says so, so the model can recover by creating a new one." Handles should be opaque, and the server "should validate the caller's authorization against the handle on every call." — [MCP 2026-07-28 Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md). Relevant model for operation ids returned in rollback results.
- Tool annotations relevant to retry safety: `idempotentHint` ("calling the tool repeatedly with the same arguments will have no additional effect", default false) and `destructiveHint` (default true), meaningful only when `readOnlyHint == false`. — [schema.ts 2026-07-28, `ToolAnnotations`](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.ts). The repo already notes clients "should never make tool use decisions" on annotations from untrusted servers ([docs/research/agent-sdk/agent-sdk-research.md §3](../../../research/agent-sdk/agent-sdk-research.md)).

**Gemini API**
- `FunctionResponse.response` (required, JSON object): "Callers can use any keys of their choice … e.g. "output", "result", etc. In particular, if the function call failed to execute, the response can have an "error" key to return error details to the model." — [Gemini API reference, FunctionResponse](https://ai.google.dev/api/caching.md.txt)
- `FunctionResponse.id` matches the function call id; `parts` may carry multimedia referenced by `{"$ref": ...}`. — [same](https://ai.google.dev/api/caching.md.txt)
- The function calling guide's best practices say only "**Error Handling:** Implement robust error handling." — [Gemini function calling guide](https://ai.google.dev/gemini-api/docs/function-calling.md.txt). ADK follows the `{error}` convention (see §2).

### Inferences
- A portable rollback result must put its status in the body (text and/or JSON), and set the provider flag (`is_error`/`isError`) where one exists. A provider-neutral SDK needs one internal `isError` that each adapter lowers: `is_error` for Anthropic, `isError` for MCP, `{"error": …}` wrapping for OpenAI and Gemini (Vercel's adapters already do this).
- Whether "rolled back" should set the error flag is a design choice none of the specs addresses. The flag signals "this call did not do what you asked"; a fully compensated write meets that bar, so setting it is consistent with the specs' wording ("tool failed", "business logic errors").

### Gaps
- I did not fetch the OpenAI Responses API reference for `function_call_output` fields, so "no error flag" rests on the function calling guide plus the Vercel adapter's behaviour. Chat Completions `role: "tool"` messages were not re-checked this session.
- Anthropic's docs do not say how Claude weighs `is_error` versus error text in content; no published behavioural data found.

## 2. What our eight verified SDKs do with a thrown tool error vs a returned error

### Takeaway
All eight keep the loop running and feed tool failures to the model as data, but they differ on what the model reads (raw exception, generic text, or developer-composed text) and on how many outcome kinds a result can express. Copilot is the only SDK with a typed outcome enum beyond success/error (`success | failure | rejected | denied | timeout`), and OpenAI is the only one with a first-class timeout-as-result option. None has a "rolled back" or "partially applied" kind.

### Cited Findings

| SDK (pin) | Thrown error | Returned error | Notes for rollback results |
|---|---|---|---|
| Claude Agent SDK `0.3.327` | In-process MCP server "converts it to an error result carrying the raw exception message … and the agent loop continues" | `isError: true`: "Claude sees the message you compose … such as which request failed or what to try instead" | `docs/reference/claude-agent-sdk/source/custom-tools.md` "Handle errors" (~line 423-431); guide §5 (`docs/reference/claude-agent-sdk/guide.md`). With `structuredContent` set, text blocks in `content` don't reach Claude (`docs/research/agent-sdk/notes/tools.md` §7) |
| OpenAI Agents SDK `0.21.0` | Default `errorFunction` returns "An error occurred while running the tool. Please try again." (`docs/research/agent-sdk/notes/loop-shapes.md` §4) | Return any value; `errorFunction(context, error, details)` transforms errors | With `outputSchema`, default `errorFunction` is disabled and errors rethrow; `timeoutBehavior: 'error_as_result'` (default without `outputSchema`) vs `'raise_exception'`, plus `timeoutErrorFunction` (`docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/tools.mdx:181-184, 388-393`). `toolErrorFormatter` covers only `approval_rejected` and `tool_not_found` kinds, defaults "Tool execution was not approved." / "Tool '<name>' not found." (`guides/running-agents.mdx:199-218`). `customDataExtractor` attaches SDK-only data "not sent back to the model" (`tools.mdx:185`) |
| Vercel AI SDK `ai@7.0.162` | Becomes a `tool-error` part, loop continues (`docs/research/agent-sdk/notes/tools.md` §7; `ai/dist/index.js:2918-2938`) | `toModelOutput` maps to `text | json | execution-denied | error-text | error-json | content` | Invalid input → `tool-error` **[verified: vercel 02]** (`docs/reference/vercel-ai-sdk/guide.md` §3; fact-check row "Invalid tool input becomes a `tool-error`"). MCP `isError` is lost: Vercel's MCP adapter returns it as normal content (`notes/tools.md` §7) |
| Pi `1.5.2` | Never rejects; unknown tools, invalid args, blocked calls and exceptions all become `isError: true` results (`docs/research/agent-sdk/agent-sdk-research.md` §3; `agent-loop.js:556-564`) | Return `isError: true` while keeping `details` | Inactive tool → "Tool … not found" error result **[verified: pi 03]** (`docs/reference/pi/guide.md` §5). Three channels: `content` (model), `details` (UI/log), `structuredContent` "not sent to the model" (`notes/tools.md` §7) |
| LangChain `langchain@1.6.1` | `defaultHandleToolErrors` returns `ToolMessage{status:"error"}` with `${error}\n Please fix your mistakes.` (`verify/langchain/node_modules/langchain/dist/agents/nodes/ToolNode.js:31-46`) | Return a `ToolMessage` with `status: "error"` | Errors from `wrapToolCall` middleware bubble unless `handleToolErrors` is true (`agent-sdk-research.md` §3). `toolErrorMiddleware({onError})` is opt-in; docstring: "Prefer returning content that identifies the error type without including the raw error message, which may contain sensitive or internal details." It "does not retry" (`langchain/dist/agents/middleware/toolError.d.ts:28-40`). Not documented on any mirrored page (`docs/reference/langchain/fact-check.md` tier table) |
| Google ADK `@google/adk@2.5.0` | Loop catches, offers to plugins' `onToolErrorCallback`, else returns `{ error: e.message }` (`docs/reference/google-adk/fact-check.md` F14; `agents/functions.ts:654-679`) | Return `{error: …}` or any object; non-objects wrapped as `{result}` | Zod failure → `{error}` **[verified: adk 01]** (`docs/reference/google-adk/guide.md` §3). Rejected confirmation returns an error (`fact-check.md` row "rejection returns an error", verified 07) |
| Copilot SDK `1.0.31` | Error message is sent to the runtime via `handlePendingToolCall({requestId, error: message})` (`verify/copilot-sdk/node_modules/@github/copilot-sdk/dist/session.js:1257-1264`) | `ToolResultObject { textResultForLlm, resultType, error?, sessionLog?, toolTelemetry?, binaryResultsForLlm? }`, `resultType: "success" | "failure" | "rejected" | "denied" | "timeout"` (`dist/types.d.ts:526-546`) | `resultType` is required for a structured result; otherwise the object is serialized as JSON text (`docs/reference/copilot-sdk/source/nodejs/docs/agent-author.md:108`). `onPostToolUseFailure` fires only for `"failure"`; "`rejected`, `denied`, `timeout` do not currently fire it" (`agent-author.md:219-220`). `convertMcpCallToolResult` maps MCP `isError` → `"failure"` (`dist/types.js:85-88`). `sessionLog` is a separate log string (Go README example `SessionLog: "Fetched issue …"`, `source/go/README.md:1010`); a post-tool-use hook redacts it (`source/docs/hooks/post-tool-use.md:389-393`) |
| Cloudflare Agents `agents@0.33.0`, `@cloudflare/ai-chat@0.12.2`, `@cloudflare/think@0.23.0` | Built on the AI SDK, so server tool throws follow Vercel's `tool-error` path (inferred from the dependency; not separately verified) | Client side: `addToolOutput({ state: "output-error", errorText })` | Denial via `addToolApprovalResponse({approved:false})` sets `output-denied` with generic "Tool execution denied."; `output-error` with `errorText` gives a specific reason and "does **not** auto-continue" (`docs/reference/cloudflare-agents/source/agents/docs/agents/human-in-the-loop.md:336-353`) |

- The repo's SDK guide already concludes "return every failure to the model as data" and that "Any failure becomes an `isError` result with path-level messages and the received arguments, so nothing throws out of the loop" — [docs/guides/agent-sdk.md §4](../../../guides/agent-sdk.md). Its proposed type: `interface ToolResult<S> { content; details?; structured?; isError?; terminate? }` — [agent-sdk.md §11](../../../guides/agent-sdk.md).
- OpenAI's generic default is a deliberate redaction "since tool errors can carry secrets" (`tool.mjs:833-845`), at the cost of the self-correction signal — [docs/research/agent-sdk/notes/tools.md §3](../../../research/agent-sdk/notes/tools.md).
- Two adapters drop MCP `isError` (Vercel MCP, OpenAI MCP keeps it only for `customDataExtractor`) — [agent-sdk-research.md §3](../../../research/agent-sdk/agent-sdk-research.md).

### Inferences
- Copilot's enum shows a precedent for typed outcomes beyond a boolean; a rollback taxonomy (`not_applied`, `compensated`, `partial`, `unknown`) could be a parallel field rather than overloading `isError`. Its split of `textResultForLlm` (model) from `sessionLog`/`toolTelemetry` (log) matches Pi's `content`/`details` and OpenAI's `customData`: three SDKs already separate model-visible text from log-only data.
- Because thrown errors in Claude, ADK, LangChain default and Vercel reach the model with the raw exception message, a backend that throws on rollback leaks internals by default. Return a composed result instead of throwing.
- An MCP-hosted rollback tool must keep `isError` *and* state in the text, because two adapters drop the flag.

### Gaps
- Cloudflare server-side tool throw behaviour inside `AIChatAgent`/`Think` was not traced in source this session.
- Copilot docs do not define `sessionLog` semantics in prose; meaning inferred from field name, Go example and hook example.

## 3. Vendor guidance on error messages for models

### Takeaway
Anthropic, MCP and RFC-style API guidance converge: errors should be specific and actionable, say what to try next, and avoid opaque codes, tracebacks and implementation internals. The repo's guides add a practitioner lesson: say what *not* to do next (do not fabricate or mock).

### Cited Findings
- Anthropic, "Writing effective tools for agents" (published Sep 11, 2025): "if a tool call raises an error (for example, during input validation), you can prompt-engineer your error responses to clearly communicate specific and actionable improvements, rather than opaque error codes or tracebacks." — [anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Same post: return "only high signal information", "eschew low-level technical identifiers (for example: `uuid`, `256px_image_url` …)"; resolving UUIDs to semantically meaningful language "significantly improves Claude's precision … by reducing hallucinations"; agents sometimes need both natural-language and technical identifiers "to trigger downstream tool calls". — [same](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Same post: track "tool errors" as an eval metric; "lots of tool errors for invalid parameters might suggest tools could use clearer descriptions or better examples." — [same](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Anthropic API docs: include "what went wrong and what Claude should try next" — [Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md)
- Claude Agent SDK docs: "Catch errors yourself when the raw exception message isn't enough for Claude to act on." — `docs/reference/claude-agent-sdk/source/custom-tools.md` ("Handle errors")
- MCP: tool execution errors "contain actionable feedback that language models can use to self-correct and retry with adjusted parameters" — [MCP 2026-07-28 Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md)
- OpenAI guide gives format freedom ("JSON, error codes, plain text") but no error-wording guidance in the function calling guide; its relevant design advice is "Don't make the model fill arguments you already know" — [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling.md)
- LangChain: prefer content "that identifies the error type without including the raw error message" — `langchain/dist/agents/middleware/toolError.d.ts:35-36`
- Repo guide: "Errors should tell the model what to do next, and also what not to do"; practitioners report agents inventing data after a failed tool ("I can just make a mock implementation …"); example triage error: "No order 4417 belongs to this requester. Set `needs_human` or ask the requester for the order number; do not guess an order." — [docs/guides/agent.md §3](../../../guides/agent.md); [docs/guides/agent-sdk.md §4](../../../guides/agent-sdk.md) (citing HN synthesis §4.1, secondary/practitioner source).
- Repo guide: "Tools should return 'semantic, stable identifiers'" and keep model content, UI/log details and structured data apart — [docs/guides/agent.md §3](../../../guides/agent.md)

### Inferences
- A rollback message should therefore name the operation in human terms, state the current state plainly, give one recommended next action, and forbid the obvious bad recovery (e.g. "do not tell the user the refund was issued", "do not retry with a new key").

### Gaps
- No vendor publishes guidance specifically on *rollback/compensation* results or on "unknown outcome" for agent tools; I found none on Anthropic, OpenAI, MCP or Gemini pages fetched. The taxonomy in §4 is synthesis from distributed-systems sources.

## 4. Designing the result after a rollback (not applied, compensated, partial, unknown)

### Takeaway
Distributed-API practice supplies the outcome taxonomy and retry rules: a retry is safe only when the write provably did not happen or the operation is idempotent under the same key; a timeout is an ambiguous outcome that requires reconciliation or an idempotent retry, not a blind retry. The tool result should carry an outcome kind, the operation/idempotency id, the current state, whether retry is safe, and a recommended next action, with internals kept in the log channel.

### Cited Findings
- **Unknown outcome on timeout.** AWS: after a network timeout with no response, "It's not clear whether the singleton workload is running or not. Simply retrying the request could result in multiple workloads"; the caller "has to perform a reconciliation". — [AWS Builders' Library, "Making retries safe with idempotent APIs" (Malcolm Featonby)](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- AWS's fix: "a unique caller-provided client request identifier" in the contract; duplicates return a "semantically equivalent response"; a reused token with different parameters gets "a validation error indicating a parameter mismatch". The token (`ClientToken`) is echoed back in the response, and the SDK/CLI generate one automatically when supported. — [same](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
- **Idempotency-Key header (IETF).** `draft-ietf-httpapi-idempotency-key-header-08`, dated 22 October 2026, expires 25 April 2027 (still an Internet-Draft, not an RFC, as of November 2026). Retry after completion: respond "consistent with the request being completed according to the user's intent"; retry before completion (concurrent): "SHOULD respond with a resource conflict error"; key expiry policy "SHOULD" be published; error examples use RFC 9457. — [draft-08 text](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-08.txt); [datatracker metadata](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)
- **Stripe.** v1 saves the status and body of the first request after execution begins; retries with the same key "return the saved response, including `500` errors". In API v2, "retries don't repeat successful operations. Stripe retries failed or partially failed work to completion when possible". Validation failures and concurrent conflicts are not saved, so "You can retry these requests." Keys may be pruned after 24 hours; parameter mismatch errors. — [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests.md). Stripe v2 is a published example of "partially applied" being completed on idempotent retry.
- **Retryability by status (Google AIP-194).** Clients "should not automatically retry transactional requests"; `UNAVAILABLE` is retryable; `DEADLINE_EXCEEDED`, `INVALID_ARGUMENT` should not be auto-retried; `UNKNOWN` "may not be safe to retry"; `ABORTED` "should be retried at a level higher (the entire transaction, for example)". — [AIP-194](https://raw.githubusercontent.com/aip-dev/google.aip.dev/master/aip/general/0194.md) (rendered at https://google.aip.dev/194)
- **Structured error identity (Google AIP-193).** All errors "must include an `ErrorInfo`"; `reason` is short snake_case, ≤63 chars; `(reason, domain)` pair is the machine-readable identity and must be stable; dynamic values go in `metadata`; `message` is developer-facing. — [AIP-193](https://raw.githubusercontent.com/aip-dev/google.aip.dev/master/aip/general/0193.md) (https://google.aip.dev/193)
- **Agent SDK precedents for states.** Copilot `resultType` distinguishes `failure`, `rejected`, `denied`, `timeout` (`@github/copilot-sdk@1.0.31` `dist/types.d.ts:526`). OpenAI Agents SDK can return a timeout as a model-visible result (`timeoutBehavior: 'error_as_result'`) — `docs/reference/openai-agents-sdk/source/docs/src/content/docs/guides/tools.mdx:183`. Cloudflare/Vercel distinguish `output-denied` from `output-error` — `human-in-the-loop.md:336`.
- **Handles/ids in results.** MCP 2026-07-28 shows tools returning an opaque id in `structuredContent` that "the model is responsible for carrying … forward", with authorization checked on every call and expiry errors that say so. — [MCP 2026-07-28 Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md)
- **Leaking internals.** RFC 9457: problem details "are not a debugging tool for the underlying implementation"; avoid "implementation details such as a stack dump". — [RFC 9457 §4, §5](https://www.rfc-editor.org/rfc/rfc9457.txt). OpenAI SDK redacts by default because errors "can carry secrets" ([notes/tools.md §3](../../../research/agent-sdk/notes/tools.md)); LangChain advises omitting raw messages (`toolError.d.ts`).
- **How it enters the log.** Pi `details` (log/UI) vs `content` (model); Copilot `sessionLog`/`toolTelemetry` vs `textResultForLlm`; OpenAI `customData` "not sent back to the model"; the repo's planned architecture has an append-only, tree-shaped session event log — [CLAUDE.md/AGENTS.md "Planned architecture"](../../../../AGENTS.md); [agent-sdk.md §4, §11](../../../guides/agent-sdk.md). Anthropic requires a `tool_result` for every `tool_use` id ([Handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md)), so the rolled-back call's result is itself a log event, not a deletion.

### Inferences (proposed design; synthesis, not from any one source)
- Outcome kinds and retry semantics:
  - `not_applied` (rejected before any effect: validation, policy, precondition, concurrent conflict): safe to retry after fixing the cause; the model may retry with the same idempotency key. Maps to Stripe's "not saved, you can retry" and AIP `INVALID_ARGUMENT`/`FAILED_PRECONDITION`.
  - `compensated` (applied, then undone by a compensating action): the world matches the pre-call state, but side effects may have been observable (e.g. an email sent, a refund reversed shows on a statement). Retry only with a *new* operation and only if the user still wants it; the result must list anything not reversible.
  - `partial` (some steps applied, compensation failed or not attempted): state the applied and unapplied parts explicitly; retry only via an idempotent resume (Stripe v2 style) or escalate to a human. Never present as success.
  - `unknown` (timeout or lost response): do not retry blindly; reconcile by a status lookup on the operation id, or retry with the *same* idempotency key if the backend guarantees idempotency (AWS, IETF draft). Copilot's `timeout` and OpenAI's `error_as_result` are the closest SDK analogues.
- Suggested result shape (model channel text + structured JSON; set `isError: true` for all four kinds):
  ```json
  {
    "outcome": "compensated",            // not_applied | compensated | partial | unknown
    "operation": "refund_create",
    "operation_id": "op_7Q2…",          // opaque, authorised per call (MCP handle guidance)
    "idempotency_key": "…",              // echoed, as AWS echoes ClientToken
    "applied": [], "reverted": ["refund"], "not_reversible": ["customer email sent"],
    "current_state": "Order 4417: no refund; status unchanged",
    "retry": "new_operation_only",       // safe_same_key | new_operation_only | not_safe | after_reconcile
    "next_action": "Tell the requester the refund did not go through; do not say it was issued.",
    "reason": "payment_provider_declined" // stable snake_case, AIP-193 style; no stack trace
  }
  ```
  RFC 9457 field names (`type`, `title`, `detail`, `instance`) can be reused with these as extension members.
- Log channel (not model-visible): raw exception, provider error codes, compensation step trace, timings, the original arguments, and the link to the original `tool_use` id, written as an append-only event; the model sees only the composed message.
- One message per kind should also state what not to do (do not fabricate success, do not retry with a fresh key on `unknown`), following [docs/guides/agent.md §3](../../../guides/agent.md).

### Gaps
- No published study measures how models react to "rolled back" vs "failed" wording; behaviour must be tested in the eval suite.
- I did not find agent-specific published patterns for saga/compensation results; the AWS, Stripe and IETF sources are HTTP-API guidance applied by analogy.

## 5. Published structured-error patterns (RFC 9457 and others) and their fit for tool results

### Takeaway
RFC 9457 Problem Details is a good template for the structured channel (stable `type`, human `title`/`detail`, `instance`, extension members) and its security guidance carries over directly; but its `status` is HTTP-specific and models read text, so the model-visible content still needs a composed sentence. Google's `ErrorInfo` (reason/domain/metadata) is the closest analogue for stable machine-readable reasons.

### Cited Findings
- RFC 9457 (July 2023, Standards Track) obsoletes RFC 7807. — [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.txt)
- Members: `type` (URI reference identifying the problem type), `status` ("only advisory"), `title` (short summary, "advisory"), `detail` ("ought to focus on helping the client correct the problem, rather than giving debugging information"), `instance` (URI for this occurrence). — [RFC 9457 §3.1](https://www.rfc-editor.org/rfc/rfc9457.txt)
- "Consumers SHOULD NOT parse the "detail" member for information; extensions are more suitable and less error-prone". — [RFC 9457 §3.1.4](https://www.rfc-editor.org/rfc/rfc9457.txt)
- Extension members: problem types "MAY extend" the object; clients "MUST ignore any such extensions that they don't recognize". — [RFC 9457 §3.2](https://www.rfc-editor.org/rfc/rfc9457.txt)
- "Problem details are not a debugging tool for the underlying implementation"; risks include "exposing implementation internals through error messages". — [RFC 9457 §4](https://www.rfc-editor.org/rfc/rfc9457.txt)
- The IETF Idempotency-Key draft uses RFC 9457 bodies for its error cases (e.g. "Idempotency-Key is missing"). — [draft-08 §2.7](https://www.ietf.org/archive/id/draft-ietf-httpapi-idempotency-key-header-08.txt)
- Google AIP-193 `ErrorInfo`: `reason` + `domain` as stable identity, `metadata` for dynamic values; `PreconditionFailure` detail type exists for precondition violations. — [AIP-193](https://raw.githubusercontent.com/aip-dev/google.aip.dev/master/aip/general/0193.md)
- MCP's `structuredContent` "can be any JSON value … that conforms to the tool's outputSchema if one is defined" — [schema.ts 2026-07-28](https://raw.githubusercontent.com/modelcontextprotocol/modelcontextprotocol/main/schema/2026-07-28/schema.ts). Caveat: in the Claude Agent SDK's TS `tool()`, when `structuredContent` is set, "the text blocks in `content` don't reach Claude" ([notes/tools.md §7](../../../research/agent-sdk/notes/tools.md), citing mirrored `custom-tools.md:648-650`), and OpenAI Agents SDK disables the default `errorFunction` when `outputSchema` is set (`tools.mdx:181, 390`). So the structured error must be the model-readable payload in those cases, or the error path must not declare an output schema.

### Inferences
- Fit: use RFC 9457 shape (with `type` as a stable URN/URI such as `urn:agent-speak:tool-error:compensated`, and extensions `outcome`, `operation_id`, `retry`, `next_action`) for the structured/log channel and for MCP `structuredContent`; render `title` + `detail` + `next_action` as the model-visible text. Drop or omit `status` unless the tool is a thin HTTP proxy. `instance` maps naturally to the operation id.
- RFC 9457's "do not parse `detail`" rule supports putting `retry` and `outcome` in typed fields so the harness (not just the model) can act on them, e.g. block a retry with a fresh key after `unknown`.

### Gaps
- No agent SDK or model vendor documents RFC 9457 as a recommended tool-result format; this fit is our inference.
- I did not check whether OpenAI's or Gemini's models behave differently with JSON vs prose error payloads; no published data found.
