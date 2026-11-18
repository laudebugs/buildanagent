# Cloudflare Agents docs: the SDK behaves as described, but its two doc sites drift from the 0.33.0 release

A developer who copies an example from the Cloudflare Agents docs needs it to compile and run against the release npm installed. To test that promise, I checked two doc sources against `agents@0.33.0`, `@cloudflare/think@0.23.0` and `@cloudflare/ai-chat@0.12.2`, the latest npm releases as of November 2026, on `ai@7.0.162`. The first source is the `cloudflare/agents` repo's own docs, READMEs and 19 linked examples at the release tags. The second is `developers.cloudflare.com/agents/`, which renders `cloudflare/cloudflare-docs` from a branch, mirrored at commit `6897a9f` (2026-11-18). Together they hold 188 pages and 1,927 TypeScript blocks. Agents are Durable Objects, so every run happened inside Cloudflare's local runtime, `workerd@1.20261103.1`, through `miniflare@5.20261103.0-beta`. Four automated tiers did the checking: type-checks, offline runs, an API-surface diff and behavioral tests. All of them live in [`verify/cloudflare-agents/`](../../../verify/cloudflare-agents/), with raw output in `verify/cloudflare-agents/results/`. The SDK held up well: 18 of 20 documented behaviors worked as written, no probed doc block failed in workerd, and every SDK member the docs call exists. The docs fared worse. Fifty-eight blocks disagree with the release, several pages use APIs that no release or branch contains, and five behaviors of the SDK and its types surprised us, two of them defaults.

## Reproduce the checks in three commands

```bash
pnpm install              # at the repo root: installs every harness, including workerd
cd verify/cloudflare-agents
pnpm run fetch-docs       # mirror both doc sources (committed; MIT, and CC-BY-4.0 for cloudflare-docs prose)
pnpm run verify           # extract -> type-check -> triage -> run docs examples in workerd -> API diff -> our tests
```

The harness uses a miniflare beta on purpose. The newest stable miniflare before the cutoff, 4.20260730.0, predates the workerd that `agents@0.33.0` needs, and the newest stable wrangler, 4.157.0, itself depends on `miniflare@5.20261103.0-beta` ([harness README](../../../verify/cloudflare-agents/README.md)). The triage step needs network to compare names with the `cloudflare/agents` main branch, and it leaves statuses unchanged when offline.

## Tier 1: 331 of 1,927 blocks compile as written, and 58 disagree with the package

I compiled every TypeScript block against the pinned packages with `tsc` 7 in strict mode, using the package's own `agents/tsconfig` settings (`scripts/typecheck-examples.mjs`). A block that fails only because a name is defined elsewhere on its page, or because it imports a package outside the pinned set, counts as a fragment.

| Source | Blocks | pass | fragment | syntax | other | ahead of release | api-mismatch |
|---|---|---|---|---|---|---|---|
| Repo `docs/agents` (50 pages) | 736 | 76 | 498 | 134 | 5 | 0 | 23 |
| Repo `docs/think` (12 pages) | 186 | 21 | 100 | 62 | 0 | 0 | 3 |
| Repo and package READMEs | 71 | 15 | 39 | 14 | 0 | 0 | 3 |
| cloudflare-docs pages | 934 | 219 | 591 | 83 | 10 | 2 | 29 |
| **Total** | **1,927** | **331** | **1,228** | **293** | **15** | **2** | **58** |

The 19 linked examples add 34 server-side files: 23 pass, and 11 are fragments that import packages outside the pinned set, such as `hono`, `chat` and `web-push`. The syntax blocks are deliberate snippets, such as option excerpts and bare method bodies. The 15 "other" blocks call undefined helpers, need modules outside the pin set such as `postal-mime` and `cloudflare:test`, or trip strict checks such as a missing return.

`scripts/ahead-of-release.mjs` marked two blocks `ahead-of-release`, because their missing names appear somewhere in main's sources. Neither holds on inspection. On main, `isUnauthorized` is still an internal helper, and `this.x402Client` is a field the block never declares, so both are doc errors (F11). Two of the script's api-mismatch blocks are not doc errors either. `scheduling.md:843` is an options excerpt (`new Scheduler({ callbacks?, retry?, … })`) whose `Scheduler` resolves to the DOM global, so its "Expected 0 arguments" is a syntax snippet's side effect. In `run-workflows.mdx:622`, `MyAgent` extends an `Agent` the block never imports, so "Type 'MyAgent' is missing the following properties from type 'Agent'" cascades from that missing import. The table keeps the script's counts, and the 58 in the heading counts the two `ahead-of-release` blocks as mismatches and leaves out these two.

`scripts/mismatch-causes.mjs` groups the 58 api-mismatch blocks by cause (`results/mismatch-causes.json`):

| Cause | Errors | Finding |
|---|---|---|
| helper-not-shown | 12 | Blocks call helpers they never define |
| call-shape | 12 | Arguments of the wrong shape in 8 blocks, including the `AgentClient` options (F11), plus the `Scheduler` options excerpt |
| untyped-client-or-row-state | 11 | F11 |
| wrong-import-path | 11 | F7, F8, F12, and the Code Mode name `generateTypes` |
| override-signature-mismatch | 9 | Overrides whose signatures drifted from the base class, including `formatAgentToolInput` (F11) |
| unknown-payload | 8 | Fields read from an `unknown` payload without narrowing |
| service-worker-globals | 6 | Push-notification pages typed against `window`, not a service worker |
| workflow-cascade | 4 | F7 |
| migration-before-code | 4 | Expected: the "before" code on migration pages |
| ai-sdk-v3-provider-types | 3 | F9 |
| typed-array-generics, workers-types-request-generic | 2 each | Type-parameter slips in push and webhook pages |
| api-not-in-any-release | 2 | F13 |
| route-handler-returns-null | 1 | F6 |
| other | 2 | An OAuth provider object literal missing required members, and the `run-workflows.mdx:622` cascade |

## Tier 2: 171 of 204 probed doc blocks ran in workerd, and none failed

I ran every complete, type-clean block that exports something runnable, 204 in all, plus the 19 linked examples (`scripts/run-examples.mjs`). Each block ran unmodified in workerd. The harness bundled it with esbuild, bound every Agent class it exports as a SQLite-backed Durable Object, and pointed `@ai-sdk/openai`, `@ai-sdk/anthropic`, `workers-ai-provider` and `agents/models/ai-sdk` at `MockLanguageModelV4`. A doc block has no assertions, so the runner probes it. It sends each Agent one request, sends each chat agent one user message, and sends each `McpAgent` an MCP `initialize`.

| Outcome | Doc blocks | Linked examples | Notes |
|---|---|---|---|
| ran, model called | 14 | 3 | Chat agents, model pages, Code Mode, resumable streams |
| ran, no model call | 157 | 9 | Agents that served the probe without a 5xx |
| loaded | 2 | 0 | Modules that export nothing the probe can call |
| needs-network | 3 | 0 | MCP servers on the internet, such as `mcp.github.com`, refused by the harness |
| needs-binding | 0 | 3 | Browser Rendering, R2 or a secret the example's wrangler config names |
| skipped | 28 | 4 | Bindings the harness lacks (8), credentials (7), voice, payments and chat platforms (5), packages outside the pin set (4), Browser Rendering (3), Workflows (2), `declare` placeholders (2), OAuth (1) |
| error | 0 | 0 | |

The probe is shallow. It never calls a block's own RPC methods, so "ran, no model call" means the block started and served its requests, not that every method in it works. The mock model calls only tools that a block defines. It refuses tools whose names suggest host access, such as `bash`, `write`, `edit` and `delete`, which also keeps it away from Think's workspace tools.

## Tier 3: every SDK member the docs call exists, but eight imported names and one option do not

A script compares the names the docs use with the packages' declarations (`scripts/factcheck-api.mjs`, `results/factcheck-api.json`):

| Surface | Docs | Package | Differences |
|---|---|---|---|
| `this.…` members on `Agent`, `AIChatAgent`, Think and `McpAgent` | 149 names used | 161, 216, 312 and 184 members | None missing from the SDK. The 32 names the bases lack are 30 helpers the blocks never define, `this._refreshState` (F8) and `this.x402Client` (F11) |
| Imports from SDK modules | 214 names in 72 modules | | 8 names not exported: `AgentWorkflow`, `AgentWorkflowEvent` and `AgentWorkflowStep` from `agents` (F7), `isUnauthorized` and `isTransportNotImplemented` (F11), `Workspace` from Think (F8), and `defineScheduledTasks` and `defineMessengers` (F13) |
| Subpath exports | | | 3 subpaths no release exports, all `agents/experimental/memory/…` (F12) |
| `Agent.options` defaults (`agents/routing.md`) | 3 options | 7 in `AgentStaticOptions` | `sendIdentityOnConnect: true` and `hungScheduleTimeoutSeconds: 30` match. The documented `hibernate` option does not exist (F10) |
| Public members no page mentions | | | 1 on `Agent`, 5 on `AIChatAgent`, 17 on Think and 16 on `McpAgent`, such as `onAgentToolStart` and Think's `deleteSubmission` |

## Tier 4: 18 of 20 documented claims held, and two doc patterns failed

Nine programs in `verify/cloudflare-agents/examples/` assert documented behavior in workerd, and all nine pass offline. Doc pages are under `source/agents/docs/` unless marked `cf/`.

| Claim (doc page) | Test | Result |
|---|---|---|
| `setState` persists, broadcasts and then fires `onStateChanged` with source `"server"` (`agents/state.md`) | 01 | ✅ |
| A new WebSocket client first receives the current state, then each update (`agents/state.md`) | 01 | ✅ |
| The deprecated `onStateUpdate` still fires (`agents/state.md`) | 01 | ✅ |
| `routeAgentRequest` routes `/agents/<kebab-class>/<name>` to that instance (`agents/routing.md`) | 01 | ✅ |
| `routeAgentRequest(request, env) \|\| new Response(…404)` returns the 404 for a non-agent path (`cf/agent-class/index.mdx`) | 01 | ❌ returns `null` (F6) |
| `this.sql` binds interpolated values, returns typed rows and shares the database with `ctx.storage.sql` (`agents/agent-class.md`) | 02 | ✅ |
| `schedule` gives `delayed`, `scheduled` and `cron` tasks, and `scheduleEvery` gives an idempotent interval (`agents/scheduling.md`) | 03 | ✅ |
| An alarm runs the callback with its payload, and the one-shot row is removed (`agents/scheduling.md`) | 03 | ✅ |
| `cancelSchedule` returns `true`, or `false` for an unknown id (`agents/scheduling.md`) | 03 | ✅ |
| `saveMessages` runs a full `AIChatAgent` turn with server tools and persists every part (`agents/chat-agents.md`) | 04 | ✅ |
| Think's `getSystemPrompt`, `getTools` and `runTurn` configure and run a turn (`think/index.md`) | 05 | ✅ |
| A blocking `beforeToolCall` skips `execute`, and the model sees the reason (`think/lifecycle-hooks.md`) | 05 | ✅ |
| `beforeTurn` with `output` and `activeTools: []` returns a parsed `TurnResult.output` (`think/lifecycle-hooks.md`, `think/index.md`) | 05 | ✅ |
| A caller's `body` flag can gate `beforeTurn` (`think/lifecycle-hooks.md`) | 05 | ❌ dropped by `runTurn` (F1) |
| Think adds workspace tools to every turn (`think/tools.md`) | 05 | ✅ |
| `needsApproval` pauses the turn; approval runs the tool once and auto-continues; denial leaves `output-denied` (`agents/human-in-the-loop.md`) | 06 | ✅ |
| `createMcpHandler` serves an MCP SDK v2 server (`agents/mcp-servers.md`) | 07 | ✅ |
| `addMcpServer` connects, and `listTools`, `callTool` and `getAITools` work (`agents/mcp-client.md`) | 07 | ✅ |
| After hibernation, `this.state`, SQL rows, `connection.state` and the WebSocket persist while memory resets (`agents/http-websockets.md`) | 08 | ✅ |
| Think runs `needsApproval` tools and structured output together (`think/tools.md`, `think/lifecycle-hooks.md`) | 09 | ✅ |

## Eighteen findings: five SDK and type surprises, six doc errors, four drifts from the release and three deprecations

### SDK behavior and types

**F1. Think's `runTurn({ input, body })` drops `body`.** `RunTurnWait` declares `body?: Record<string, unknown>` (`@cloudflare/think/dist/index-DDnny6kt.d.ts:658`). But `_runTurnWait` in `think.js` forwards `options.body` only on the `continuation: true` path; the input path calls `_runProgrammaticMessagesTurn(id, messages, { signal, channel, captureOutput })` without it (`think.js:4976–5020`). `beforeTurn` therefore sees `ctx.body` as `undefined`. The lifecycle page's structured-output pattern gates on "a body flag set by the caller" (`think/lifecycle-hooks.md:357–376`), so that gate never fires for a programmatic turn. Example 05 asserts the drop; gating on an instance field works instead. Either the SDK should forward `body`, or the docs should say it applies only to client and continuation turns.

**F2. Materializing `initialState` fires `onStateChanged`.** On a new agent, the first read of `this.state` persists `initialState` through the same path as `setState` (`_state.set(this.initialState, "server")`, `agents/dist/src-DoGNJ4Ud.js:1609–1611`), and `onStateChanged(initialState, "server")` fires once. The docs say only "`initialState` is used and persisted" (`agents/state.md:86–90`), and they list the hook as a step of `setState()` (`state.md:134–139`). A hook that notifies people fires once per new agent with nothing changed. Example 01 asserts it, and the deprecated `onStateUpdate` behaves the same way.

**F3. `sendIdentityOnConnect` defaults to `true`, so instance names reach every WebSocket client.** The default is documented (`agents/routing.md:872`) and matches the package. Instance names are often user or tenant ids, and every connecting client receives one unless the class sets `static options = { sendIdentityOnConnect: false }`. The SDK warns once per class, and only when the URL path hides the name, as with custom routing (`agents/dist/src-DoGNJ4Ud.js:2105–2110`). Example 09 logs that warning. With identity off, `addMcpServer` throws unless you pass a `callbackPath`, because the default callback URL would expose the name (`src-DoGNJ4Ud.js:6718`).

**F4. Think offers the model `write`, `edit` and `delete` on every turn.** With two tools from `getTools()`, the model in example 05 was offered `delete`, `edit`, `find`, `grep`, `lookupTicket`, `ls`, `purgeTicket`, `read` and `write`. The docs state it: "Think adds Computer's AI SDK tools to every turn with no configuration" (`think/tools.md:3`, `:23`). The tools act on the agent's SQLite-backed virtual `/workspace`, not on the host. They still give the model mutating tools by default, so a gated agent must limit them with `activeTools` or block them in `beforeToolCall`.

**F5. RPC stub types turn some results into `never` (a workers-types issue).** `getAgentByName()` returns a `DurableObjectStub`, whose method results pass through `@cloudflare/workers-types`' RPC serialization types. A result that contains `unknown` becomes `never`, as happens with `UIMessage[]` from `this.messages` and with `TurnResult.output`. A deeply nested result, such as an AI SDK prompt message, fails with TS2589, "Type instantiation is excessively deep and possibly infinite". I reproduced both under TypeScript 5.9.3 and 7.0.2 with identical errors, and a plain `Agent` subclass whose method returns `{ x: unknown }` or `UIMessage[]` shows the same collapse. Chat agents hit it most, because their messages are `UIMessage`s. The examples type such stubs by hand with `rpc<T>()` (`examples/lib/check.ts`).

### Doc errors: code that does not work as written

**F6. The Agent class page's routing fallback never reaches its 404.** `cf/agent-class/index.mdx:202` returns `routeAgentRequest(request, env) || new Response("Not found", { status: 404 })` without `await`. A Promise is always truthy, so the handler returns the promise, which resolves to `null` for a non-agent path. The type checker flags it (`Promise<Response | null>` is not assignable to `Promise<Response> | Response`), and example 01 shows the `null` at run time. The Think page awaits first, correctly (`think/index.md:57`).

**F7. Workflow classes are imported from `agents`, which does not export them.** `agents/human-in-the-loop.md:57–58` and `packages/agents/README.md:410` import `AgentWorkflow`, `AgentWorkflowEvent` and `AgentWorkflowStep` from `"agents"`. Only `agents/workflows` exports them, in 0.33.0 and on main, as `agents/workflows.md:56–57` shows. The error cascades into `waitForApproval` and `reportProgress` "not existing" on the workflow class.

**F8. A Think page imports `Workspace` from Think and calls an undeclared method.** `think/multi-chat.md:78` imports `Workspace` from `@cloudflare/think`, but it comes from `@cloudflare/computer` (`think/tools.md:23`), and Think 0.23.0 does not re-export it. The same page calls `this._refreshState()` (`:97`), which no package declares.

**F9. The `AIChatAgent` guardrail middleware uses AI SDK v3 provider types.** `cf/agent-class/communication-channels/chat/chat-agents.mdx:1527` types the middleware as `LanguageModelV3Middleware` and destructures `text` from `doGenerate()`. The `agents` package peers on `@ai-sdk/provider` ^4, where the type is `LanguageModelMiddleware` with a required `specificationVersion`, and generate results carry `content`, not `text`. The block fails with TS2741, TS2339 and TS2322.

**F10. Three pages document a `hibernate` option that does not exist.** `agents/routing.md:871`, `cf/agent-class/routing.mdx:108` and `cf/agent-class/internals.mdx:479` list `static options = { hibernate: false }`, the last two saying it keeps the agent in memory while clients are connected. `AgentStaticOptions` in 0.33.0 has no `hibernate` field, the bundle never reads one, and main has none either. A static `options` object accepts the extra key without a type error, so the setting is silently ignored. Another page agrees with the package: "there is no non-hibernating mode" (`agents/http-websockets.md:411`). I found this one while re-checking the draft findings.

**F11. Five smaller slips.**
- *Override return type:* the `formatAgentToolInput` override returns `{ role: "user", … }` from a method, which gets no contextual type from the base class, so `role` widens to `string` and fails TS2416. It appears three times: `agents/agent-tools.md:90`, `packages/ai-chat/README.md:209` and `cf/agent-class/agent-tools.mdx:68`. Annotate the return type as `UIMessage` or write `"user" as const`.
- *Untyped client state:* `useAgent` and `new AgentClient` without a state type parameter give `state: {}`, so reads such as `agent.state?.players` fail (11 errors in 7 blocks, including `agents/state.md`, `client-sdk.md` and `getting-started.md`).
- *Missing `host`:* the vanilla `AgentClient` example in `packages/agents/README.md:390` omits `host`, which `AgentClientOptions` requires through `PartySocketOptions`.
- *Unexported MCP helpers:* `cf/model-context-protocol/apis/client-api.mdx:1242` imports `isUnauthorized` and `isTransportNotImplemented` from `"agents"`. Both are internal helpers in the 0.33.0 bundle and in main's `mcp/client/errors.ts`, and no entry point exports them.
- *Undeclared field:* `cf/tools/payments/x402/pay-from-agents-sdk.mdx:27` assigns and reads `this.x402Client` without declaring it on the class.

### Docs that drift from the release

**F12. The memory concepts page imports subpaths no release exports.** `cf/concepts/conversation-state-and-memory.mdx` imports `agents/experimental/memory/session` (lines 34, 80 and 166), `…/memory/utils/compaction-helpers` (342) and `…/memory/utils` (371). None is in the 0.33.0 exports map or on main at `1a450e7`. The page warns that these paths "may change before graduation" (`:23`), and they already have.

**F13. Two Think pages use APIs that exist in no release and not on main.** `cf/harnesses/think/scheduled-tasks.mdx:18` imports `defineScheduledTasks` from `@cloudflare/think`, and `cf/harnesses/think/messengers.mdx:32` imports `defineMessengers` from `@cloudflare/think/messengers`. Neither name appears in 0.23.0 or in main's sources. The repo's Think page describes a different scheduled-task API, `getScheduledTasks()` returning `ThinkScheduledTasks` (`think/index.md`, "Scheduled Tasks").

**F14. Two Think pages link an example that no longer exists.** `cf/harnesses/think/tools.mdx:401` and `cf/harnesses/think/index.mdx:390` link `github.com/cloudflare/agents/tree/main/examples/assistant`, which is absent at the tag and on main. The repo's own page links a pinned "last version" commit instead (`think/multi-chat.md:23`, `:576`).

**F15. The repo docs on main differ from the tag, and the npm package ships the tag's docs.** At main `1a450e7`, 19 `docs/agents` pages and 5 `docs/think` pages differ from the release tags (`diff -rq` against a main checkout). The `docs/` folder inside the `agents@0.33.0` npm package matches the tag mirror exactly, so the tag is the right baseline for a reader on the release. Several pages link `tree/main` URLs, which take readers to the branch instead.

### Deprecations the docs still teach

**F16. `needsApproval` on `tool()` is deprecated in ai 7, and the approval docs build on it.** `agents/human-in-the-loop.md:187–245`, `agents/chat-agents.md:1100` and `think/tools.md:163` all use it. The ai 7 declaration is `@deprecated` ("Tool approval is handled on a `generateText` / `streamText` level now", `@ai-sdk/provider-utils`). It still works in 0.33.0: examples 06 and 09 show approval running the tool once and denial skipping it.

**F17. `McpAgent` is deprecated in favor of `createMcpHandler`, and several pages still teach it.** The deprecation is stated in `agents/mcp-servers.md:277–293`, and `cf/model-context-protocol/apis/agent-api.mdx` carries a deprecation banner. Old servers still work: four `McpAgent` doc blocks on that page and the `webmcp` example initialized through `serve("/mcp")` in the probe. Example 07 verifies the replacement, a `createMcpHandler` server and an `addMcpServer` client.

**F18. `workers-ai-provider` is deprecated on npm, yet Think depends on it and the docs import it.** Version 4.0.1, the latest, reads "Deprecated. Use createAI from agents/models/ai-sdk" on the npm registry. `@cloudflare/think@0.23.0` lists `workers-ai-provider ^4.0.0` as a dependency, `think/getting-started.md:32` says "Think bundles workers-ai-provider", and 16 import sites in 13 mirrored files use `createWorkersAI`.

## Corrections to the draft findings

The S6a harness produced 18 draft findings (`verify/cloudflare-agents/results/findings-draft.md`). I re-checked each one against its evidence before writing this page, and five changed. The last row corrects this page's own first Tier 1 run:

| Draft | Draft claim | Correction | Evidence |
|---|---|---|---|
| F3 (now F5) | Stubs for `AIChatAgent` and Think subclasses type as `never`, seen only under TypeScript 7 | The same errors appear under TypeScript 5.9.3. The cause is workers-types' RPC types, which collapse `unknown`-bearing results on any Agent, plain ones included | A probe file compiled with both `tsc` versions |
| F4 (now F3) | The identity warning logs on every new connection | It logs once per class, and only when the URL path hides the instance name | The `sendIdentityOnConnect` branch in the agents bundle |
| F15 (now F11, F15) | `isUnauthorized`, `isTransportNotImplemented` and `this.x402Client` exist only on main | None is public on main; the heuristic matched an internal helper and an unrelated `@x402/core` import. Only the tag-versus-main docs drift remains in F15 | Main's `mcp/client/errors.ts` and `mcp/client/x402.ts` at `1a450e7` |
| F17 (now F17) | Ten `McpAgent` doc blocks initialized | Four doc blocks and one linked example initialized; the ten records are two probes per source | `results/run-docs.json`, `mcpInitialized` |
| F12, F13 (now F11) | Two separate findings | Merged into F11 with the MCP and x402 slips, which freed F10 for the new `hibernate` finding | `AgentStaticOptions` in the agents `.d.ts` |
| Tier 1 table (first run) | Counts from `tsc` 7 | The first run picked up a stray TypeScript 5.9.3 `tsc` left in the harness's own `node_modules/.bin`, which reports some errors with different codes. Rerun with the workspace's 7.0.2 (2026-11-18), one block moved from syntax and one from other to api-mismatch, and one from other to fragment; neither new mismatch is a doc error (Tier 1) | `results/typecheck-docs.json`; the harness now resolves the `typescript` package instead of the nearest `.bin/tsc` |

## What we could not verify

Five areas stayed outside the offline harness:
- **Workflows.** `AgentWorkflow`, `runWorkflow` and `waitForApproval` need a Workflows binding, which the harness does not configure, so two doc blocks were skipped and no example covers the S6 plan's "workflows with human pause and resume". Miniflare has a `workflows` option, so this is feasible follow-up work.
- **Platform services.** Containers, Browser Rendering, voice, x402 payments, email, the chat-platform messengers and OAuth MCP flows all need services or credentials.
- **Real models.** The mock model shows that the loop, tools and persistence work, not how a provider behaves.
- **Deployed behavior.** Eviction in Miniflare imitates hibernation; Cloudflare's own idle timing (about ten seconds, per `agents/http-websockets.md`) was not measured.
- **Language parity.** TypeScript is the SDK's primary language, and Cloudflare publishes no Python Agents SDK, so the plan's parity check has nothing to compare.

## Verdict: trust the behavior, and read the repo docs at the release tag

The Cloudflare Agents SDK does what its docs describe. State, SQL, scheduling, routing, hibernation, both chat loops, tool approval and MCP all held in workerd, and no probed doc block failed. The docs are where readers lose time. They span two sites that render branches, not the release, so pages import subpaths and helpers that 0.33.0 lacks (F7, F11–F13), document an option it ignores (F10), and teach three deprecated APIs (F16–F18). Two defaults deserve a deliberate choice before launch: identity sent to clients (F3) and Think's mutating workspace tools (F4). Read the repo docs at the tag that matches your version, compile each copied example against it, await `routeAgentRequest`, and rerun `pnpm run verify` at each upgrade to catch the next drift.
