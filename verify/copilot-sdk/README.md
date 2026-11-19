# verify/copilot-sdk

Offline verification harness for the GitHub Copilot SDK docs and our own examples, pinned to **`@github/copilot-sdk@1.0.31`** (MIT, published 2026-11-10) and the Copilot runtime **1.0.109** that the SDK bundles. No GitHub account, token or model API key is needed: the real runtime runs its real agent loop, and every model call goes to a local mock.

## What is real and what is mocked

The SDK spawns the Copilot runtime as a child process and drives it over JSON-RPC on stdio (`vscode-jsonrpc`). The harness mocks only the model, one layer below the runtime:

| Layer | In this harness |
|---|---|
| `@github/copilot-sdk` (client, sessions, tool and permission callbacks) | Real, 1.0.31 |
| Copilot runtime (`copilot-runtime` + `runtime.node` from the optional `@github/copilot-sdk-linux-x64` package) | Real, 1.0.109: the agent loop, built-in tool registry, tool filters, permission flow, hooks, MCP client, session store and resume |
| JSON-RPC between them | Real |
| Model provider | **Mocked**: `scripts/mock-model.mjs`, an Anthropic Messages API on `127.0.0.1`, reached through the SDK's BYOK `provider: { type: "anthropic", baseUrl }` |
| GitHub (auth, Copilot API, telemetry, the GitHub MCP server) | Unreachable: blocked by the network namespace |

The seam is the SDK's documented BYOK provider (`docs/auth/byok.md`: BYOK "bypasses GitHub Copilot authentication"). The Copilot CLI's own `COPILOT_PROVIDER_BASE_URL`/`COPILOT_PROVIDER_*` environment variables do not apply to SDK sessions: with only those set, `createSession` fails with "No GitHub OAuth token or Copilot HMAC key provided" (checked 2026-11-18). So `scripts/sandbox-preload.mjs` injects the provider into every `createSession`/`resumeSession` call. It replaces any provider a docs example sets (Azure, Ollama), and our examples set the mock provider themselves.

The SDK pins its runtime: `package.json` has `copilotCliVersion: "1.0.109"` and `copilotRuntime.sourceSha` `6bbff9d…`, the same commit as `@github/copilot@1.0.109`'s `buildMetadata.gitCommit`. The harness therefore does not install `@github/copilot` separately.

## Safety

The Copilot runtime is a coding agent with shell, file-edit and web tools, so every run is boxed in several ways:
- **Network.** Each example runs under `unshare -rn` in a new network namespace whose only interface is loopback, so neither the example nor the native runtime can reach any host. `run-examples.mjs` refuses to run if `unshare -rn` or a way to bring loopback up (`ip`, or `python3 -I`) is missing. The preload also rejects non-local `fetch()`.
- **Environment.** Children get an allowlisted environment (`PATH`, a temp `HOME` and `TMPDIR`, `LANG`, `MOCK_LOG`, `FIXTURES`, plus `COPILOT_TELEMETRY_DISABLED=true`, `COPILOT_AUTO_UPDATE=false`, `COPILOT_DISABLE_LOGIN_SHELL_ENV=1`); never `...process.env`, so no `GH_TOKEN`, `GITHUB_TOKEN`, proxy or host config reaches them. The working directory is a fresh temp dir inside that `HOME`, and the runtime's `~/.copilot` lands there too.
- **Model.** The mock calls only tools the preload allowed: SDK tools whose handler source shows no host effects (no `child_process`, `exec`, `spawn`, file writes) and that don't override a built-in, plus tools of MCP servers that run our own fixtures. `BUILTIN_DENY` in `mock-model.mjs` also denies the runtime's host tools by name (`bash`, `view`, `create`, `edit`, `apply_patch`, `web_fetch`, `sql`, `grep`, `glob`, `task`, `github-*` and more), even when a custom tool overrides one.
- **Self-check.** `examples/00-sandbox.ts` asserts that no credential or proxy variable is present, `HOME` is not the real home, a raw TCP connection to a GitHub address fails with `ENETUNREACH`, DNS fails, and loopback still works.

The harness runs on Linux only (user and network namespaces).

## Region markers feed the book's listings

Some examples carry `// #region <name>` and `// #endregion` comments, which change no behaviour. The book's `::listing` directive shows the code between them, so a chapter quotes only code that `pnpm test` type-checks and runs. Rename or remove a region only together with the chapters that list it, because `check:book` fails on a region that no longer exists ([how to add a listing](../../apps/manual/README.md#a-listing-shows-a-region-of-a-real-file)). This harness has no transcript recorder yet, so the book cannot replay its examples (T5's outcome says why).

## Scripts

| Command | Does |
|---|---|
| `pnpm run fetch-docs` | Mirror the docs from `github/copilot-sdk` at tag `v1.0.31` into `docs/reference/copilot-sdk/source/` (committed; MIT) |
| `pnpm run extract` | Pull every TypeScript/JS block (440 from 53 pages) and the 15 TypeScript example files into `extracted/` (gitignored), recording each block's upstream `docs-validate` marker |
| `pnpm run typecheck:docs` | Compile each source against the pinned SDK and classify errors → `results/typecheck-docs.json`. A second pass re-checks fragments with the missing `client`/`session` declared (`withPrelude`) |
| `pnpm run triage:docs` | Group API mismatches from both passes by cause → `results/mismatch-causes.json` |
| `pnpm run run:docs` | Run complete, type-clean blocks in the sandbox against the mock → `results/run-docs.json` |
| `pnpm run factcheck` | Diff the documented surface (root exports, client options, session config, methods, events, tool fields, permission kinds, hooks, `ProviderConfig`) against the `.d.ts` → `results/factcheck-api.json` |
| `pnpm test` | Type-check and run our examples in `examples/` → `results/run-examples.json` (non-zero exit on failure) |
| `pnpm run verify` | All of the above except `fetch-docs` |

Tunables: `EXAMPLE_TIMEOUT_MS` (default 30000 for docs, 90000 for ours) and `EXAMPLE_CONCURRENCY` (default 4). Run one example with `node scripts/run-examples.mjs examples --only 09-triage-agent --verbose`.

### The mock model

Within a user turn the mock calls, once each and in prompt order, the callable tools the prompt names; if the prompt names none it calls the first callable tool once. It then answers with text, followed by the tool results it saw. Prompt lines steer it: `mock-args <tool> <json>` sets a call's arguments, `mock-reply: <text>` sets the answer, and `mock-no-tools` skips tool calls. When the request carries `output_config.format` (structured output), the answer is JSON only. Every request is logged to `MOCK_LOG`, which `examples/lib/harness.ts` reads back.

### Docs runs

A docs block counts as having run once its last statement executes; the runner then waits 3 s and stops it, because many blocks never call `client.stop()` and the runtime child keeps the process alive. Blocks are skipped when they need what the offline harness can't provide: an external MCP process or remote endpoint, an already-running runtime (`forUri`), a cloud session or AHP host, third-party credentials or packages, names the host app must `declare`, stdin, or a CLI installed at a fixed path.

## Results (2026-11-18)

| Tier | Result |
|---|---|
| Type-check | 455 sources: 132 pass, 298 fragments, 19 syntax fragments (object-literal snippets), 6 API mismatches. With `client`/`session` declared, 218 fragments re-checked: 138 pass, 44 still fragments, 36 API mismatches |
| Mismatch causes | Hook handlers that `return null` (51 errors in 37 files), hook types imported from the package root that it doesn't export (15 in 5), `ToolResultObject` fields that don't exist (4 in 3) |
| Offline runs | 83 complete, type-clean blocks: 15 ran with model calls, 35 ran without one, 30 skipped, 3 failed (2 docs errors: `client.rpc` before `start()`; 1 environment: `plugins.retryManaged` needs managed settings) |
| API diff | 11 documented root imports that the package doesn't export; 10 `model.*` event types the runtime emits that `SessionEvent` doesn't type; README covers 22 of 98 session-config fields |
| Behavioral | 9 examples plus the sandbox self-check, all passing offline in about 3 s |

## Behavioral examples

| Example | Asserts |
|---|---|
| `00-sandbox` | The sandbox itself (see Safety) |
| `01-hello-session` | `sendAndWait` returns the final `assistant.message`; events arrive `user.message → assistant.turn_start → assistant.message → assistant.turn_end → session.idle`; built-ins (`bash` included) are offered by default |
| `02-custom-tool` | `defineTool` + Zod: JSON Schema reaches the model, the handler gets parsed args, `onPermissionRequest` sees kind `custom-tool`, the result reaches the model |
| `03-permission-deny` | `{ kind: "reject", feedback }` stops the handler and the model sees the feedback; with no `onPermissionRequest` the call is denied at once, not left pending as documented |
| `04-restrict-builtins` | `availableTools`/`excludedTools`/`ToolSet`/`BuiltInTools.Isolated` decide the offered tools, `excludedTools` wins; `mode: "empty"` rejects a session without `availableTools` |
| `05-streaming` | `streaming: true` emits `assistant.message_delta` chunks that concatenate to the final message; none without it |
| `06-resume-session` | A new client lists and resumes a stopped session from `baseDirectory`, history carries over, custom tools don't; `listSessions` before `start()` throws |
| `07-mcp-server` | A stdio MCP server's tools appear as `<server>-<tool>`, ask permission with kind `mcp`, return results; `tools: []` offers none |
| `08-hooks` | `onPreToolUse` runs before `onPermissionRequest` and can deny; `onPostToolUse` can replace the result; returning `null` works at runtime |
| `09-triage-agent` | Capstone: no built-ins, a read-only lookup (`skipPermission`) whose identity comes from trusted context even when the model sends a `customerId`, an escalation left pending with `no-result` and decided later through `permissions.handlePendingPermissionRequest`, and a Zod-typed `sendAndWait(prompt, schema)` result that throws on a schema mismatch |

## Live runs (later)

To run an example against a real model, run it without `scripts/sandbox-preload.mjs`, replace `mockProvider()` with a real provider (or GitHub authentication), and keep `availableTools` restricted. Assertions on the mock's request log will need loosening.
