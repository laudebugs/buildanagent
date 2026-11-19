# verify/pi

Offline verification harness for Pi's docs and our examples. No API key is needed: model calls go to pi-ai's first-party `fauxProvider()`.

## How it works

Pi runs its agent loop in-process, so the harness swaps the model rather than the network:
- **Doc examples** run unmodified under `scripts/faux-preload.mjs`, which registers the faux provider in every `ModelRuntime`, substitutes the faux model for catalog lookups, and rejects any non-local `fetch`.
- **Behaviour of the faux model** (`scripts/faux-model.mjs`): after a tool result it answers with text; otherwise it calls one custom tool with arguments synthesised from its schema, or `read` on a fixture. It never calls `bash`, `edit` or `write`.
- **Each run** gets a temp working directory with `fixtures/`, a temp `PI_CODING_AGENT_DIR` whose settings select the faux model, and an allowlisted environment.
- **Extension code** type-checks against `shims/pi-ai-extension-view.ts`, a copy of the `pi-ai` module Pi hands to extensions at run time.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs, and `check:book` fails when a chapter names a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

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
