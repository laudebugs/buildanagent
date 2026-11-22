# verify/claude-agent-sdk

Offline verification harness for the Claude Agent SDK docs and our examples. No API key is needed: model calls go to a local mock of the Anthropic Messages API.

## How it works

The SDK spawns the bundled `claude` CLI, which honours `ANTHROPIC_BASE_URL`. Pointing that at `scripts/mock-anthropic.mjs` runs the **real** agent loop, permission flow, hooks, MCP and tool-search machinery against a scripted model:
- **After a tool result:** if a `StructuredOutput` tool is offered, answer through it; otherwise reply with text.
- **Before any tool call:** call one custom `mcp__*` tool, preferring one the prompt names, with arguments synthesised from its JSON Schema. If MCP tools are deferred, load them first with `ToolSearch("select:…")`.
- **Skills on request:** if the prompt carries a `[use-skill:<name>]` marker and the `Skill` tool is offered, call it once with that name before anything else. A skill is a read-only file in the example's temp directory.
- **Never** calls built-in tools such as Bash or Edit, so running docs code can't touch the host.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)). This harness has no transcript recorder yet, because its mock answers over HTTP to the `claude` CLI, which the SDK runs in a child process, so the book cannot replay its examples; [T49](../../docs/todos/ready/T49-book-http-mock-transcripts.md) adds one.

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. The transcript holds each request the example sent, each answer and each `check()` with its result.

The Claude Code program calls the mock, not the example, so the mock server records the model exchange. `scripts/mock-anthropic.mjs` reports each request and answer to a sink that `scripts/run-examples.mjs` gives it. The example's own process loads the transcript recorder from [`scripts/transcripts/`](../../scripts/transcripts/), which records each `check()` from the `ok - ` line it prints, and only when the call stack shows `check()` printed it. After the process exits, the runner merges the two lists by the millisecond each event happened at, with the mock's event first when two share one, because an example checks an answer after it arrives. The program's own events carry no example line, so the replay shows "no source line" for them.

Each request keeps only the conversation: the prompts, the model's answers, and each tool call with its result. The program wraps every request in system reminders and an environment note, which hold the working directory, the OS version and settings, so they differ by machine and by day, and the recorder leaves them out. The tools list names the tools the request offers, as the program's pinned version sends them. A tool-use id the mock chose stays as written, and the mock counts them per server, so one example's ids do not depend on which examples run beside it. `09-skills.ts` puts its project folder inside the run's own working directory, so its path becomes `<cwd>/skills-project`. Two runs, on one worker or four, write the same bytes.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

## Two examples read what reached the model

Both read the mock's request log through `examples/lib/mock-log.ts` and assert on what each request carried.

- `08-deferred-tools.ts` shows that a tool's definition reaches the model only after the model calls `ToolSearch`. The default run sends three MCP tools by name only, then one full definition after the search. A second run sets `alwaysLoad: true` on the server and sends all three up front. The run leaves `ToolSearch` as the only built-in tool (`tools: ["ToolSearch"]`).
- `09-skills.ts` writes two skills into a temp directory and enables one with `skills: ["lisbon-weather"]`. The first request lists that skill's name and description and nothing of its body. The body arrives in the `Skill` tool's result and then is in every later request. The skill left out of `skills` never reaches the model. `settingSources: ["project"]` is required: without it the CLI lists no skill.

The mock chooses which tool to load and which skill to read, as a stand-in for the model's judgement, so these examples assert what the SDK sends and when, not that a model chooses well. Both carry `// #region` and `// book:note` markers for the book.

## Scripts

| Command | Does |
|---|---|
| `pnpm run fetch-docs` | Mirror the 32 agent-sdk pages from `code.claude.com/docs/llms.txt` into `docs/reference/claude-agent-sdk/source/` (gitignored) |
| `pnpm run extract` | Pull every TypeScript block into `extracted/` (gitignored), with `_manifest.json` |
| `pnpm run typecheck:docs` | Compile each block against the pinned SDK and classify errors → `results/typecheck-docs.json` |
| `pnpm run run:docs` | Run complete, type-clean blocks against the mock (fresh temp cwd, fixtures, placeholder-path substitution, timeout) → `results/run-docs.json` |
| `pnpm run factcheck` | Diff `typescript.md` against `sdk.d.ts`: functions, Options, PermissionMode, HookEvent, SDKMessage, tool schemas → `results/factcheck-api.json` |
| `pnpm test` | Type-check and run our examples in `examples/` → `results/run-examples.json` (non-zero exit on failure) |
| `pnpm run verify` | All of the above except `fetch-docs` |

Tunables: `EXAMPLE_TIMEOUT_MS` (default 60000) and `EXAMPLE_CONCURRENCY` (default 4). Run one example with `node scripts/run-examples.mjs examples --only 03-permission-order`.

## Live runs (later)

To run an example against the real API, unset `ANTHROPIC_BASE_URL`, set `ANTHROPIC_API_KEY`, and run `pnpm exec tsx examples/<file>.ts`. Keep `maxTurns` and `maxBudgetUsd` set. Some assertions depend on the mock's deterministic tool choice and may need loosening for a real model.
