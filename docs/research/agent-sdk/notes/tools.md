# Tools: definition, validation, execution and results

Research note for our TypeScript agent SDK. Question: how should an SDK define, validate, execute and return tools? Evidence comes from the installed packages, as of
November 2026: `ai@7.0.162` and `@ai-sdk/provider-utils` / `@ai-sdk/mcp` (Vercel), `@earendil-works/pi-*@1.5.2` (Pi), `@openai/agents-core@0.21.0` (OpenAI),
`@anthropic-ai/claude-agent-sdk@0.3.327` (Claude), `@standard-schema/spec@1.1.0` and `@modelcontextprotocol/sdk@1.32.2`. Paths are relative to
`verify/<sdk>/node_modules/` unless stated; `node_modules/.pnpm/...` means the repo-root pnpm store. Web pages on modelcontextprotocol.io, standardschema.dev and
platform.openai.com were unreachable from this environment, so MCP and Standard Schema claims cite the published packages instead.

The short answer: accept any Standard Schema with a JSON Schema converter, validate every call in the harness (never trust provider strict mode alone), turn every failure
into a tool result the model can read, run calls in parallel unless a tool opts out, gate per call with a policy function and a signed, resumable approval record, and
keep three outputs apart: what the model sees, what the UI sees and what code sees.

## 1. Schema libraries are converging on Standard Schema plus a JSON Schema converter

**All three in-process SDKs accept Standard Schema, but only if it can also emit JSON Schema.** A tool schema has two jobs: validate the model's input at runtime and
produce the JSON Schema that the provider receives. Standard Schema v1 covers only the first: `~standard` carries `version: 1`, `vendor`, and `validate(value)` returning
`{ value }` or `{ issues: [{ message, path }] }` (`.pnpm/@standard-schema+spec@1.1.0/.../dist/index.d.ts:10-66`). The sibling Standard JSON Schema interface adds
`~standard.jsonSchema.input/output({ target })`, where target is `"draft-2020-12" | "draft-07" | "openapi-3.0"`. Implementers are "strongly recommended" to support the
first two and "should throw" on unsupported targets (same file, lines 78-106).

- **Vercel** `FlexibleSchema` is `Schema | LazySchema | ZodSchema | StandardSchema`, and its `StandardSchema` type requires the optional `jsonSchema` converter
  (`@ai-sdk/provider-utils/dist/index.d.ts:867-872`). `asSchema()` special-cases `vendor === "zod"` and sends every other vendor through `standardSchema()`, which throws
  "does not support JSON Schema conversion" when the converter is missing (`provider-utils/dist/index.js:3224-3251`). `jsonSchema(schema, { validate? })` wraps raw JSON
  Schema with an optional validator (`index.js:3210-3220`).
- **OpenAI** accepts Zod, Standard Schema with JSON conversion, or raw JSON Schema. It rejects a Standard Schema that lacks `jsonSchema` with "must provide both
  `~standard.validate` and `~standard.jsonSchema`" (`@openai/agents-core/dist/utils/tools.mjs:107-121`; `utils/standardSchema.mjs:40-42`), and it requires `strict` for
  both Zod and Standard Schema (`tool.mjs:694-700`).
- **Pi** takes any JSON Schema object (TypeBox, pi-schema builders or plain objects) and validates it with its own eval-free validator, `@earendil-works/pi-schema`
  ("drafts 2020-12 and 7, compiled into plain closures", `pi-schema/package.json:4`; `pi-agent-core/dist/types.d.ts:414-417`). `ToolDefinition.parameters` is still typed
  as TypeBox `TSchema` (`pi-coding-agent/dist/core/extensions/types.d.ts:484-485`).
- **Claude** takes only a Zod raw shape (Zod 3 or 4), because tools are registered on an in-process MCP server (`claude-agent-sdk/sdk.d.ts:133, 5829-5836, 10617-10621`).
  A tool whose schema cannot be converted is dropped from the list with a `CLAUDE_SDK_MCP_TOOL_SCHEMA_UNCONVERTIBLE` warning instead of failing the server
  (`sdk.d.ts:662-666`; `sdk.mjs`, function `gWe`).

**Implication:** the neutral interface is "Standard Schema plus Standard JSON Schema", with raw JSON Schema as the escape hatch. Validator-less raw JSON Schema needs a
built-in validator, as Pi supplies, or it goes unvalidated (section 3).

## 2. JSON Schema dialect and strict mode are provider constraints, not schema choices

**Each SDK picks a dialect.** Vercel emits draft-07 everywhere: Zod 4 through `toJSONSchema(..., { target: "draft-7", io: "input" })`, Zod 3 with `$schema: draft-07`, and
Standard Schema with `target: "draft-07"` (`provider-utils/dist/index.js:3180, 3234, 3267-3270`). OpenAI asks Standard Schema for `draft-2020-12`
(`agents-core/dist/utils/standardSchema.mjs:49-51`), yet tags its Zod fallback draft-07 (`utils/zodJsonSchemaCompat.mjs:3`). MCP's `outputSchema` "defaults to JSON Schema
2020-12 when no explicit $schema is provided", and both input and output schemas must have `type: "object"` at the root
(`.pnpm/@modelcontextprotocol+sdk@1.32.2.../dist/esm/spec.types.d.ts:1176-1207`). An SDK that bridges MCP to providers therefore converts between 2020-12 and draft-07.
The differences that matter in practice are `$defs` vs `definitions` and tuple `items`.

**Vercel closes every object.** `addAdditionalPropertiesToJsonSchema` forces `additionalProperties: false` on every object node unless a schema is given
(`provider-utils/dist/index.js:2228-2242`). The MCP adapter does the same to server schemas (`@ai-sdk/mcp/dist/index.js:2939-2948`). Vercel's `strict` flag is only passed
through to the provider, and it is off by default (`provider-utils/dist/index.d.ts:2326-2332`; mirrored `03-ai-sdk-core/15-tools-and-tool-calling.mdx:106-128`).

**OpenAI defaults to strict and rewrites schemas to fit.** `strict` defaults to `true` (`tool.mjs:694`). `prepareOpenAIStrictToolSchema` makes every property required,
wraps originally optional ones as nullable ("synthetic nullable"), and its `normalizeInput` strips those nulls before validation (`utils/strictToolSchema.mjs:76-144,
243-280, 686-696`). It refuses schemas strict mode cannot express, naming the problem: typeless open schemas, external `$ref`, `$ref` with siblings, `anyOf` with
siblings, optional properties inside `anyOf` branches, open objects, and nesting deeper than 100 levels (`strictToolSchema.mjs:3-11, 121, 385-532`). MCP schemas are tried
in strict mode and fall back to non-strict with a warning (`mcp.mjs:774-828`).

**Implication:** keep the user's schema canonical (2020-12 or draft-07 from the library), and have each provider adapter lower it: close objects, convert optional to
nullable, and map dialect keywords. Strip the added nulls before validation, as OpenAI does, so user code never sees them.

## 3. Validation belongs in the harness, before hooks and approval, and its failures go to the model

**Where validation happens:**

| SDK | Step | Coercion | Unknown tool |
|---|---|---|---|
| Vercel | `doParseToolCall`: JSON parse plus `inputSchema.validate`, then `refineToolInput` (`ai/dist/index.js:3846-3946`) | none (Zod transforms apply) | `NoSuchToolError` listing available tools (`index.js:322-327`) |
| Pi | `prepareToolCall`: `prepareArguments` shim, then `validateToolArguments`, then `beforeToolCall` (`pi-agent-core/dist/agent-loop.js:473-547`) | yes: `compile(schema, { coerce: true })` turns `"42"` into a number, a scalar into an array and `null` into an omitted optional (`pi-ai/dist/utils/validation.js:12, 41-48`) | error result `Tool X not found` (`agent-loop.js:487-494`) |
| OpenAI | `_invoke` parses with the schema's parser before `execute` (`agents-core/dist/tool.mjs:744-768`) | strict-null stripping only | `ModelBehaviorError` by default; `toolNotFoundBehavior: 'return_error_to_model'` returns `Tool 'x' not found.` (`run.d.ts:57, 146`; `runner/turnResolution.mjs:21`; `runner/modelOutputs.mjs:131-140, 575-578`) |
| Claude | MCP SDK `validateToolInput` inside the in-process server (`sdk.mjs`, `validateToolInput`) | none | MCP protocol error `Tool X not found` (`sdk.mjs`) |

**Raw JSON Schema is sometimes not validated at all.** Vercel's `safeValidateTypes` returns success when the schema has no `validate`
(`provider-utils/dist/index.js:3324-3330`), and the MCP adapter builds `jsonSchema(...)` without one (`@ai-sdk/mcp/dist/index.js:2939-2948`). Dynamic MCP tools therefore
reach `execute` unchecked on the client, so the MCP server must validate. OpenAI's raw JSON Schema parser only runs `JSON.parse` plus strict-null normalization
(`utils/tools.mjs:122-132`), so it relies on the provider's constrained decoding. Pi alone validates every JSON Schema it is given, caching one compiled validator per
schema object (`validation.js:1-15`).

**What the model sees differs most.** Pi gives the model the most: one line per error path in dotted form plus the received arguments (`Validation failed for tool
"edit":\n  - edits.0.oldText: ...\n\nReceived arguments: {...}`, `validation.js:16-60`). Vercel sends `Invalid input for tool X: <cause>` as a `tool-error` result for
invalid calls in the next step (`ai/dist/index.js:84-86, 5711-5719`). OpenAI hides the detail by default: the default `errorFunction` returns "An error occurred while
running the tool. Please try again." and parse failures become "An error occurred while parsing tool arguments. Please try again with valid JSON." (`tool.mjs:512-520`;
`runner/toolExecution.mjs:503-540`). The mirrored docs say strict mode "returns a model error if the arguments don't validate"
(`openai-agents-sdk/source/.../guides/tools.mdx:177`); the code returns that generic text unless you set `errorFunction`. The redaction is deliberate, since tool errors
can carry secrets (`tool.mjs:833-845`, redaction flags). For the model, though, it throws away the signal it needs to self-correct. Anthropic's tool guide asks for errors
that "clearly communicate specific and actionable improvements" with correctly formatted examples ([Writing tools for
agents](https://www.anthropic.com/engineering/writing-tools-for-agents)). The MCP spec says tool errors "SHOULD be reported inside the result object, with `isError` set
to true … Otherwise, the LLM would not be able to see that an error occurred and self-correct" (`spec.types.d.ts:1046-1060`).

## 4. Repair is a cheap hook before the error turn, not a replacement for it

- **Vercel `repairToolCall`** runs only for `NoSuchToolError` or `InvalidToolInputError`. It receives the raw call, the tools, an `inputSchema(toolName)` accessor, the
  messages and the error, and returns a fixed call or `null`. The fixed call is parsed again; a throwing repair becomes `ToolCallRepairError`
  (`ai/dist/index.js:3749-3822`). If the repair returns nothing, the call becomes `invalid: true`, `dynamic: true` and is answered with a `tool-error`
  (`index.js:3803-3822, 5711-5719`). The docs list three strategies: regenerate the input with a structured-output model, send it to a stronger model, or give
  tool-specific instructions (mirrored `15-tools-and-tool-calling.mdx:1265-1280`).
- **Vercel `experimental_refineToolInput`** is a per-tool transform applied after validation and before execution, approval, callbacks and telemetry
  (`index.js:3846-3855`; `ai/dist/index.d.ts:4054`). On resumed approvals the SDK revalidates the input and rejects it if refining changes it ("Approved tool input does
  not match the validated schema output", `index.js:5008-5025`).
- **Pi `prepareArguments`** is a per-tool shim on the raw arguments before validation, meant for compatibility with old argument shapes
  (`pi-agent-core/dist/types.d.ts:420-425`; `agent-loop.js:474-486`). Schema coercion handles the common model slips for free (section 3).
- **OpenAI** has no repair hook. `errorFunction` shapes only the failure text, and an async Standard Schema validation error is fatal (`tool.mjs:768, 806`).

**Implication:** order the steps as coerce, then validate, then an optional repair hook, then an actionable error result. Most failures should cost one extra model turn
with a precise message, not a second model call.

## 5. Parallel execution is the default; serialization is per tool or per resource

- **Vercel** runs all calls in a step concurrently (`Promise.all`) unless `toolCallConcurrency` is set. That limit is one number for the whole call, with no per-tool flag
  (`ai/dist/index.js:5069-5110, 5938-5958`; `index.d.ts:4000-4005`). Results keep input order. MCP `readOnlyHint` and the other annotations are copied into `metadata`,
  which is not sent to the model and does not affect scheduling (`@ai-sdk/mcp/dist/index.js:2911-2925`; `provider-utils/dist/index.d.ts:2230-2240`).
- **Pi** defaults to `toolExecution: "parallel"` (`pi-agent-core/dist/agent.js:147`). If any call in the batch is for a tool with `executionMode: "sequential"`, the whole
  batch runs sequentially (`agent-loop.js:372-378`; `types.d.ts:437-445`). In parallel mode, preparation (validation and the `beforeToolCall` gate) runs one call at a
  time in model order, and only `execute` runs concurrently. Results are emitted in model order (`agent-loop.js:416-469`). Built-in `edit` and `write` instead serialize
  per file through `withFileMutationQueue`, so "operations for different files still run in parallel" (`pi-coding-agent/dist/core/tools/file-mutation-queue.d.ts:1-5`;
  `tools/edit.js:93`).
- **OpenAI** starts every function call in the turn unless `maxFunctionToolConcurrency` is set (`runner/runConfig.d.ts:2-14`; `runner/toolExecution.mjs:332-367`). A fatal
  failure cancels the sibling calls through a shared abort signal (`runner/siblingCancellation.mjs:2-40`).
- **Claude** schedules by annotation: `readOnlyHint: true` "controls whether the tool can be called in parallel with other read-only tools" (mirrored
  `claude-agent-sdk/source/custom-tools.md:23, 335`). The CLI's scheduler is a compiled binary, so this is docs-only, not read in code.

The MCP spec calls annotations "hints" and says "Clients should never make tool use decisions based on ToolAnnotations received from untrusted servers"
(`spec.types.d.ts:1098-1108`). Pi repeats the warning ("not verified", `extensions/types.d.ts:416-429`).

**Implication:** run calls in parallel by default. Serialize through an explicit per-tool `executionMode` or a resource key (a path or a lock name) set by the tool
author, and run gates sequentially in model order. Trust `readOnlyHint` for scheduling only on first-party tools; for third-party MCP tools, use it only to relax a gate.

## 6. Approval should be a per-call policy that produces a durable, signed record

- **Vercel 7** moved approval from the tool to the call: `toolApproval` is either one function for every call or a map from tool name to a status or a per-tool function.
  Statuses are `not-applicable | approved | denied | user-approval`, each optionally with a reason. The call-level policy overrides the deprecated tool-level
  `needsApproval` (`ai/dist/index.d.ts:3472-3541`; `index.js:3949-3994`; deprecation at `provider-utils/dist/index.d.ts:2260-2265`). `user-approval` emits a
  `tool-approval-request` and ends the step. Automatic decisions are recorded as request/response pairs with `isAutomatic: true` (`index.js:5645-5706`). With
  `experimental_toolApprovalSecret`, each request is HMAC-SHA256 signed over `["ai-sdk-tool-approval-v1", approvalId, toolCallId, toolName, sha256(canonical input)]`,
  then verified, schema-revalidated and re-run through the policy before execution (`index.js:4918-4951, 4972-5050`).
- **OpenAI** `needsApproval: boolean | (runContext, input, callId) => Promise<boolean>` interrupts the run with a `RunToolApprovalItem`. `approveTool` and `rejectTool`
  take `alwaysApprove`/`alwaysReject` to remember the decision for later calls, and `rejectTool` takes a `message` for the model (`agents-core/dist/tool.d.ts:39, 765`;
  `runContext.d.ts:64-75`). Tool input guardrails return `allow`, `rejectContent(message)` or `throwException` and run before execution. With
  `preApprovalInputGuardrails`, they also run before the approval prompt (`toolGuardrail.d.ts:8-18`; `runner/runConfig.d.ts:9-13`).
- **Pi** has one in-loop gate: the `tool_call` extension event (wired as `beforeToolCall`) can `block` with a `reason` that the model sees as an error result, or set
  `terminate`. To modify arguments, a handler mutates `event.input` in place. The first handler that blocks wins (`pi-coding-agent/dist/core/agent-session.js:377-400`;
  `extensions/runner.js:965-979`; `extensions/types.d.ts:1109-1118`). Calls a tool makes on its own (codemode) go through the same gate with a `parentToolCallId`
  (`agent-session.js:459`; `pi-agent-core/dist/agent-loop.js:567-575`).
- **Claude** layers `allowedTools`, permission rules, `canUseTool` and hooks in the CLI, and a server's `permission_policy: "always_ask"` forces a prompt
  (`docs/reference/claude-agent-sdk/guide.md:120`).

The [deep comparison](../../../comparison/deep-comparison.md) (lines 21, 70) splits these into in-loop gates (Claude, Pi) and pause-and-resume gates (OpenAI, Vercel).
Only Vercel signs the record. An unsigned resumable approval can be forged by the client that returns it (`vercel-ai-sdk/guide.md:125`).

## 7. Tool results need three channels: model content, UI details and structured data

- **Vercel** has a typed model-output union: `text | json | execution-denied | error-text | error-json | content[text|file]` (`provider-utils/dist/index.d.ts:380-470`).
  `execute` returns any value. `toModelOutput({ toolCallId, input, output })` maps it to that union; otherwise strings become `text` and everything else becomes `json`
  through a `JSON.stringify` round trip, and thrown errors become `error-text` (`ai/dist/index.js:1933-1972`). `execute` may also be an async iterable that streams
  `preliminary` results (`index.js:2905-2914`). A thrown error becomes a `tool-error` part, so the loop continues (`index.js:2918-2938`).
- **Pi** `AgentToolResult` has `content: (Text|Image)[]` for the model, `details` for logs and UI, and `structuredContent` for programs. `structuredContent` is "not sent
  to the model". The result also carries `isError`, which reports a failure without throwing while keeping `details`, and `terminate`, which ends the run only when every
  result in the batch sets it (`pi-agent-core/dist/types.d.ts:370-392`; `agent-loop.js:471-473`). `afterToolCall` can replace content or details and drops stale
  `structuredContent` when content changes (`agent-loop.js:604-632`).
- **OpenAI** `execute` returns any value. Structured outputs (`ToolOutputText | ToolOutputImage | ToolOutputFileContent`) pass through as content items, and everything
  else is `toSmartString`-ed into one text item. With `outputSchema`, the output is `JSON.stringify`-ed and, for Zod, validated
  (`agents-core/dist/runner/toolExecution.mjs:86-135`; `tool.mjs:722-741`).
- **MCP / Claude** `CallToolResult` has `content: (text|image|audio|resource_link|resource)[]`, optional `structuredContent` and `isError` (`spec.types.d.ts:1035-1060,
  1602`). In Claude's TypeScript `tool()`, when `structuredContent` is set "the text blocks in `content` don't reach Claude" (mirrored `custom-tools.md:648-650`). The
  in-process server turns a thrown handler error into `{ content: [{ type: "text", text }], isError: true }` and enforces `outputSchema` on `structuredContent`
  (`sdk.mjs`, `createToolError` and `validateToolOutput`).

**MCP `isError` is lost by two adapters.** Vercel's MCP `execute` returns an `isError` result as a normal value (`@ai-sdk/mcp/dist/index.js:2934`), and `mcpToModelOutput`
turns it into `content` rather than `error-text` (`index.js:2315-2344`). OpenAI's MCP wrapper also returns the content and keeps `isError` only for its custom-data
extractor (`agents-core/dist/mcp.mjs:732-760`). Vercel's mapper also serializes audio and resource blocks as JSON text, because it maps only text and images
(`@ai-sdk/mcp/dist/index.js:2326-2341`).

**Truncation is a harness job that most library SDKs skip.** Pi truncates built-in outputs at 2000 lines or 50 KB, whichever comes first: `truncateHead` for reads and
`truncateTail` for bash, never returning partial lines (`pi-coding-agent/dist/core/tools/truncate.d.ts:1-60`; `truncate.js:10-11`). Claude saves results over 25,000
tokens, or text over 50,000 characters, to a file and returns an error naming the path so the agent can read it in parts (`MAX_MCP_OUTPUT_TOKENS`; mirrored
`claude-agent-sdk/source/mcp.md:898-900`). The Vercel and OpenAI result paths shown above pass output through without a size cap. Anthropic recommends "sensible defaults"
for pagination, filtering and truncation, plus a `response_format` concise/detailed switch; concise output used about a third of the tokens in its example ([Writing tools
for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)).

## 8. Names should be namespaced by source and sanitized to the strictest provider

- MCP tool names "SHOULD be between 1 and 128 characters" and match `^[A-Za-z0-9._-]{1,128}$`
  (`.pnpm/@modelcontextprotocol+sdk@1.32.2.../dist/esm/shared/toolNameValidation.js:4-13`).
- Claude exposes MCP tools as `mcp__<server>__<tool>` (`claude-agent-sdk/guide.md:110-114`), and Pi uses the same form
  (`pi-coding-agent/dist/core/mcp-servers.d.ts:16-17`). Pi also has a first-class `ToolNamespace` (`{ name, aliases, description, instructions }`) for grouping tools
  (`extensions/types.d.ts:431-446`).
- OpenAI replaces every non-alphanumeric character in a function name with `_` (`agents-core/dist/utils/tools.mjs:23-33`). MCP prefixing is opt-in
  (`includeServerInToolNames`) and produces `mcp_<server>__<tool>`, shortened with a hash on collision (`mcp.mjs:405-440, 590-625`). Without it, duplicate names across
  servers throw (`mcp.mjs:430-433`). `toolNamespace()` uses the Responses API's native namespaces (`tool.d.ts:890-905`).
- Vercel uses the `ToolSet` key as the name, and the MCP adapter keeps the server's raw name without a prefix (`@ai-sdk/mcp/dist/index.js:2905-2961`). Collisions across
  MCP clients are left to the user. `toolOrder` keeps definitions stable for prompt caching (`ai/dist/index.d.ts:3256, 3990-3998`).

Anthropic reports that prefix-vs-suffix namespacing had "non-trivial effects" on its evals and recommends `user_id` over `user` ([Writing tools for
agents](https://www.anthropic.com/engineering/writing-tools-for-agents)).

## 9. Deferred loading is now standard, in three forms

1. **Provider-native.** Anthropic's `defer_loading: true` plus a tool-search tool cut tool definitions from about 77K to 8.7K tokens. Opus 4 MCP-eval accuracy rose from
   49% to 74%, and Opus 4.5 from 79.5% to 88.1% ([Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)). OpenAI's `deferLoading` and
   `toolSearchTool()` are Responses-API-only (`agents-core/dist/tool.d.ts:216-219`; mirrored `guides/tools.mdx:62`). A deferred call before loading is recorded as
   `not_loaded` (`runner/modelOutputs.mjs:586-587`).
2. **SDK-emulated, provider-neutral.** Vercel's `toolSearch({ search?, maxResults = 5 })` is an ordinary function tool. It hides `deferLoading` tools from `activeTools`
   until found, ranks them by name and description keywords or a custom `search`, and adds matches "on the next model step" (`ai/dist/index.js:2697-2800`;
   `provider-utils/dist/index.d.ts:2216-2223`). This works on any provider.
3. **Host-level exposure.** Pi's `ToolExposure` is `direct | model-only | codemode | deferred | hidden` (`extensions/types.d.ts:400-415`), and MCP servers default to
   `codemode`, where scripts find tools with `searchTools()` (`mcp-servers.d.ts:18-45`). Claude defers MCP tools by default, with `ENABLE_TOOL_SEARCH` and per-tool or
   per-server `alwaysLoad` (`_meta['anthropic/alwaysLoad']`) plus `searchHint` (`sdk.d.ts:681-687, 10617-10621`; `sdk.mjs` `fWe`; mirrored `tool-search.md:45-57`).

Programmatic tool calling (`allowed_callers`) cut average tokens from 43,588 to 27,297 on complex research tasks, and `input_examples` raised accuracy on complex
parameters from 72% to 90% ([Advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)). Vercel exposes `inputExamples` and caller routing
(`experimental_toolCallers`) (`provider-utils/dist/index.d.ts:2333-2339`; `ai/dist/index.d.ts:3544-3545`). OpenAI exposes `allowedCallers` (`tool.d.ts:224-228`).

## 10. Provider-defined tools need their own type, kept apart from function tools

Vercel models this best. Alongside `function` and `dynamic` tools it has two provider kinds. `ProviderDefinedTool` (`isProviderExecuted: false`) has a provider schema but
runs locally, such as a shell. `ProviderExecutedTool` (`isProviderExecuted: true`) runs server-side, such as web search or code execution. Both carry `id:
"<provider>.<name>"` and `args`, and neither allows `description`, `strict` or `inputExamples` (`provider-utils/dist/index.d.ts:2357-2423`). `supportsDeferredResults`
handles a server tool whose result arrives in a later turn, as with programmatic tool calling (`index.d.ts:2400-2414`; `ai/dist/index.js:2534-2560, 5765-5772`). OpenAI
has an opaque `HostedTool { type: 'hosted_tool', name, providerData }` plus dedicated local types (`computerTool`, `shellTool`, `applyPatchTool`), each with its own
`needsApproval` (`tool.d.ts:352-470, 505-520`). Hosted shell rejects `needsApproval` because the code runs remotely (`tool.mjs:331-335`). Agents-as-tools (`agent.asTool({
customOutputExtractor, ... })`) are a function-tool special case (`agent.d.ts:404-405`; `agent.d.ts:54`).

## 11. MCP adaptation is mostly lossy today

The common gaps: `isError` dropped (section 7), annotations not used for scheduling (Vercel), schemas unvalidated client-side (Vercel dynamic tools), audio and resource
content flattened to JSON text (Vercel), and names not namespaced by default (Vercel, OpenAI). Good practices seen: Vercel paginates `tools/list` with `nextCursor`
(`@ai-sdk/mcp/dist/index.js:2887-2899`), its `schemas` option gives typed MCP tools with `outputSchema`-validated `structuredContent` (`index.js:2950-2985`), and it
carries server identity in `metadata` (`index.js:2911-2925`). OpenAI attaches server-level guardrails and `errorFunction` to every converted tool and tries strict schemas
first (`agents-core/dist/mcp.mjs:678-691, 774-828`). Pi supports per-tool exposure overrides with wildcards and a per-request timeout that progress notifications reset
(`mcp-servers.d.ts:31-45`). The SDK pins here target MCP `2025-11-25` (`.pnpm/@modelcontextprotocol+sdk@1.32.2.../dist/esm/types.js:2-4`). The 2026-07-28 stateless
revision is covered in the main report and was not checked here ([main report](../../agent-sdks-and-harness-design.md), "Tools and context deserve more effort").

## Design implications for our SDK

1. **Schema input:** accept `StandardSchemaV1 & StandardJSONSchemaV1` or raw JSON Schema. Validate raw JSON Schema with a bundled eval-free validator that handles
   draft-07 and 2020-12, as Pi does, so no input reaches `execute` unvalidated (sections 1, 3). Resolve and cache the JSON Schema lazily, as Vercel's `lazySchema` and
   Pi's WeakMap cache do.
2. **Provider lowering:** keep one canonical schema, and let each provider adapter produce the strict form: close objects, turn optional into nullable, strip the added
   nulls before validation, and fail at definition time with a named reason, following OpenAI's `strictToolSchema` (section 2). Default `strict` per provider capability,
   never globally.
3. **Pipeline order:** resolve the name, then coerce, then validate, then an optional `repair` hook, then the policy gate, then `execute`, then `afterToolCall`. A failure
   at any step becomes a model-visible error result (`isError: true`) with Pi-style path-level messages and the received arguments, so we never throw out of the loop
   (sections 3, 4). Offer redaction as an opt-in per tool, not OpenAI's generic default.
4. **Unknown tools:** return an error listing the available or loadable names, like Vercel's `NoSuchToolError` message, and point at tool search when the tool is deferred
   (sections 3, 9).
5. **Concurrency:** parallel by default, with a per-tool `executionMode` and an optional per-call resource key (Pi's per-file queue generalized). Run gates sequentially
   in model order, emit results in model order, and give tools a sibling-cancellation signal (section 5).
6. **Approval:** a call-level policy function plus per-tool defaults, returning `allow | deny(reason) | ask(reason)`, as in Vercel 7. Persist each decision as an event in
   the session log, HMAC-sign pending requests over (id, call id, name, canonical-input hash), and revalidate on resume. Support "always allow this tool or pattern" as in
   OpenAI's `alwaysApprove` (section 6). Approval stays separate from the sandbox policy (AGENTS.md, item 7).
7. **Result type:** `{ content: (text|image|file)[], details?, structured?, isError?, terminate? }`. `content` goes to the model; `details` stays in the UI and log;
   `structured` goes to programmatic callers. Add an optional `toModelOutput` for tools that return domain objects (sections 7, 10).
8. **Truncation:** add a harness-level output budget per tool (lines, bytes or tokens). Over budget, spill the full output to a file or artifact and return a pointer with
   instructions, combining Pi's limits with Claude's spill-to-file (section 7).
9. **Naming:** namespace every external source (`mcp__<server>__<tool>`), sanitize to the intersection of provider rules (`[A-Za-z0-9_-]`, at most 64 characters as a safe
   floor, which still needs checking against each provider), detect collisions at registration, and keep tool order stable for prompt caching (section 8).
10. **Deferred loading:** give every tool an `exposure` (`direct | deferred | hidden`). Use provider-native tool search where it exists, and fall back to an SDK
    `tool_search` function tool like Vercel's (section 9).
11. **Tool kinds:** `function | dynamic | provider-local | provider-executed`, as in Vercel, with deferred results for provider-executed tools (section 10).
12. **MCP adapter:** keep `isError` as `isError`, map every content type (audio and resources included), validate input client-side, keep `structuredContent` and
    `outputSchema`, carry annotations as untrusted metadata (they may relax our gate for first-party servers only), paginate `tools/list`, and expose per-tool exposure
    and timeout overrides (section 11).
13. **Verification:** write one `verify/`-style example per numbered rule above (validation message, repair, parallel ordering, signed-approval tamper, MCP `isError`
    round trip), so each component can be ablated later.

## Unresolved gaps

- The MCP spec (modelcontextprotocol.io), standardschema.dev and OpenAI's strict-mode docs (platform.openai.com) were unreachable. Claims here use the published
  `@modelcontextprotocol/sdk@1.32.2` and `@standard-schema/spec@1.1.0` packages instead, and the 2026-07-28 MCP revision's tool changes are unverified.
- Claude's parallel scheduling, truncation and tool-search behavior live in the compiled CLI. These claims rest on mirrored docs, not code.
- No per-provider name-length and charset table was checked (Anthropic, OpenAI, Gemini, Bedrock); the 64-character floor in item 9 is an assumption.
- How Vercel's provider adapters lower `strict` for Anthropic and Gemini was not read (`@ai-sdk/anthropic` and `@ai-sdk/google` were not inspected).
