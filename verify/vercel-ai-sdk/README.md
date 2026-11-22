# verify/vercel-ai-sdk

Offline verification harness for the Vercel AI SDK docs and our examples, pinned to `ai@7.0.162`. No API key is needed: every model call goes to `MockLanguageModelV4` from `ai/test`.

## How it works

The SDK runs its tool loop in-process and gets models from provider instances (`openai('…')`, `anthropic('…')`) or from model-id strings that resolve through the global default provider (the AI Gateway). The harness swaps both:
- **Doc examples** run unmodified under `scripts/mock-preload.mjs`. A module hook (`scripts/hooks.mjs`) points `@ai-sdk/openai` and `@ai-sdk/anthropic` at the shims in `shims/`, which re-export the real packages but return mock language models. The preload also sets `globalThis.AI_SDK_DEFAULT_PROVIDER` to a mock provider for string ids, and rejects any non-local `fetch`.
- **The mock model** (`scripts/mock-model.mjs`) answers after a tool result. Otherwise it calls one offered function tool, preferring a tool the prompt names, with arguments built from the tool's JSON Schema. It answers with schema-shaped JSON when the call asks for JSON output. It never calls provider-defined tools, and it denies function tools whose names suggest host access (`bash`, `exec`, `write`, `delete`, …).
- **Each run** gets a temp working directory with `fixtures/`, an allowlisted environment and a timeout.
- **Extraction** fills the docs' `__MODEL__` and `__PROVIDER_IMPORT__` placeholders the way ai-sdk.dev renders them by default: the gateway string `"anthropic/claude-sonnet-5.5"` and no provider import.
- **Our examples** (`examples/`) build their own scripted `MockLanguageModelV4` (`examples/lib/check.ts`) and assert one documented behavior each.
- **Usage and price** (`10-streaming-usage.ts`, `11-tuned-vs-cached.ts`) pass `scripted()` a usage object that holds all four token classes, then price it in whole nano-dollars from the rate tables in `examples/lib/rates.ts` and the second example, dated November 2026. The second prices a tuned model against a cached prompt and creates no tuning job.
- **The retries, caching and budget example** (`examples/12-retries-caching-budget.ts`) shows three behaviours: a retry after a retryable error (with `retry-after-ms: "0"`, so no real wait), cache-read tokens on a repeated prefix, and a `wrapLanguageModel` budget that refuses a call before it reaches the model. It runs each twice: against a scripted model, and through `@ai-sdk/anthropic` with a stub `fetch` that answers in the Messages wire format, so it needs no network or mock server. Only the scripted run leaves its request and answer in the transcript. The recorder attaches to `ai/test`'s mock model, which `createAnthropic` bypasses, so the Messages-format run records only its `check()` results. Prices are Claude Sonnet 5.5's as of November 2026.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. The transcript holds each request the example sent, each answer and each `check()` with its result, and, when the call stack shows it, the example line that led to each event.

`scripts/run-examples.mjs` preloads the recorder from [`scripts/transcripts/`](../../scripts/transcripts/), which records each `check()` from the `ok - ` line it prints, and only when the call stack shows `check()` printed it. `examples/lib/transcript.ts` attaches the recorder to `ai/test`'s `MockLanguageModelV4` through its prototype, so `lib/check.ts`'s listed `check` and `scripted` regions hold no recorder code. Streamed calls in `06-streaming.ts` start inside the stream's own machinery, so their requests and answers carry no example line.

A transcript holds no usage, and it names each model `model-1`, `model-2` and so on, so a replay of the two pricing examples shows their requests, answers and `check()` lines but not the token classes, the prices or which call used the tuned model. The chapter reads those from the listing. T11's risks list a follow-up to T5's work that adds each call's usage to the format.

Recording only reads what the mock already holds, so it changes no verdict. The writer replaces the run's own directories, and the ids, timestamps and durations the SDK generated, with placeholders. An id the mock's script chose stays as written, and so does everything else an example scripts, such as a tool's input. Two runs on any machine therefore write the same bytes.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

## A live run sends one example to a real provider

The book's occasional live run ([`scripts/live/`](../../scripts/live/), started only by `.github/workflows/live-run.yml`) calls `scripts/run-examples.mjs examples --only <example> --live`. In that mode `scripted()` in `examples/lib/check.ts` returns the `MockLanguageModelV4` from `examples/lib/live.ts` instead of playing its turns, so the listed `scripted` region holds the two lines that make the switch. That model records each request in `requests`, as the script's does, and forwards the call to the pinned `@ai-sdk/anthropic` or `@ai-sdk/openai` with the key passed explicitly. Each call has its output capped at the run's `maxTokens`, is refused when it offers a provider-defined tool, and goes through the cost guard first. The answer keeps only its content, finish reason, usage and warnings, so no response header or id reaches the transcript, which goes to `results/live/<example>.json`. Without `--live`, nothing in the live mode runs, so `pnpm test` and the committed transcripts are unchanged.

## One example kills a write between the server's reply and its log

`15-write-crash-idempotency.ts` runs a `charge` tool that logs an idempotency key before it calls a fake payment server, then logs an outcome. A normal write reports `applied`, a repeat of it is answered from the log with no request, and a write the server declines with a 402 reports `not_applied`. Any other failure, such as a 503 after the server committed, leaves the write `unknown`. 

A child process then runs the same tool and kills itself after the server's reply and before it logs the outcome. The parent reads the log, finds a key with no outcome, and calls that state `unknown`.

A fresh run of the tool reads the same log, asks the server instead of writing again, reports `applied` with `reconciled: true`, and the server has seen exactly one write for that order. Only a 404 would show that the write never arrived, and only then is it sent, under the same key.

The effect log is a small file in a temp folder that the example makes and removes, and it is the only file the tool writes. It survives a killed process, not a power cut. The server counts every request a key sends apart from its writes, so a second request cannot hide. The five outcome names come from our own design. The AI SDK has no idempotency or effect-log feature, so this shows what a tool has to do around the SDK, not something the SDK does. The child process gets an allowlisted environment, runs the example's own file with the parent's `execArgv`, and records no transcript, so the transcript holds the parent's model calls only. The example carries `// #region` and `// book:note` markers for Chapter T23.

## One example reads a run's spans and grades its answer with a scripted judge

`16-tracing-and-judge.ts` runs a tool loop with the `OpenTelemetry` integration from `@ai-sdk/otel`, which sends its spans to an in-memory exporter from `@opentelemetry/sdk-trace`. The example reads the tree back. One agent span is the root, each step is its child, and each model call and tool call is a child of a step. The model calls carry their own token counts, and the agent span carries the total.

A second scripted model plays the judge. It answers with a score from 0 to 1 and a pass or fail grade, and the grading code parses the text into a verdict. The code rejects text that is not JSON, a score out of range, a grade that is neither pass nor fail, and a missing reason. It also rejects a grade that contradicts the score: a pass below the mark of 0.7, or a fail at it. The judge is scripted, so the example tests the grading code and says nothing about how well a real model judges. The example carries `// #region` and `// book:note` markers for Chapter T25.

## One example ranks a fixture of support documents with BM25 and checks where keyword search fails

`17-keyword-retrieval.ts` gives a tool loop a `search_docs` tool that ranks `fixtures/support-docs.json`, fourteen short documents from two tenants, with BM25 written in the example. It uses no search package and no embedding API. The tool takes the tenant from the session, not from the model, filters the documents to that tenant, and only then ranks them.

Four checks show what keyword search does. An exact identifier, the error code E4021, finds its one document. A paraphrase that shares no word with its document, "I forgot my login credentials" for a document on resetting a password, finds nothing, though the same need in the document's words ranks it first. A tenant filter keeps the other tenant's near-duplicate of the E4021 document out of the results, and each tenant's answer comes from its own document. The filter runs before ranking, and a check shows why that matters: across both tenants "export" is a common word and another tenant's document takes a place in the top three, while within one tenant it is rare and the ranking differs, so filtering afterwards fails the check. A further check shows a rare word outranking a common one that a document repeats more often, and another sends a result with quotation marks to the model intact. A planted document that repeats a question's words outranks the real answer. The scripted model's second turn is defined to repeat the first result, so it follows the planted document's instruction. The same question with the planted document removed gets the real answer.

The checks read the tool's recorded calls (its tenant, query and returned ids) and the ranked lists, and a last check finds that every model request offered only the `search_docs` function tool. The model is scripted, so the example tests the retriever and what reaches the model, not how a real model would answer. The planted document is our own construction, not a measured attack. The example has no hybrid variant: it has no vector search, so it shows keyword search's failure without a repair. It carries `// #region` and `// book:note` markers for Chapter T36.

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
