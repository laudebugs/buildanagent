# verify/google-adk

This is the offline verification harness for Google's Agent Development Kit in TypeScript. It is pinned to `@google/adk@2.5.0` with `@google/genai@2.32.0` and `zod@4.6.7`, and needs no API key or Google Cloud project.

## Pins

| Package | Version | Why |
|---|---|---|
| `@google/adk` | 2.5.0 | Published 2026-11-12 and still the latest release as of November 2026. The project owner chose this pin on 2026-11-18, when it was six days old, overriding the one-week rule in `AGENTS.md`. |
| `@google/genai` | 2.32.0 | The newest release in 2.5.0's `^2.29.1` range, published 2026-10-29. The 3.x line is outside that range. |
| `zod` | 4.6.7 | The workspace pin, which satisfies 2.5.0's `^4.6.7`. |

`@google/adk-integrations@2.5.0` holds the Claude/Anthropic model, BigQuery, LangChain and CrewAI integrations. The pin decision covered `@google/adk` only, so this package is not installed, and the 7 doc sources that import it are type-checked as fragments and skipped at run time.

## How it works

- **The model is scripted, because ADK ships no test model.** `@google/adk@2.5.0` exports no fake or mock `BaseLlm`. Its record/replay model exists only in the adk-js repo's tests (`tests/integration/workflows/_harness/record_replay_model.ts`), not in the package. The harness therefore subclasses `BaseLlm`, the seam ADK's own tests use:
  - **Doc examples** run unmodified under `scripts/scripted-preload.mjs`. The preload registers `scripts/scripted-llm.mjs` with `LLMRegistry` under the same pattern objects that `Gemini`, `ApigeeLlm` and `ChromeBuiltInLlm` register, which replaces those classes' entries, and adds a catch-all pattern. It also replaces `generateContentAsync` on those classes, so a block that calls `new Gemini(...)` directly gets the scripted model too. The scripted model reads the request: it calls one offered function (preferring one the prompt names), answers after a tool result, calls ADK's `set_model_response` tool when an agent has both tools and an `outputSchema`, returns schema-shaped JSON when `responseSchema` is set, and transfers at most once per history.
  - **Our examples** (`examples/`) pass a `ScriptedLlm` from `examples/lib/check.ts` as the agent's `model`. Each test scripts its responses per request and asserts on the recorded requests.
- **Host tools are denied by name.** The scripted model never calls a function whose name matches shell, exec, write, edit, delete, file, script, code, browser, computer-use, fetch, http or url patterns (`HOST_TOOL` in `scripts/scripted-llm.mjs`). Live (bidi) connections throw.
- **Nothing leaves the machine.** The preload rejects non-local `fetch`, `http.request`/`get` and `https.request`/`get`, and calls `syncBuiltinESMExports()` so ESM imports of `node:https` see the patch. Each run is a child process with an allowlisted environment: `PATH`, a temp `HOME`, `TMPDIR` and `LANG`, plus a dummy `GEMINI_API_KEY` that satisfies the `Gemini` constructor's key check. Each run also gets a temp working directory and a timeout.
- **Samples are probed.** Most doc snippets and every adk-js sample export a `rootAgent` for `npx adk run` and never run it themselves. For each one, the runner writes a driver to `.tmp/drivers/`. The driver imports the source, sends one user message ("hello world") through an `InMemoryRunner`, and fails on an error event or an empty run. When an instruction template reads a state key the page expects the app to set (`{initial_topic}`), the probe reruns with that key in `stateDelta`, up to 5 keys.
- **Extraction keeps TypeScript only.** ADK pages put Python, TypeScript, Go, Java and Kotlin in `=== "Lang"` tabs, each with its own fence language, so the extractor keeps fences tagged `typescript`, `ts`, `tsx`, `javascript` or `js`. A fence whose body is only a `--8<--` include becomes a reference to the snippet file, which is extracted whole along with the pages that include it. Includes inside a larger fence are inlined. The adk-js samples are extracted whole, and their data files (a transcript, OpenAPI specs, the retrieval corpus) are copied next to them.
- **Type-check classes.** `api-mismatch` covers missing exports and members, plus three ADK-specific causes: an SDK value imported with `import type` (TS1361), a plugin hook that doesn't match `BasePlugin` (TS2416), and a `BaseAgent` subclass without `runLiveImpl` (TS2515). An undeclared `Event` resolves to the DOM type, so it counts as a fragment.

## Results (2026-11-18)

| Tier | Result |
|---|---|
| Extract | 304 sources: 179 page blocks from 88 pages, 63 snippet files and 62 adk-js samples |
| Type-check | 221 pass, 62 fragment, 12 syntax (method or pseudocode fragments), 9 api-mismatch, 0 ahead-of-release |
| Run | 163 complete, type-clean sources: 64 ran with the scripted model, 45 ran without a model call (samples with their own deterministic model, and function-only graphs), 54 skipped, 0 errors |
| API diff | `results/factcheck-api.json` |
| Behavioral | 8 examples pass |

All 9 api-mismatches are doc errors (`results/mismatch-causes.json`):

- An SDK value imported with `import type`: 6 errors in 4 files.
- `Event`, `createEvent` or `createEventActions` imported from `@google/genai` instead of `@google/adk`: 5 errors in 2 files.
- A `BaseAgent` subclass that lacks `runLiveImpl`: 2 files.
- A plugin hook with positional parameters: 1 file.
- A plain function passed as a tool: 1 file.
- `state.get` with a default narrowing to a literal type: 1 file.

The skipped sources need an external MCP server (42), host code execution (3), a Google Cloud service or Google API OAuth (4), a package outside the pinned set (2), the live API (1), computer use (1) or a third-party credential (1).

## Outcomes

| Outcome | Meaning |
|---|---|
| `ran` | The source, or its probe, exited 0 and made at least one model call (doc sources), or every assertion passed (our examples) |
| `ran-no-model` | It exited 0 without a model call |
| `needs-network` | It failed only because the harness refused a remote host |
| `skipped` | It needs something the harness does not provide; `reason` says what |
| `error`, `timeout` | A real failure, to be triaged |

## Examples

| File | Behavior verified |
|---|---|
| `01-function-tool.ts` | A zod schema becomes a Gemini declaration; bad arguments return `{error}` and the tool body does not run; a string result is wrapped as `{result}`; several calls in one model turn run one after another |
| `02-workflow-agents.ts` | Sequential order with `outputKey` and `{key}` templating; parallel branches; `LoopAgent` stopping at `maxIterations` or `exit_loop`; the 2.5.0 deprecation warnings |
| `03-graph-workflow.ts` | `Workflow` sequences, `route` branching, `JoinNode` fan-in, and `RequestInput` pause and resume |
| `04-sessions-state.ts` | `user:`, `app:` and `temp:` prefixes; `appendEvent` with a `stateDelta`; a fetched `Session` is a copy |
| `05-callbacks.ts` | Before/after agent, model and tool callbacks, including blocking a tool; plugin precedence; the docs' positional plugin hook receiving `context === undefined` |
| `06-structured-output.ts` | `outputSchema` becomes `responseSchema`, and `outputKey` stores the parsed object; invalid output is only logged; `set_model_response` takes over when the agent has tools |
| `07-tool-confirmation.ts` | `requireConfirmation` pauses the call, then approve, reject, the predicate form, and a forged call id |
| `08-triage-agent.ts` | Capstone: a lookup tool that reads identity from session state, an escalation that never runs without approval, and a zod-checked typed result |

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs, and `check:book` fails when a chapter names a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Scripts

| Command | Does |
|---|---|
| `pnpm run fetch-docs` | Mirrors `google/adk-docs` at the commit pinned in `scripts/fetch-docs.mjs` (every Markdown page plus the TypeScript snippets) and `google/adk-js` at tag `main-v2.5.0` (samples, repo guides, READMEs, changelog). Both are Apache-2.0, so the mirror is committed with their licenses. |
| `pnpm run extract` | Pulls every TypeScript source into `extracted/` (gitignored) |
| `pnpm run typecheck:docs` | Compiles every source against the pinned packages and classifies the errors → `results/typecheck-docs.json` |
| `pnpm run triage:docs` | Marks a mismatch `ahead-of-release` when every name it misses is exported or declared as a member on adk-js main and missing from 2.5.0 (needs network), then groups the rest by cause → `results/mismatch-causes.json`, `results/latest-releases.json` |
| `pnpm run run:docs` | Runs or probes complete, type-clean sources on the scripted model → `results/run-docs.json` |
| `pnpm run factcheck` | Diffs `LlmAgent` options, callbacks and plugin hooks, the workflow agents and their deprecation, the graph runtime's names and options, `Runner` and session-service members, and every page's "Supported in ADK" tags against the `.d.ts` files → `results/factcheck-api.json` |
| `pnpm test` | Type-checks and runs our examples → `results/run-examples.json` |
| `pnpm run verify` | All of the above except `fetch-docs` |

`EXAMPLE_TIMEOUT_MS` (default 60000) and `EXAMPLE_CONCURRENCY` (default 4) tune the runner. `--only id1,id2` runs a subset without overwriting the results file.

`results/parity-draft.md` lists the features Python `google-adk` 2.14.1 has that the TypeScript package lacks, has in a weaker form, or documents only for Python.

## Why the docs mirror is from main

The docs mirror pins an adk-docs commit, because the site renders adk-docs main and that repo has no release tags. The adk-js tag `main-v2.5.0` matches the npm `gitHead`. No page runs ahead of 2.5.0:

- No doc source fails only on names that exist on adk-js main. Main exports 46 names that 2.5.0 lacks (`results/latest-releases.json`).
- No "Supported in ADK" tag names a TypeScript version above 2.5.0.

The one main-only name the prose mentions, `AuthenticatedFunctionTool`, appears in Python sections only.

## Gotchas found while building it

- **Transfers looped until the stack overflowed.** ADK hands another agent's tool calls to the next agent as "For context:" user text, so the scripted model could not see an earlier `transfer_to_agent` as a function call. Two agents bounced the transfer back and forth until the run failed with "Maximum call stack size exceeded", before reaching the 500-call `maxLlmCalls` limit. The model now transfers at most once per history.
- **Re-registering models was noisy.** `LLMRegistry.register` logs the full source of each class it replaces at INFO, so the preload lowers the log level while it registers.
- **Mutated counters failed the type-check.** TypeScript narrows a counter after a `=== 0` check, even when a closure changed it later, so the examples compare `Number(x)`.

## Security alerts (2026-11-18)

- **`uuid` (GHSA-w5hq-g745-h8pq, moderate): overridden.** `@google/adk@2.5.0` depends on `@google-cloud/vertexai@1.12.0` (the latest release), which depends on `google-auth-library@9`, then `gaxios@6.7.1` (the latest 6.x), which pins `uuid@^9`. No parent release carries the fix. `pnpm-workspace.yaml` therefore overrides `gaxios@6>uuid` to `11.1.1`, the newest fixed release that keeps the CommonJS entry `gaxios@6` requires; `uuid` 12 and later are ESM-only. Remove the override once vertexai moves to `google-auth-library` 10.
- **`picomatch` (GHSA-fc5q-39xc-vjpf): not from this package.** The one remaining `pnpm audit` alert comes from the Cloudflare harness and is already accepted in `verify/cloudflare-agents/README.md`.
- **Build scripts stay off.** `cpu-features` and `ssh2` (through `dockerode`, for the container code executor) are listed in `ignoredBuiltDependencies`. They are optional native speedups that the offline harness never loads.
