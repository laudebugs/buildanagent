# verify/claude-agent-sdk

Offline verification harness for the Claude Agent SDK docs and our examples. No API key is needed: model calls go to a local mock of the Anthropic Messages API.

## How it works

The SDK spawns the bundled `claude` CLI, which honours `ANTHROPIC_BASE_URL`. Pointing that at `scripts/mock-anthropic.mjs` runs the **real** agent loop, permission flow, hooks, MCP and tool-search machinery against a scripted model:
- **After a tool result:** if a `StructuredOutput` tool is offered, answer through it; otherwise reply with text.
- **Before any tool call:** call one custom `mcp__*` tool, preferring one the prompt names, with arguments synthesised from its JSON Schema. If MCP tools are deferred, load them first with `ToolSearch("select:…")`.
- **Skills on request:** if the prompt carries a `[use-skill:<name>]` marker and the `Skill` tool is offered, call it once with that name before anything else. A skill is a read-only file in the example's temp directory.
- **Never** calls built-in tools such as Bash or Edit, so running docs code can't touch the host.

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)).

## Transcripts record each example's run for the book's replays

`pnpm test` also writes `results/transcripts/<example>.json` for each example that calls the mock model. The transcript holds each request the example sent, each answer and each `check()` with its result.

The Claude Code program calls the mock, not the example, so the mock server records the model exchange. `scripts/mock-anthropic.mjs` reports each request and answer to a sink that `scripts/run-examples.mjs` gives it. The example's own process loads the transcript recorder from [`scripts/transcripts/`](../../scripts/transcripts/), which records each `check()` from the `ok - ` line it prints, and only when the call stack shows `check()` printed it. After the process exits, the runner merges the two lists by the time each event happened at. Both processes read one clock, to a fraction of a millisecond. If two events still tie, the mock's comes first, because an example checks an answer after it arrives. An example that times out writes no transcript, so the committed one stays as it was and the timeout fails the run. The program's own events carry no example line, so the replay shows "no source line" for them.

Each request keeps only the conversation: the prompts, the model's answers, and each tool call with its result. The program wraps every request in system reminders and an environment note, which hold the working directory, the OS version and settings, so they differ by machine and by day, and the recorder leaves them out. The tools list names only the example's own MCP tools. The program's built-in tools are its own list, which changes with its version, so the transcript leaves them out. A tool-use id the mock chose stays as written, and the mock counts them per server, so one example's ids do not depend on which examples run beside it. `09-skills.ts` puts its project folder inside the run's own working directory, so its path becomes `<cwd>/skills-project`. Two runs, on one worker or four, write the same bytes.

Record the transcripts as a user other than root. The CLI refuses `bypassPermissions` as root, so `03-permission-order.ts`'s query c) never reaches the model there, and a transcript recorded as root would differ from CI's. A root run writes no transcript and says so.

Commit the transcripts with the change that alters them, unlike a regenerated `run-examples.json`, which holds local paths and is restored before committing. CI's results-drift check fails when a committed transcript differs from the one a fresh run writes, and the book's replays read these files ([replays](../../apps/manual/README.md#a-replay-steps-through-a-recorded-run)).

## Two examples read what reached the model

Both read the mock's request log through `examples/lib/mock-log.ts` and assert on what each request carried.

- `08-deferred-tools.ts` shows that a tool's definition reaches the model only after the model calls `ToolSearch`. The default run sends three MCP tools by name only, then one full definition after the search. A second run sets `alwaysLoad: true` on the server and sends all three up front. The run leaves `ToolSearch` as the only built-in tool (`tools: ["ToolSearch"]`).
- `09-skills.ts` writes two skills into a temp directory and enables one with `skills: ["lisbon-weather"]`. The first request lists that skill's name and description and nothing of its body. The body arrives in the `Skill` tool's result and then is in every later request. The skill left out of `skills` never reaches the model. `settingSources: ["project"]` is required: without it the CLI lists no skill.

The mock chooses which tool to load and which skill to read, as a stand-in for the model's judgement, so these examples assert what the SDK sends and when, not that a model chooses well. Both carry `// #region` and `// book:note` markers for the book.

## One example shows a refusal the SDK records

`10-refusals-are-recorded.ts` calls `send_email` on an MCP server that no rule allows, with no `canUseTool` callback to ask. The CLI refuses the call, so the tool never runs. The model's next request carries the refusal as an error result, and the run ends `success` with the call in `result.permission_denials`, which the SDK's types call the authoritative record of refusals.

A second run, with `allowedTools` naming `read_notes`, runs that tool and leaves `permission_denials` empty. The example carries `// #region refusal` and `// book:note` markers.

It shows a permission refusal and not an operating-system sandbox. The SDK's `sandbox` option isolates command execution, and the mock never calls built-in host tools such as `Bash`, so a sandbox run would need a real shell command on the host. Chapter T22 gets a refusal the SDK enforces and records, and the sandbox tier stays the chapter's prose.

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

## A live run sends the CLI's calls through a proxy that alone holds the key

The book's occasional live run ([`scripts/live/`](../../scripts/live/), started only by `.github/workflows/live-run.yml`) calls `scripts/run-examples.mjs examples --only <example> --live`. The `claude` CLI, not the example, makes every model call, so the cost guard and the host-tool check that other harnesses run in the example's process can't see them there. Instead, the runner starts [`scripts/live/proxy.mjs`](../../scripts/live/proxy.mjs) in its own process and runs the example, with the CLI it spawns, inside `unshare -rn`, a network namespace whose only interface is loopback. The proxy is then the only route to the provider and the only code that holds the key.

The key reaches the proxy and nothing else. `run.mjs` writes the key to a file, and the proxy reads the file and deletes it when it loads (`scripts/live/live.ts`). Beyond the runner's usual allowlist, the example's environment gains only `LIVE`, the provider, the model and the proxy's socket path, never `LIVE_API_KEY_FILE`. Inside the namespace, `scripts/live-preload.mjs` starts a forwarder from the namespace's loopback interface to the proxy's Unix socket ([`scripts/live/forward.mjs`](../../scripts/live/forward.mjs)). It then points the CLI at that forwarder with `ANTHROPIC_BASE_URL` and a placeholder key. The CLI receives each answer's status, content type and body, with the key taken out of the body, but none of the provider's headers, so the account and request ids stay with the proxy. After the run, the runner deletes the example's temporary home, where the CLI keeps its session files.

The live mode offers no host tool, and the proxy refuses any request that does. The preload rewrites the CLI's arguments to `--tools=ToolSearch`, as the SDK's `tools: ["ToolSearch"]` would send, whatever the example asked for. `ToolSearch` only looks up the session's deferred tools, and the mock transcripts' flows start with it. The preload also tells the CLI to load no settings (`--setting-sources=`) and only the MCP servers its arguments name (`--strict-mcp-config`). It stops an example that asks for project or user settings, a plugin directory or a settings file, because those run hooks, plugins and stdio servers from the host's files. It builds the CLI's environment from a list of names and the SDK's own `CLAUDE_*` variables, not from the whole of the example's. It also stops an example with an MCP server that is not the SDK's in-process kind, in any of its `--mcp-config` arguments, and one whose config is not inline JSON, which it can't inspect. For each request, the proxy then checks three things before it forwards it:

- **Tools.** Every tool must be an example's own `mcp__*` tool or one of the CLI's three built-ins that do nothing on the host: `ToolSearch`, `DeferredToolPlaceholder` and `StructuredOutput` ([`scripts/live-tools.mjs`](scripts/live-tools.mjs)). `denyHostTools` also refuses the shared host-tool names and any tool whose type is other than `custom`, such as Anthropic's server tools.
- **Fields.** A body field outside the proxy's list stops the request, so a field such as `mcp_servers` or `container` never reaches the provider. The proxy drops `metadata`, which carries the machine's device id.
- **Cost.** The proxy sets the run's model, caps `max_tokens` at the run's `maxTokens`, and checks the call against the cost guard before it sends it. The ledger holds the call's projected cost as in flight until the proxy settles it with the usage the answer reports. Calls that overlap, and a call that a killed run never settled, therefore still count against the cap. A thinking budget that the cap leaves too large goes, together with the edits that clear earlier thinking and the thinking blocks in the history. That the API refuses a request that keeps them is an inference from its documentation, not a result: no run here called it.

A refused request fails the example, and the runner prints the reason. The proxy records each call it forwards as the mock does, so the live transcript in `results/live/<example>.json` has the shape of the mock one. A call that fails, or that the CLI retries, adds nothing to it: a request joins the transcript with its answer once the provider answers 2xx. When the runner gets SIGTERM or SIGINT, or exits, it stops every example's process group, because the example runs in its own group. The proxy also logs each request body it sent to the mock's request log, so `examples/lib/mock-log.ts` works in a live run too. Some checks depend on the mock's deterministic tool choice, so a real model may fail them.

`scripts/ci/live-run.test.mjs` runs `02-custom-tool.ts` live against a stub provider on the loopback interface and checks that its flow matches the mock transcript. It also checks that no key, account id or request id reaches a written file, the request log or the output. Without `--live`, none of this code runs, so `pnpm test` and the committed transcripts are unchanged.
