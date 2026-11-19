# verify/cloudflare-agents

Offline verification harness for the Cloudflare Agents docs and our examples, pinned to `agents@0.33.0`, `@cloudflare/think@0.23.0` and `@cloudflare/ai-chat@0.12.2` (the latest npm releases as of November 2026), on `ai@7.0.162`. Everything runs in Cloudflare's local Workers runtime, `workerd@1.20261103.1`, through `miniflare@5.20261103.0-beta`. No API key or Cloudflare account is needed.

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

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. The transcript holds each request the example sent, each answer and each `check()` with its result, and, when the call stack shows it, the example line that led to each event.

The examples run inside workerd, where the runner cannot preload the recorder. Instead, `scripts/run-examples.mjs` builds each example with a marker that is new for every run, and `examples/lib/transcript.ts` attaches the recorder to `ai/test`'s `MockLanguageModelV4` itself. The recorder prints each request, each answer and each passing `check()` on a console line that carries the marker, and `scripts/worker-harness.mjs` prints a failed `check()` the same way. Because the runner reads only those lines from workerd's output, an example's own output cannot add an event. workerd's stack names no line of the example, so these events carry none. `09-triage-agent.ts` waits until the turn its approval continues has ended before its next checks, so its events come in one order on every run. The five examples that call no model, `01-state.ts` among them, have no transcript.

Recording only reads what the mock already holds, so it changes no verdict. The writer replaces the run's own directories, and the ids, timestamps and durations the SDK generated, with placeholders. An id the mock's script chose stays as written, and so does everything else an example scripts, such as a tool's input. Two runs on any machine therefore write the same bytes.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

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

`miniflare@5.20261103.0-beta` breaks the repo's "stable releases only" habit on purpose. The newest stable miniflare before the 2026-11-04 cutoff is 4.20260730.0, from July, which predates the `workerd` that `agents@0.33.0` needs. The newest stable wrangler, `wrangler@4.157.0` (published 2026-11-03), itself depends on `miniflare@5.20261103.0-beta`, so this harness uses the runtime that Cloudflare's own stable CLI ships.

## Security alerts: one override, one accepted (2026-11-18, todo X2)

- **`undici` (18 advisories, 6 high): overridden.** `just-bash@3.6.0`, Think's peer, pins `guarded-fetch@0.1.3`, which pins `undici@7.29.0`. No `just-bash` release carries a fix, so `pnpm-workspace.yaml` overrides `guarded-fetch>undici` to `7.30.2`, the latest fixed release. Doc-example outcomes were identical before and after (204 doc blocks and 19 linked examples), and all 9 behavioral examples pass. Remove the override once `just-bash` depends on `guarded-fetch >=0.3.0`, which uses `undici@7.30.1`.
- **`picomatch@4.0.7` (GHSA-fc5q-39xc-vjpf, high, ReDoS through crafted extglob patterns): accepted.** No patched release exists, since 4.0.7 is the latest. It arrives through `agents@0.33.0` → `@rolldown/plugin-babel`, a build-time plugin whose glob patterns come from its own configuration, never from user input. The harness bundles with esbuild, offline. Revisit when picomatch publishes a fix.
