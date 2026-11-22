# N29: stdio transport and the framing check (HD6)

| Field | Value |
| --- | --- |
| ID | `N29` |
| Status | `done` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N28](../done/N28-server-requests-backpressure.md) |
| Size | S |

## Goal

Serve the dispatcher over JSONL on stdio as `buildanagent rpc`, and run the guide's settling test for the framing with a generic JSON-RPC client and an MCP-style library.

## Context

- [HD6](../../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods): the decision and its evidence
- [harness guide §8](../../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport): stdio JSONL first; no `readline`

## Scope

**In scope**

- `stdioTransport(dispatcher, io)`
- A test client in a child process speaking JSONL
- The framing check with one generic JSON-RPC 2.0 client library and `@modelcontextprotocol/client`'s JSON-RPC layer

**Out of scope** (and which todo covers it)

- CLI subcommands (N30)

## Tasks

- [x] Choose the generic client library at least a week old, as a dev dependency only.
- [x] Spawn the server child with `spawnEnv`.

## Acceptance criteria

- [x] A child-process client completes `initialize`, `turn/start`, receives events and `turn/settled`
- [x] Both libraries parse every server message without adapters
- [x] stdout carries only protocol lines; logs go to stderr
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/server/stdio.test.ts`, `framing-interop.test.ts`.

## Docs to update

`packages/protocol/README.md`: the stdio transport. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If a library needs a framing quirk, record it; do not change the protocol for it.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`stdioTransport(dispatcher, io, options)` in `@buildanagent/harness/server` serves one client over a pair of byte streams, one JSON-RPC 2.0 message per line. `io` is `{ input, output, log? }`: a Node `Readable` or Web `ReadableStream` in, a Node `Writable` or Web `WritableStream` out, and a function for the transport's own diagnostics, which a host points at stderr. `options` is `{ maxLineBytes?, signal? }`. The promise resolves once the client is done. The code is `packages/harness/src/server/stdio.ts`, and the exports are `stdioTransport` and the types `StdioIo`, `StdioOptions`, `StdioInput`, `StdioOutput` and `NodeOutput`. The tests are `packages/harness/test/server/stdio.test.ts` (8) and `framing-interop.test.ts` (3). Their server runs in a child process (`stdio-server.ts`, spawned by `stdio-child.ts`) with a scripted model, the offline setup and `spawnEnv([])`.

**Decisions.**

- **The transport reuses the protocol's framer and envelope check.** It reads with `JsonlFramer`, which splits on `\n` only, checks each message with `decode()` and writes with `encode()`. A second reader would have been a second place for the U+2028 and `\r` rules to drift.
- **A bad line gets an error, and the stream goes on.** A line that isn't JSON gets `ParseError`, and an invalid envelope, a batch or a line over `maxLineBytes` gets `InvalidRequest`. Each error carries the request's id when the framer or `decode()` could read it and `null` otherwise, as JSON-RPC 2.0 asks. Closing the stream on a bad line was the alternative, rejected because the framer already promises that one bad line never stops the rest.
- **The transport answers bad lines itself and bounds those answers.** The dispatcher's `Connection` has no way to send an error for a message it never received, so the transport writes these answers beside the connection's queue. Once 128 wait unwritten, the transport stops, which mirrors N28's rule for refusals. The alternative, a `fail()` on `Connection`, would have widened the dispatcher's API for a transport's concern.
- **Backpressure is the output's.** A Node `write()` that returns `false` makes the connection's `send` return a promise that settles on `drain`, and a Web stream's send waits on `writer.ready` once its queue is full. The connection's queue then drops live events past `queueSize`, as N28 built it. Awaiting every write's callback, the other choice, would have serialised writes behind the kernel for no gain in bound.
- **The end of the input is the client's goodbye.** The transport waits until every command it read has its response queued, then for the queue's last delivery and the output's last write callback, and then closes the connection. It does not wait for running turns: a turn can wait on a `client_request` tool call that a closed input can never answer, and a long turn would keep a gone client's process alive. A client that wants `turn/settled` keeps its input open. A failed or closed output, or an aborted `signal`, stops the transport at once.
- **Commands run concurrently, as in the in-process transport.** The transport hands each message to the connection without waiting for the last one's response, so the 128-command bound and server-request answers work over stdio as they do in process. A client that pipelines `session/create` and `turn/start` without waiting can get `{ accepted: false, reason: "invalid" }`, and both READMEs say to wait.
- **The file is portable.** It takes both stream kinds by their shape and uses no Node module, `Buffer` or `process`, so the gateway's portability scan passes without an exception. The plan's sketch typed the streams as `NodeJS.ReadableStream` and `NodeJS.WritableStream`; the built signature replaces it, and the plan's status line records the change.
- **The transport never ends or closes either stream.** The host owns `process.stdout`, so the host decides when its process exits.

**The generic library is `json-rpc-2.0` 1.8.1.** All four candidates were read from the npm registry on 2026-11-22:

| Package | Version, published | License | Runtime deps | Unpacked | Weekly downloads | Fit |
| --- | --- | --- | --- | --- | --- | --- |
| `json-rpc-2.0` | 1.8.1, 2026-09-20 | MIT | 0 | 59 KB | 13.1 M | A client and a server in one peer, with no transport, so the only glue is splitting lines |
| `vscode-jsonrpc` | 10.0.0, 2026-10-22 (10.0.1 is one day old) | MIT | 0 | 228 KB | 37.4 M | Its stream reader frames with `Content-Length` headers, LSP's base protocol, so JSONL would need a custom reader: an adapter |
| `jayson` | 5.0.0, 2026-09-18 | MIT | 9 (`ws`, `commander`, old `@types/*`) | 170 KB | 3.5 M | Heavy for a test, and its client is per transport |
| `@open-rpc/client-js` | 2.1.0, 2026-08-14 | Apache-2.0 | 3 (`ws` among them) | 276 KB | 0.09 M | A client only, so it cannot answer the server's requests |

`json-rpc-2.0` has no install script (its `scripts` are `test`, `build`, `clean` and `format`), and it is the one new package in the lockfile. `@modelcontextprotocol/client` 2.4.0 (2026-10-23, Apache-2.0, no install script) and its dependencies were already in the lockfile through `verify/cloudflare-agents`, so they add no package. Both are dev dependencies of `@buildanagent/harness` only, pinned exactly. `pnpm audit` finds nothing in either; the two advisories it reports were already on `main` and reach other packages (`zod` through `@anthropic-ai/sandbox-runtime`, `minimatch` through `typedoc`).

**Both libraries read every server message without an adapter.** The framing check runs a turn whose tool needs approval, so the stream holds success and error responses, `event` and `turn/settled` notifications and an `approval/request` that each library answers. `json-rpc-2.0`'s `JSONRPCServerAndClient` takes each line's JSON, resolves our responses to its requests, rejects the unknown-method call with code -32601, and never calls its error listener. MCP's `ReadBuffer` checks each line against MCP's strict JSON-RPC schema, and the test counts its messages against the stdout lines, because `ReadBuffer` skips a non-JSON line without a word.

**Quirks, recorded and left alone, as the todo asks.**

- MCP's schema accepts an error response with no `id` but refuses `"id": null`. JSON-RPC 2.0 requires `null` when the request's id could not be read, so an MCP-based client counts our answer to an unreadable line as invalid. A test pins the behaviour, so a fix upstream shows up.
- MCP's `ReadBuffer` silently skips a line that isn't JSON, so it cannot tell a client that a server wrote a stray log line to stdout. Our own stdout check decodes every line strictly.
- MCP's `StdioClientTransport` spawns its server with `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` from the parent merged under the environment it is given, so the test does not use it: the child gets only `spawnEnv()`'s variables. A host that spawns our server with that transport passes these parent variables on.
- `@modelcontextprotocol/client` reaches `eventsource` and `eventsource-parser`, which ship a `source` export condition that points at TypeScript under `node_modules`. The harness's Vitest config inlines that chain and its `tsconfig.json` allows `.ts` specifiers, as agent-safety's configs already do for `ai`.

**Tests, and the mutation behind each criterion.** Each acceptance criterion's test was checked by breaking the code it covers, and all eleven mutations failed their test:

- A turn over a child process: dropping every `event`, and separately every `turn/settled`, before it is written fails the full-turn test.
- Both libraries: removing `"jsonrpc"` from every line fails all three interop tests, and adding a top-level member fails MCP's strict read.
- stdout only: pointing the child's `log` at stdout, and separately writing a diagnostic to the output, fails the stdout test.
- End of stdin: skipping the drain loses the answers to commands still running when the input ends. A store that lists sessions in 300 ms keeps them running.
- A malformed line: not answering it fails the malformed-line test. A long line: dropping `maxLineBytes` fails the long-line test.
- A client that never reads: ignoring `write()`'s `false` lets stdout's backlog pass the 256 KiB bound, while with backpressure it stayed near 64 KiB for over 2 MB of events.
- The environment: giving the child `process.env` as well fails the environment test, which sets two variables in the parent and finds the child holds only `HOME`, `LANG`, `PATH` and `TMPDIR`.

**Other changes.** The session tests' memory backend moved to `test/session/memory-backend.ts`, which registers no `afterAll` hook, so the child process can load the server helpers; `session-helpers.ts` re-exports it. No changeset: the harness, protocol and CLI are private, and the changeset gate counts only packages that are not, as N28 found.

**Named limits.**

- The transport checks each message's envelope, not its params. The dispatcher reads a command's params without checking them against `protocol.schema.json`, so a command with malformed params gets `InternalError` with the JavaScript error's message.
- The transport authenticates nobody: whoever holds the two streams acts as the dispatcher's user.
- A client that closes its input and never reads its output leaves the transport waiting on the last write. A host that needs a deadline aborts `signal`.
- No test covers a Web stream pair; N44 types the transport over Web streams and adds that case.

**Does N30 need N29 merged first?** Only for its `rpc` subcommand. N30's `buildanagent rpc` imports `stdioTransport`, and the `StdioIo` type if it names one, from `@buildanagent/harness/server`, and calls `stdioTransport(dispatcher, { input: process.stdin, output: process.stdout, log })` with a `log` that writes to stderr. The one-shot JSON mode, line-mode chat and `sessions` commands use the in-process transport and need nothing from N29. N30 can start now and add `rpc` after this merges, or list N29 in its Depends on.

**Open questions for the owner.**

- Should the transport or the dispatcher check each command's params against `protocol.schema.json` before it runs, and answer `InvalidParams` instead of `InternalError`? It would need a runtime validator in the harness, which today has none.
- Should the protocol send `"id": null` for an unreadable line, as JSON-RPC 2.0 requires, or leave `id` out so MCP-based clients accept the error? This todo keeps `null`.
