# verify/pi

Offline verification harness for Pi's docs and our examples. No API key is needed: model calls go to pi-ai's first-party `fauxProvider()`.

## How it works

Pi runs its agent loop in-process, so the harness swaps the model rather than the network:
- **Doc examples** run unmodified under `scripts/faux-preload.mjs`, which registers the faux provider in every `ModelRuntime`, substitutes the faux model for catalog lookups, and rejects any non-local `fetch`.
- **Behaviour of the faux model** (`scripts/faux-model.mjs`): after a tool result it answers with text; otherwise it calls one custom tool with arguments synthesised from its schema, or `read` on a fixture. It never calls `bash`, `edit` or `write`.
- **Each run** gets a temp working directory with `fixtures/`, a temp `PI_CODING_AGENT_DIR` whose settings select the faux model, and an allowlisted environment.
- **Extension code** type-checks against `shims/pi-ai-extension-view.ts`, a copy of the `pi-ai` module Pi hands to extensions at run time.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. The transcript holds each request the example sent, each answer and each `check()` with its result, and, when the call stack shows it, the example line that led to each event.

`scripts/run-examples.mjs` preloads the recorder from [`scripts/transcripts/`](../../scripts/transcripts/), which records each `check()` from the `ok - ` line it prints, and only when the call stack shows `check()` printed it. `examples/lib/faux.ts` wraps each scripted step of the faux provider that `fauxSession()` builds. `examples/lib/transcript.ts` wraps the session's `prompt`, `steer`, `followUp` and `compact`, so a request carries the line of the call that started the run. `04-steering.ts` scripts its own faux provider without `fauxSession()`, so it has no transcript. A system message keeps only the names of its prompt sections, because their text holds the working directory.

Recording only reads what the mock already holds, so it changes no verdict. The writer replaces the run's own directories, and the ids, timestamps and durations the SDK generated, with placeholders. An id the mock's script chose stays as written, and so does everything else an example scripts, such as a tool's input. Two runs on any machine therefore write the same bytes.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

## Scripts

| Command | Does |
|---|---|
| `pnpm run fetch-docs` | Mirror the docs, package READMEs and examples from git tag `v<pinned version>` into `docs/reference/pi/source/` (committed) |
| `pnpm run extract` | Pull every TypeScript block, plus the upstream example files, into `extracted/` (gitignored) |
| `pnpm run typecheck:docs` | Compile each source against the pinned packages, with the extension profile where needed → `results/typecheck-docs.json` |
| `pnpm run run:docs` | Run complete, type-clean sources with the faux model → `results/run-docs.json` |
| `pnpm run factcheck` | Diff settings, session entries, RPC commands, extension events and SDK options against the package → `results/factcheck-api.json` |
| `pnpm test` | Type-check and run our examples in `examples/` → `results/run-examples.json` (non-zero exit on failure) |
| `pnpm run verify` | All of the above except `fetch-docs` |

Tunables: `EXAMPLE_TIMEOUT_MS` (default 60000) and `EXAMPLE_CONCURRENCY` (default 4). Run one example with `node scripts/run-examples.mjs examples --only 04-steering`.
