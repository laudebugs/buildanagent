# S6a findings: Cloudflare Agents (agents@0.33.0, @cloudflare/think@0.23.0, @cloudflare/ai-chat@0.12.2)

Checked 2026-11-18 with ai@7.0.162, workerd 1.20261103.1 (miniflare 5.20261103.0-beta), @cloudflare/workers-types 5.20261103.1 and TypeScript 7.0.2. Paths below are relative to the repo root. `source/` means `docs/reference/cloudflare-agents/source/`. `extracted/` means `verify/cloudflare-agents/extracted/` (regenerate with `pnpm run extract`).

I decided docs vs SDK vs harness for each item. I fixed the harness problems I found, and they are not listed here (see the "Gotchas" section of `verify/cloudflare-agents/README.md`).

## SDK behavior (surprises and bugs)

**F1. Think's `runTurn({ input, body })` silently drops `body` (SDK bug or doc gap).** `RunTurnWait` declares `body?: Record<string, unknown>` (`node_modules/@cloudflare/think/dist/index-DDnny6kt.d.ts:655-660`). But `_runTurnWait` passes `options.body` only on the `continuation: true` path (`think.js:4982`). The input path calls `_runProgrammaticMessagesTurn(id, messages, { signal, channel, captureOutput })` with no body (`think.js:4999-5020`), so `beforeTurn`'s `ctx.body` is `undefined`. The docs' structured-output pattern gates on `ctx.body?.mode`, "a body flag set by the caller" (`source/agents/docs/think/lifecycle-hooks.md:357-376`). That gate never fires for a programmatic turn.
- Verified by `verify/cloudflare-agents/examples/05-think.ts`, which asserts "runTurn({ input, body }) does not pass body to beforeTurn's ctx.body". The example gates on an instance flag instead, and structured output then works (`TurnResult.output` is parsed).

**F2. Materializing `initialState` fires `onStateChanged` (surprising default, undocumented).** On a new agent, the first read of `this.state` (from an RPC method, or the first WebSocket connect) persists `initialState` and calls `onStateChanged(initialState, "server")` once. The docs say only "New agent - `initialState` is used and persisted" (`source/agents/docs/agents/state.md:86-90`). They list `onStateChanged()` as a step of `setState()` (`state.md:134-139`), not of lazy initialization. A notification hook that sends email or webhooks would fire once per new agent for no update. The deprecated `onStateUpdate` behaves the same way.
- Verified by `examples/01-state.ts`: "the first read of initialState fires onStateChanged once", and the legacy hook counts 3 calls for 2 `setState`s.

**F3. Durable Object RPC stubs for AIChatAgent and Think subclasses type as `never` (types issue).** `getAgentByName(env.X, name)` with `env.X: DurableObjectNamespace<MyChatAgent>` gives `error TS2589: Type instantiation is excessively deep and possibly infinite` (first run of `tsc -p verify/cloudflare-agents/tsconfig.json`: `examples/04-chat-agent.ts(57,9)`), after which every stub method is `never`. Plain `Agent` subclasses type fine (`01-state.ts`, `02-sql.ts`, `03-scheduling.ts`, `07-mcp.ts`, `08-hibernation.ts`). The docs call chat-agent methods through stubs without a cast. The harness types these stubs by hand (`rpc<T>()` in `examples/lib/check.ts`). Re-check this with TypeScript 5.x before calling it an SDK finding: we only tested 7.0.2.

**F4. `sendIdentityOnConnect` defaults to true and logs on every new connection (surprising default, documented).** Each first WebSocket connect logs `[Agent] <Class>: sending instance name "<name>" to clients via sendIdentityOnConnect … If this name is sensitive, add static options = { sendIdentityOnConnect: false }` (seen in the `01-state`, `06-tool-approval` and `09-triage-agent` output). The default is documented (`source/agents/docs/agents/routing.md:872`), but instance names (often user ids) go to clients unless you opt out.

**F5. Think adds workspace tools with write, edit and delete to every turn (surprising default, documented).** With `getTools()` returning two tools, the model was offered `delete, edit, find, grep, lookupTicket, ls, purgeTicket, read, write` (`examples/05-think.ts` output, "tools offered on turn 1"). The docs say "Think adds Computer's AI SDK tools to every turn with no configuration" (`source/agents/docs/think/tools.md:3,23`). The tools act on the agent's SQLite-backed virtual `/workspace`, not the host. They are still mutating tools the model gets by default, so a gated agent must remove them or gate them.

## Doc errors: code that does not work as written

**F6. `routeAgentRequest(request, env) || new Response("Not found", …)` without `await` never reaches the 404 (doc error).** This is `source/cloudflare-docs/src/content/docs/agents/agent-class/index.mdx:196`. A Promise is always truthy, so the handler returns the promise. That promise resolves to `null` for any non-agent path, and `null` is not a valid fetch result. The type checker flags it: `Type 'Promise<Response | null>' is not assignable to type 'Promise<Response> | Response'` (`results/typecheck-docs.json`, id `cf__agent-class__index__05`). The repo docs get it right with `(await routeAgentRequest(request, env)) || …` (`source/agents/docs/think/index.md:57-60`).
- Verified at runtime by `examples/01-state.ts` (`testRouting`): "the doc's un-awaited || fallback returns null, not a 404".

**F7. `AgentWorkflow`, `AgentWorkflowEvent` and `AgentWorkflowStep` imported from `"agents"` (doc error).** They are exported only from `agents/workflows` in 0.33.0 and on main. See `source/agents/docs/agents/human-in-the-loop.md:56` and `source/agents/packages/agents/README.md:409`. The probe import check lists them under `notExported` in `results/factcheck-api.json`. TS2305 cascades into `waitForApproval` and `reportProgress` "not existing" on the workflow class (cause `workflow-cascade` in `results/mismatch-causes.json`).

**F8. cloudflare-docs imports subpaths no release exports (doc error, behind the SDK).** `agents/experimental/memory/session` appears at `conversation-state-and-memory.mdx:33,79,165`, `agents/experimental/memory/utils/compaction-helpers` at `:341`, and `agents/experimental/memory/utils` at `:370`, all under `source/cloudflare-docs/src/content/docs/agents/concepts/`. None of these subpaths is in agents@0.33.0's exports map or on main@1a450e7 (`missingSubpaths` in `results/factcheck-api.json`; `ahead-of-release.mjs` found none of them on main).

**F9. cloudflare-docs uses Think APIs that exist in no release and not on main (doc error).** `defineScheduledTasks` from `@cloudflare/think` appears at `harnesses/think/scheduled-tasks.mdx:17`, and `defineMessengers` from `@cloudflare/think/messengers` at `harnesses/think/messengers.mdx:29`. tsc suggests `ThinkScheduledTasks` instead. The repo docs at the tag describe a different scheduled-task API (`source/agents/docs/think/index.md` "Scheduled Tasks").

**F10. `Workspace` imported from `@cloudflare/think` (doc error).** `source/agents/docs/think/multi-chat.md:76` imports it there, but it is exported by `@cloudflare/computer` (`think/tools.md:23` says so), and the 0.23.0 entry does not re-export it. The same page also calls an undeclared `this._refreshState()`.

**F11. The AIChatAgent guardrail middleware is written against AI SDK v3 provider types (doc error, stale).** `source/cloudflare-docs/src/content/docs/agents/agent-class/communication-channels/chat/chat-agents.mdx:1523` types the middleware as `LanguageModelV3Middleware` and destructures `text` from `doGenerate()`. agents peers on `ai` ^6 || ^7. With ai 7 the type is `LanguageModelMiddleware` (V4, `specificationVersion` required), and generate results carry `content`, not `text` (TS2741, TS2339, TS2322; cause `ai-sdk-v3-provider-types`).

**F12. `formatAgentToolInput` override does not type-check (doc error, minor).** It returns `{ role: "user", … }` from a method, and class methods get no contextual type from the base class, so `role` widens to `string` and is not assignable to `UIMessage` (TS2416). It appears three times: `source/agents/docs/agents/agent-tools.md:83`, `source/agents/packages/ai-chat/README.md` (block `repo__pkg-ai-chat__08`), and `cloudflare-docs …/agent-class/agent-tools.mdx` (`cf__agent-class__agent-tools__02`). Fix: annotate the return type as `UIMessage` or use `"user" as const`.

**F13. Client snippets read untyped state (doc error, minor).** `useAgent({ agent, name })` and `new AgentClient({ … })` without a state type parameter give `state: {}`, so `agent.state?.players` fails to type-check (`state.md:271`, `state.md` block 14, `getting-started.md` block 4, `client-sdk.md` block 1, `webhooks.md` block 8, `think/multi-chat.md` block 3; 11 errors in 7 files, cause `untyped-client-or-row-state`). Separately, the vanilla JS `AgentClient` example in `source/agents/packages/agents/README.md:387` omits `host`, which `AgentClientOptions` requires (`Property 'host' is missing … Omit<PartySocketOptions, "party" | "room">`).

**F14. cloudflare-docs links an example that no longer exists (broken link).** `harnesses/think/tools.mdx:401` and `harnesses/think/index.mdx:390` link `github.com/cloudflare/agents/tree/main/examples/assistant`. It is absent at agents@0.33.0 and on main (`fetch-docs.mjs` reports "1 linked but missing at the tag: assistant"). The repo docs link a pinned "last version" commit instead (`source/agents/docs/think/multi-chat.md:23,576`).

## Docs that run ahead of the release

**F15. Two cloudflare-docs pages use names that exist only on main (ahead of release).** `results/typecheck-docs.json` marks them `ahead-of-release`, with main@1a450e7 and npm latest equal to the pins (`results/latest-releases.json`):
- `isUnauthorized` and `isTransportNotImplemented` from `agents`, at `model-context-protocol/apis/client-api.mdx:1241`.
- `this.x402Client`, at `tools/payments/x402/pay-from-agents-sdk.mdx:15`.
- The repo's own docs differ between the tag and main on 19 `docs/agents` pages and 5 `docs/think` pages (`diff -rq` against a main checkout). The npm package ships `docs/` identical to the agents@0.33.0 tag mirror, so the tag mirror is the right baseline.

## Deprecations the docs still teach

**F16. `needsApproval` on `tool()` is deprecated in ai 7, but AIChatAgent docs use it (still works).** This appears in `source/agents/docs/agents/human-in-the-loop.md:187-245` and `chat-agents.md:1100`. The ai 7 declaration is `@deprecated` in favor of call-level `toolApproval` (our Vercel guide, `docs/reference/vercel-ai-sdk/guide.md:107`).
- Verified working by `examples/06-tool-approval.ts` (approve leads to `output-available`, one execution and an auto-continued answer; deny leads to `output-denied` and no execution) and `examples/09-triage-agent.ts`.

**F17. `McpAgent` is deprecated in favor of stateless `createMcpHandler` with MCP SDK v2 (documented; old servers still work).** The deprecation is in `source/agents/docs/agents/mcp-servers.md:277-293` and marked on cloudflare-docs `model-context-protocol/apis/agent-api.mdx:3,17`. Ten `McpAgent` doc blocks still initialize through `serve("/mcp")` in the probe (`results/run-docs.json`, `mcpInitialized: true`). `examples/07-mcp.ts` verifies the new path: `createMcpHandler` serves `/mcp`, and an Agent's `addMcpServer("…", "http://localhost/mcp")` connects, lists tools, gets namespaced AI SDK tools and calls a tool.

**F18. `workers-ai-provider@4.0.1` is deprecated on npm, yet Think depends on it and docs import it.** The npm deprecation message reads "Deprecated. Use createAI from agents/models/ai-sdk…". @cloudflare/think@0.23.0 lists `workers-ai-provider ^4.0.0` as a dependency, `think/getting-started.md:32` says "Think bundles workers-ai-provider", and 16 import sites in the mirror use `createWorkersAI`.

## Verified claims (no finding)

- `this.sql` binds interpolated values as parameters (a `DROP TABLE` string round-trips as data), returns typed rows, and shares the database with `ctx.storage.sql` and the SDK's `cf_agents_*` tables (`examples/02-sql.ts`; `agent-class.md:169-190`).
- `schedule(seconds | Date | cron)` gives the types `delayed`, `scheduled` and `cron`. The callback runs with its payload through a Durable Object alarm in workerd, and a one-shot row is removed after it runs. `scheduleEvery` is idempotent on (callback, interval, payload). `cancelSchedule` returns true, or false for an unknown id (`examples/03-scheduling.ts`; `scheduling.md:138-260, 419-520, 904-1000`).
- AIChatAgent `saveMessages()` runs a full turn with server tools and persists user, tool and assistant parts in SQLite (`examples/04-chat-agent.ts`).
- After eviction with hibernated WebSockets, a new instance runs `onStart` again and in-memory fields reset. `this.state` and SQL rows reload, the WebSocket stays open, `connection.state` survives, and `onMessage` runs on the new instance (`examples/08-hibernation.ts`).
- Think: `getSystemPrompt()` reaches the model; `beforeToolCall` returning `{ action: "block", reason }` skips `execute` and the model sees the reason; `beforeTurn`'s `output` and `activeTools: []` produce JSON mode with no tools and a parsed `TurnResult.output` (`examples/05-think.ts`).
- The member diff finds no SDK member the docs call on Agent, AIChatAgent or Think that the `.d.ts` lacks. The 31 other misses are helpers the blocks call but never define (`results/factcheck-api.json` → `members.helpersNotShown`).

## Tier counts

- **Sources:** 1,927 TypeScript blocks from 188 pages (620 import the SDK, 380 look complete), plus 34 files from 19 linked examples.
- **Type-check, docs blocks:** 331 pass, 1,227 fragment, 294 syntax, 17 other, 56 api-mismatch, 2 ahead-of-release.
- **Type-check, example files:** 23 pass, 11 fragment (packages outside the pin set, such as hono, chat and web-push).
- **API mismatches by cause** (`results/mismatch-causes.json`):

  | Cause | Errors |
  |---|---|
  | helper-not-shown | 12 |
  | untyped-client-or-row-state | 11 |
  | call-shape | 11 |
  | wrong-import-path | 11 |
  | override-signature-mismatch | 9 |
  | unknown-payload | 8 |
  | service-worker-globals | 6 |
  | workflow-cascade | 4 |
  | migration-before-code (expected: the "before" code on migration pages) | 4 |
  | ai-sdk-v3-provider-types | 3 |
  | typed-array-generics | 2 |
  | workers-types-request-generic | 2 |
  | api-not-in-any-release | 2 |
  | route-handler-returns-null | 1 |
  | other | 1 |

- **Runs in workerd** (204 doc blocks and 19 examples):

  | Outcome | Doc blocks | Examples |
  |---|---|---|
  | ran (mock model called) | 14 | 3 |
  | ran-no-model | 157 | 9 |
  | loaded | 2 | 0 |
  | needs-network (MCP servers on the internet, refused by the harness) | 3 | 0 |
  | needs-binding (Browser Rendering, R2, a secret var) | 0 | 3 |
  | skipped | 28 | 4 |
  | error | 0 | 0 |

- **Behavioral examples:** 9 of 9 pass offline.

## Gaps (not verified)

- **Workflows** (`AgentWorkflow`, `runWorkflow`, `waitForApproval`): the harness configures no Workflows binding, so 2 doc blocks are skipped and no example covers "workflows with human pause and resume" from the S6 plan. Miniflare has a `workflows` option, so this is feasible as follow-up work.
- **Not run offline:** containers (`harness/container`), Browser Rendering, voice, x402 payments, email, the chat-platform messengers, and OAuth MCP flows.
- **Shallow doc runs:** the probe runs each Agent's `onRequest` with a bare GET, one chat message and an MCP initialize. It does not call a block's custom RPC methods, so `ran-no-model` means the block started and served those requests without a 5xx, not that every method in it works.
- **Language policy:** TypeScript is the primary language. There is no Python Agents SDK to compare. The repo's `openai-sdk/` folder holds examples of the OpenAI Agents SDK running on Agents (not inspected).
