# verify/cloudflare-agents

Offline verification harness for the Cloudflare Agents docs and our examples, pinned to `agents@0.33.0`, `@cloudflare/think@0.23.0` and `@cloudflare/ai-chat@0.12.2` (the latest npm releases at the 2026-11-04 cutoff), on `ai@7.0.173`. Everything runs in Cloudflare's local Workers runtime, `workerd@1.20261113.1`, through `miniflare@5.20261113.0-beta`. No API key or Cloudflare account is needed.

## How it works

- **Agents are Durable Objects, so every example runs inside workerd.** `scripts/workerd.mjs` bundles an example with esbuild into one Worker module. The bundle's entry re-exports the example, so its Agent classes become exported Durable Object classes, and wraps its default handler with `scripts/worker-harness.mjs`. Miniflare then starts the Worker with a SQLite-backed Durable Object binding for each Agent class, `nodejs_compat`, and compatibility date 2026-11-03.
- **Models are mocks.** The bundler resolves `@ai-sdk/openai`, `@ai-sdk/anthropic`, `workers-ai-provider` and `agents/models/ai-sdk` to the shims in `shims/`, which hand out the request-aware `MockLanguageModelV4` in `scripts/mock-model.mjs` (copied from `verify/vercel-ai-sdk`). The aliasing also reaches Think's own imports, so a Think `getModel()` that returns a `"@cf/…"` id gets a mock. An `AI` binding (a small Worker whose `run()` returns a canned answer) stands in for Workers AI. The mock never calls provider-defined tools and denies function tools whose names suggest host access (`bash`, `write`, `edit`, `delete`, …), which covers Think's built-in workspace tools.
- **Nothing leaves the machine.** Every outbound `fetch` from the Worker goes to Miniflare's `outboundService`. Requests to `localhost` loop back into the same Worker, so an Agent's MCP client can reach the Worker's own `/mcp`. Every other host gets a 403, and the run records the host. The Node process that hosts Miniflare also rejects non-local `fetch`. Each run is a child process (`scripts/worker-run.mjs`) with an allowlisted environment (`PATH`, a temp `HOME`, `TMPDIR`, `LANG`), its own process group and a timeout, so workerd inherits no credentials.
- **Doc examples are probed.** A doc block has no assertions, so the runner exercises what it exports. It calls `getAgentByName()` and sends one request to each Agent, and sends chat agents (AIChatAgent, Think) one user message through `saveMessages()`. It sends an MCP `initialize` to `McpAgent` classes through their static `serve()`, and calls the block's own default `fetch` handler. Binding names come from the page's wrangler config blocks when it has them; `McpAgent` classes are also bound as `MCP_OBJECT`, the binding `serve()` looks up by default.
- **Our examples assert behavior.** Each file in `examples/` exports its Agent classes and `test(env, h)`. The harness calls `test()` inside the Worker. `h.evict(className, name)` asks the host to evict a Durable Object with its WebSockets hibernated (Miniflare's `unsafeEvictDurableObject`), and `h.until()` polls for asynchronous results such as alarms.
- **Extraction** takes every `ts`, `typescript`, `tsx` and `js` fence from the repo's Markdown and the cloudflare-docs MDX, including fences inside `<TypeScriptExample>` and `<Steps>`. It records Durable Object bindings from `jsonc`, `json` and `toml` wrangler blocks (often inside `<WranglerConfig>`) per page, and copies each linked example's server-side sources whole, so relative imports resolve.
- **Type-checking** mirrors the package's shipped `agents/tsconfig` (DOM libs, `@cloudflare/workers-types`, Node types; no `vite/client`). `scripts/env.d.ts` types `Env` with an `any` index signature, because `wrangler types` would generate it from a config the blocks lack. Errors that follow from a missing import (a class whose base is unresolved, `this.…` at module level, a stub typed through an untyped binding) count as fragments, not API mismatches.

## Outcomes

| Outcome | Meaning |
|---|---|
| `ran` | Every probe request succeeded and at least one mock model call happened (doc blocks), or every assertion passed (our examples) |
| `ran-no-model` | Every probe request succeeded without a model call |
| `loaded` | workerd started the module, but it exports nothing the probe can call |
| `needs-network` | It failed only because the harness refused a remote host (an MCP server on the internet) |
| `needs-binding` | A linked example failed for want of a binding or secret its wrangler config names (Browser Rendering, R2, a secret var) |
| `probe-input` | Its handler expects a request body the probe does not send |
| `skipped` | Needs something the harness does not provide; `reason` says what (React or client code, containers, Workflows, a credential, a package outside the pinned set) |
| `error`, `timeout`, `bundle-error` | A real failure, to be triaged |

## One example evicts an agent that has a wake scheduled

`10-durable-wake.ts` has an agent store a note in `this.state`, schedule a callback and set an in-memory field. The harness then evicts the Durable Object. After 6.5 seconds with no request, the schedule's alarm has woken a new instance, which ran the callback and wrote a row that names its own start count. The example then reads the agent. The note survived, the in-memory field did not, and the one-shot schedule is gone. The callback ran once with its payload, before any request arrived. The example carries `// #region` and `// book:note` markers for Chapter T24.

Only Cloudflare's runtime runs here, and the example imports Cloudflare's `agents`, so it cannot run on AWS or Vercel. AWS and Vercel wakes are not runnable in `verify/`. Our own packages get them in N47a and N48a. The example makes no model call, so it records no transcript.

## One example drops a repeated trigger by its id

`12-trigger-dedup.ts` has an agent write each delivery id to its own SQLite table with `INSERT OR IGNORE` before it starts a task. The same id sent twice starts one task and drops the second. After the harness evicts the Durable Object, a redelivery of the same id is still dropped, because the id is in storage. Alarms and webhooks arrive at least once, so this is the ingress rule that makes a repeat harmless. The example is ours and checks our own pattern: the SDK has no ingress feature, and this one uses only `this.sql`.

## One example keeps long-term memory in an agent's own SQLite

`11-context-memory.ts` declares two blocks from `agents/context`: a writable `memory` block (`AgentContextProvider`) and a searchable `notes` block (`AgentSearchProvider`, an FTS5 table). A scripted model writes one fact to each through `set_context`, the harness evicts the Durable Object, and on the new instance a second scripted model finds the note through `search_context`. The new instance's frozen system prompt holds the fact and the note count, which the first instance's prompt lacked. A second agent name sees neither block's content, because both blocks render there with their headers and no text, and its search finds nothing, because each agent keeps its blocks in its own database.

FTS5 ran in local workerd, so the example needs no limit recorded. The search is keyword search only: `AgentSearchProvider` uses FTS5 with the `porter unicode61` tokenizer, so the query "deploying thursday" matches a note that says "deploy" and "Thursdays". Vectorize and Workers AI have no local simulation, so no semantic search runs here. Every export of `agents/context` is experimental as of November 2026, and the docs say it may change between releases. The model is offered only `set_context` and `search_context`, and the example asserts that. The example carries `// #region` and `// book:note` markers for Chapter T36, and its transcript is `results/transcripts/11-context-memory.json`.

## One example runs a chained voice pipeline and interrupts it

`13-voice-pipeline.ts` gives a `withVoice(Agent)` class a fake `Transcriber` and a fake `TTSProvider`, so no speech model runs, and drives the agent over its WebSocket with the voice protocol's own messages. One audio frame becomes an interim and a final transcript, and `onTurn` runs an ordinary `streamText` loop on a scripted model with one in-memory tool, `get_forecast`. The example records the order of `onTurn`, the tool and the TTS call, and asserts that the tool ran before the reply was synthesized. It also asserts that the reply arrives as one audio frame holding the fake bytes and that a `turn_metrics` message closes the turn as `completed`. A second turn holds its second sentence inside the TTS call. An `interrupt` message then aborts that turn's `context.signal`, which the held TTS call sees and which, as the signal passed to `streamText`, reaches the scripted model call as an aborted signal, runs `onInterrupt` once, returns the status to `listening` and closes the turn with `turn_metrics` outcome `aborted`. The model's request in turn 2 holds no tool message from turn 1, because the mixin keeps only `{ role, content }` text history, so an agent must store a tool result itself if a later turn needs it.

These checks prove that the mixin aborts the signal it gives `onTurn` and the TTS provider, and that `streamText` passes its `abortSignal` on to the model call. They do not prove that a real model call stops early, because the scripted model ignores its signal. Without `abortSignal` in the `streamText` call, every abort check except the model-signal one still passes, because the mixin aborts its own signal either way.

The speech stages are fakes by necessity: Workers AI's Flux, Nova 3 and text-to-speech models have no local simulation, so the example shows the pipeline's wiring and not its audio. `agents/voice` is experimental at `agents` 0.33.0 as of November 2026, and its docs say it "will break between releases", so an `agents` upgrade may fail this example, and the weekly update pull request then shows what changed. In our harness, binary WebSocket messages reached the example as `Blob`s until it set `ws.binaryType = "arraybuffer"`; we have not checked workerd's source or documentation for that default. The example carries `// #region` and `// book:note` markers for Section T38, and its transcript is `results/transcripts/13-voice-pipeline.json`.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. The transcript holds each request the example sent, each answer and each `check()` with its result, and, when the call stack shows it, the example line that led to each event.

The examples run inside workerd, where the runner cannot preload the recorder. Instead, `scripts/run-examples.mjs` builds each example with a marker that is new for every run, and `examples/lib/transcript.ts` attaches the recorder to `ai/test`'s `MockLanguageModelV4` itself. The recorder prints each request, each answer and each passing `check()` on a console line that carries the marker, and `scripts/worker-harness.mjs` prints a failed `check()` the same way. Because the runner reads only those lines from workerd's output, an example's own output cannot add an event. workerd's stack names no line of the example, so these events carry none. `09-triage-agent.ts` waits until the turn its approval continues has ended before its next checks, so its events come in one order on every run. The six examples that call no model, `01-state.ts` among them, have no transcript.

Recording only reads what the mock already holds, so it changes no verdict. The writer replaces the run's own directories, and the ids, timestamps and durations the SDK generated, with placeholders. An id the mock's script chose stays as written, and so does everything else an example scripts, such as a tool's input. Two runs on any machine therefore write the same bytes.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

## A live run sends one example to a real provider

The book's occasional live run ([`scripts/live/`](../../scripts/live/), started only by `.github/workflows/live-run.yml`) calls `scripts/run-examples.mjs examples --only <example> --live`. In that mode esbuild builds the bundle with `__LIVE_MODEL__` set, so `scripted()` in `examples/lib/check.ts` posts each call's options to `http://live-model.invalid/` instead of playing its turns. `scripts/workerd.mjs` hands that request to `scripts/live-model.mjs`, in the Node.js process that runs workerd, which calls the pinned `@ai-sdk/anthropic` or `@ai-sdk/openai`. The key therefore stays in that process and never enters workerd: the live mode reads it from the file that `LIVE_API_KEY_FILE` names and deletes the file before workerd starts. A streamed call is one generate call on the host, which the bundle replays as a stream.

Think adds its workspace tools (`read`, `ls`, `find`, `grep`, `write`, `edit` and `delete`) to every turn. They act on the Agent's own storage, not the host, but the live run withholds them all the same, so a real model sees only the example's tools. Any remaining provider-defined tool, or a tool named like a shell or an editor, stops the call. Each call is capped at the run's `maxTokens` and checked by the cost guard, and the transcript goes to `results/live/<provider>/<example>.json`. Without `--live`, nothing in the live mode runs, so `pnpm test` and the committed transcripts are unchanged.

## Scripts

| Command | Does |
|---|---|
| `pnpm run fetch-docs` | Mirror the docs: `cloudflare/agents` at the release tags (`docs/agents`, `docs/think`, READMEs, server sources of linked examples) and `cloudflare/cloudflare-docs` at the commit pinned in `scripts/fetch-docs.mjs` (committed, with both licenses) |
| `pnpm run extract` | Pull every TypeScript block and linked example into `extracted/` (gitignored) |
| `pnpm run typecheck:docs` | Compile every source against the pinned packages and classify errors → `results/typecheck-docs.json` |
| `pnpm run triage:docs` | Mark mismatches that only use names from the `cloudflare/agents` main branch (`ahead-of-release`; needs network) and group the rest by cause → `results/mismatch-causes.json` |
| `pnpm run run:docs` | Probe complete, type-clean blocks and the linked examples in workerd → `results/run-docs.json` |
| `pnpm run factcheck` | Diff the `this.…` members and SDK imports the docs use against the `.d.ts` files → `results/factcheck-api.json` |
| `pnpm test` | Type-check and run our examples in workerd → `results/run-examples.json` |
| `pnpm run verify` | All of the above except `fetch-docs` |

`EXAMPLE_TIMEOUT_MS` (default 60000) and `EXAMPLE_CONCURRENCY` (default 4) tune the runner; `--only id1,id2` runs a subset without overwriting the results file.

## Gotchas found while building it

- Miniflare 5's constructor rejects the options shape its README documents; the harness writes v4-style options and passes them through `convertV4MiniflareOptions()`.
- workerd failed with "internal error" when the bundled module lived outside the package directory, so bundles go to `.tmp/` inside the package.
- A Request built inside a Worker has no `Host` header, which `createMcpHandler` requires; `07-mcp.ts` sets it.
- A Durable Object stub reserves `fetch()` and `connect()`, so an Agent method named `connect` cannot be called over RPC.
- workerd coarsens clocks, so the scheduling example compares against the schedule's own due time rather than `Date.now()` taken in another isolate.

## Why the local runtime is a miniflare beta

`miniflare@5.20261113.0-beta` (the harness began on `5.20261103.0-beta`) breaks the repo's "stable releases only" habit on purpose. The newest stable miniflare before the 2026-11-04 cutoff is 4.20260730.0, from July, which predates the `workerd` that `agents@0.33.0` needs. `wrangler@4.157.0` (published 2026-11-03), the newest stable wrangler then, depended on `miniflare@5.20261103.0-beta`, so the harness began on the runtime that Cloudflare's own stable CLI shipped. The sweep has since moved it three days past `wrangler@4.160.1`, which depends on `miniflare@5.20261110.1-beta`.

## Security alerts: three overrides, one accepted (2026-11-18, todo X2; updated 2026-11-27)

- **`undici` (18 advisories, 6 high): overridden.** `just-bash@3.6.0`, Think's peer, pins `guarded-fetch@0.1.3`, which pins `undici@7.29.0`. No `just-bash` release carries a fix, so `pnpm-workspace.yaml` overrides `guarded-fetch>undici` to `7.30.2`, the latest fixed release. Doc-example outcomes were identical before and after (204 doc blocks and 19 linked examples), and all 9 behavioral examples pass. Remove the override once `just-bash` depends on `guarded-fetch >=0.3.0`, which uses `undici@7.30.1`.
- **`picomatch@4.0.7` (GHSA-fc5q-39xc-vjpf, high, ReDoS through crafted extglob patterns): accepted.** No patched release exists, since 4.0.7 is the latest. It arrives through `agents@0.33.0` → `@rolldown/plugin-babel`, a build-time plugin whose glob patterns come from its own configuration, never from user input. The harness bundles with esbuild, offline. Revisit when picomatch publishes a fix.
- **`zod@4.1.11` (GHSA-mrhx-c7xc-m3w5, high): overridden.** Think and `agents` reach `@workflow/cli@5.2.0` through their `chat` and `workflow` dependencies, and `@workflow/cli` pins `@vercel/cli-auth@0.0.1`, which pins zod 4.1.11. As of November 2026, no `@workflow/cli` release moves off cli-auth 0.0.1, so `pnpm-workspace.yaml` overrides `@vercel/cli-auth@0.0.1>zod` to `4.6.7`, the version our packages pin. Remove the override once `@workflow/cli` depends on `@vercel/cli-auth` 0.4.0 or later.
- **`minimatch@10` (GHSA-g3hv-75wg-m249, moderate): overridden.** `@workflow/cli` also pins `@oclif/core@4.11.4` and reaches `@vercel/queue@0.11.0` through `@workflow/world-vercel`. `@oclif/core` and `@vercel/queue` both ask for minimatch 10, and no 10.x release carries the fix. `pnpm-workspace.yaml` overrides minimatch under each to `11.0.9`, because each calls only `minimatch(path, pattern)`, which 11 keeps. The comment above each override in `pnpm-workspace.yaml` gives its removal condition.
