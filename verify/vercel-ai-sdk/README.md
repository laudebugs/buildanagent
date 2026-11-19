# verify/vercel-ai-sdk

Offline verification harness for the Vercel AI SDK docs and our examples, pinned to `ai@7.0.162`. No API key is needed: every model call goes to `MockLanguageModelV4` from `ai/test`.

## How it works

The SDK runs its tool loop in-process and gets models from provider instances (`openai('…')`, `anthropic('…')`) or from model-id strings that resolve through the global default provider (the AI Gateway). The harness swaps both:
- **Doc examples** run unmodified under `scripts/mock-preload.mjs`. A module hook (`scripts/hooks.mjs`) points `@ai-sdk/openai` and `@ai-sdk/anthropic` at the shims in `shims/`, which re-export the real packages but return mock language models. The preload also sets `globalThis.AI_SDK_DEFAULT_PROVIDER` to a mock provider for string ids, and rejects any non-local `fetch`.
- **The mock model** (`scripts/mock-model.mjs`) answers after a tool result. Otherwise it calls one offered function tool, preferring a tool the prompt names, with arguments built from the tool's JSON Schema. It answers with schema-shaped JSON when the call asks for JSON output. It never calls provider-defined tools, and it denies function tools whose names suggest host access (`bash`, `exec`, `write`, `delete`, …).
- **Each run** gets a temp working directory with `fixtures/`, an allowlisted environment and a timeout.
- **Extraction** fills the docs' `__MODEL__` and `__PROVIDER_IMPORT__` placeholders the way ai-sdk.dev renders them by default: the gateway string `"anthropic/claude-sonnet-5.5"` and no provider import.
- **Our examples** (`examples/`) build their own scripted `MockLanguageModelV4` (`examples/lib/check.ts`) and assert one documented behavior each.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. A transcript records each request the example sent, each response, and each `check()` with its result, with the example line that led to each event when the call stack shows it. `scripts/run-examples.mjs` runs the recorder from [`scripts/transcripts/`](../../scripts/transcripts/), which records the checks from the line each one prints. `examples/lib/transcript.ts` attaches the recorder to `ai/test`'s `MockLanguageModelV4` through its prototype, so `lib/check.ts`'s listed `check` and `scripted` regions hold no recorder code. Streamed calls in `06-streaming.ts` start inside the stream's own machinery, so their requests and responses carry no example line. Recording only reads what the mock already holds, so it changes no verdict. The writer replaces machine paths and the SDK's generated ids, timestamps and durations with placeholders, so two runs on any machine write the same bytes; what an example scripts, such as a tool's input, stays as written.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

## Scripts

| Command | Does |
|---|---|
| `pnpm run fetch-docs` | Mirror the in-scope pages and the license from git tag `ai@<pinned version>` into `docs/reference/vercel-ai-sdk/source/` (committed) |
| `pnpm run extract` | Pull every TypeScript block into `extracted/` (gitignored) |
| `pnpm run typecheck:docs` | Compile every block against the pinned packages and classify errors → `results/typecheck-docs.json` |
| `pnpm run run:docs` | Run complete, type-clean blocks on the mock model → `results/run-docs.json` |
| `pnpm run factcheck` | Diff the reference pages' parameter tables, stop helpers and step-cap default against the package → `results/factcheck-api.json` |
| `pnpm test` | Type-check and run our examples in `examples/` → `results/run-examples.json` (non-zero exit on failure) |
| `pnpm run verify` | All of the above except `fetch-docs` |

Tunables: `EXAMPLE_TIMEOUT_MS` (default 60000) and `EXAMPLE_CONCURRENCY` (default 4). Run one example with `node scripts/run-examples.mjs examples --only 03-tool-approval`.
