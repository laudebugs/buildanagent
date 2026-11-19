# verify/openai-agents-sdk

Offline verification harness for the OpenAI Agents SDK (JS) docs and our examples, pinned to `@openai/agents@0.21.0`. No API key is needed: model calls go to the SDK's own `ScriptedModel` from `@openai/agents/testing`.

## How it works

The SDK runs its agent loop in-process and resolves model names through a default `ModelProvider`, so the harness swaps the provider rather than the network:
- **Doc examples** run unmodified under `scripts/scripted-preload.mjs`. It imports `@openai/agents` (which installs the OpenAI provider), replaces that provider with a scripted one through `setDefaultModelProvider()`, and rejects any non-local `fetch`.
- **The scripted model** (`scripts/scripted-model.mjs`) is a `ScriptedModel` of `modelResponder()` steps. After a tool result it answers; otherwise it calls one function tool with arguments built from its JSON Schema. It answers with schema-shaped JSON when the agent has an `outputType`, and never calls hosted, computer, shell or apply-patch tools.
- **Each run** gets a temp working directory with `fixtures/`, an allowlisted environment with `OPENAI_AGENTS_DISABLE_TRACING=1`, and a timeout. Sandbox examples run from their own folder, because they mount sibling folders relative to it.
- **Extraction** copies `examples/` with its layout, so the docs' `?raw` imports and the files' relative imports resolve, and marks the copies as ESM, as a reader's project would be.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. The transcript holds each request the example sent, each answer and each `check()` with its result, and, when the call stack shows it, the example line that led to each event.

`scripts/run-examples.mjs` preloads the recorder from [`scripts/transcripts/`](../../scripts/transcripts/), which records each `check()` from the `ok - ` line it prints, and only when the call stack shows `check()` printed it. `examples/lib/transcript.ts`, which `lib/check.ts` imports, wraps `@openai/agents/testing`'s `ScriptedModel`.

Recording only reads what the mock already holds, so it changes no verdict. The writer replaces the run's own directories, and the ids, timestamps and durations the SDK generated, with placeholders. An id the mock's script chose stays as written, and so does everything else an example scripts, such as a tool's input. Two runs on any machine therefore write the same bytes.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

## A live run sends one example to a real provider

The book's occasional live run ([`scripts/live/`](../../scripts/live/), started only by `.github/workflows/live-run.yml`) calls `scripts/run-examples.mjs examples --only <example> --live`. In that mode the runner preloads `examples/lib/live-register.mjs`, a Node.js resolve hook that hands every import of `@openai/agents/testing` in `examples/` the module `examples/lib/live.ts`. Its `ScriptedModel` ignores the script it is given and answers each call from the Responses API through the pinned `@openai/agents-openai`, with the key passed explicitly. The example's `calls`, `firstCall`, `lastCall` and `assertComplete()` therefore work as they do against a script. Each call has its output capped at the run's `maxTokens`, is refused when it offers a hosted tool such as shell, computer use or code interpreter, and goes through the cost guard first. The answer keeps only its output and usage, without the response and request ids, and the transcript goes to `results/live/<example>.json`. Without `--live`, nothing in the live mode runs, so `pnpm test` and the committed transcripts are unchanged.

## Scripts

| Command | Does |
|---|---|
| `pnpm run fetch-docs` | Mirror the English docs, `examples/docs` and the license from git tag `v<pinned version>` into `docs/reference/openai-agents-sdk/source/` (committed) |
| `pnpm run extract` | Copy the example files and pull inline TypeScript blocks into `extracted/` (gitignored), mapping each file to the pages that embed it |
| `pnpm run typecheck:docs` | Compile every source against the pinned packages and classify errors → `results/typecheck-docs.json` |
| `pnpm run run:docs` | Run complete, type-clean sources on the scripted model → `results/run-docs.json` |
| `pnpm run factcheck` | Diff the guides' option tables, stream events and error list against the package → `results/factcheck-api.json` |
| `pnpm test` | Type-check and run our examples in `examples/` → `results/run-examples.json` (non-zero exit on failure) |
| `pnpm run verify` | All of the above except `fetch-docs` |

Tunables: `EXAMPLE_TIMEOUT_MS` (default 60000) and `EXAMPLE_CONCURRENCY` (default 4). Run one example with `node scripts/run-examples.mjs examples --only 05-approval-resume`.
