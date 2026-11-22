# N26: Protocol package: the typed union, framing and the generated JSON Schema

| Field | Value |
| --- | --- |
| ID | `N26` |
| Status | `done` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N2](../done/N2-session-entries-schema.md), [B11](../done/B11-loop-core.md), [B15](../done/B15-signed-pauses.md) |
| Size | M |

## Goal

Define the harness protocol once, as a discriminated TypeScript union with strict JSON-RPC 2.0 framing, a JSONL framer that is safe for U+2028, and a generated JSON Schema that other-language clients can use alone.

## Context

- [HD6](../../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods): the decision and its evidence
- [ADR 0016](../../decisions/0016-protocol-json-rpc-framing.md): the decision records
- [harness guide §8](../../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport): one union, `jsonrpc`, framing rules
- [build-harness.md §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the API sketch

## Scope

**In scope**

- `ClientCommand`, `InitializeResult`, `Disposition`, `ServerRequest`, `ServerNotification`, `HarnessEvent`, `ErrorCodes`
- `JsonlFramer` splitting on `\n` only, with a maximum line size
- `encode()` and `decode()` that validate `jsonrpc: "2.0"`
- `schema/protocol.schema.json`, generated and committed, with a staleness test
- Fixtures for every message, validated against the schema and type-checked with `satisfies`

**Out of scope** (and which todo covers it)

- The dispatcher (N27)

## Tasks

- [x] Pin the JSON Schema generator as an exact dev dependency at least a week old (shared with N2).
- [x] Declare `@buildanagent/gateway` and `@buildanagent/sdk` as `dependencies` used for types only; `ContentBlock`, `AgentEvent` and `SignedPendingRequest` come in as type-only imports, and `SessionEntry` is the package's own (N2).

## Acceptance criteria

- [x] A JSON string containing U+2028 and U+2029 round-trips through the framer
- [x] A message without `jsonrpc` is rejected with the JSON-RPC invalid-request code
- [x] Every fixture validates and type-checks in both directions
- [x] The emitted JavaScript of `@buildanagent/protocol` imports nothing outside the package (a test scans `dist/` for import specifiers)
- [x] `@buildanagent/protocol` declares no dependency on `@buildanagent/harness`, so the workspace graph has no cycle
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/protocol/test/framing.test.ts`, `protocol-schema.test.ts` and `package.test.ts`, with the fixtures in `protocol-fixtures.ts`.

## Docs to update

`packages/protocol/README.md`: the method list and framing rules. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None open. P4 moved the entry union into this package (R2), so the protocol never imports the harness.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/protocol` now holds the messages, the framing and a generated schema for them, beside the session entry union. The plan's §3.5 sketch holds with the differences below.

**Public API.**
- Message types in `src/messages.ts`: `ClientCommand`, `ServerRequest`, `ServerNotification`, `HarnessEvent`, `InitializeResult`, `Disposition`, `TurnResultSummary`, the per-method result types with `ClientResultMap` and `ServerResultMap`, `ResponseMessage`, `RpcError`, and the unions `ClientMessage`, `ServerMessage` and `ProtocolMessage`.
- `encode()`, `decode()`, `ErrorCodes`, `CLIENT_METHODS`, `SERVER_REQUEST_METHODS`, `SERVER_NOTIFICATION_METHODS` and `EXPERIMENTAL_METHODS` in `src/jsonrpc.ts`.
- `JsonlFramer` and `DEFAULT_MAX_LINE_BYTES` in `src/framer.ts`.
- `ProtocolError` gains four codes (`invalid_json`, `invalid_request`, `line_too_long`, `unterminated_line`) and two fields, `rpcCode` and `requestId`.
- `schema/protocol.schema.json`, generated with the entry schema by `pnpm --filter @buildanagent/protocol schema`.

**Behavior.**
- `encode()` and `decode()` check the JSON-RPC envelope: the exact `jsonrpc` value, an id that is a number or a string (null only in an error response), a method string, an object for params, and exactly one of `result` and `error` in a response. A failure carries `rpcCode` `-32600` and the request's id when it could be read.
- `JsonlFramer.push()` splits bytes on `0x0A` only and decodes a line when it is whole. A bad line, a line over the bound and an unfinished last line come back as errors in order, and the stream goes on. The bound doesn't count a trailing `\r`, the framer keeps its own copy of a half line, and a stream that ends after only whitespace isn't reported as cut.
- `encode()` refuses a response whose `result` is `undefined`, which `JSON.stringify` would drop, and turns a bigint or a circular value into a `ProtocolError` with the internal-error code.
- The type check `schema-check/protocol-types.ts` compares the messages with the mirror in both directions, and changing one mirrored field makes it fail. It can't see an optional field that only one side has, so a test also requires every property the schema lists to be used by a fixture and every key a fixture uses to be in the schema.

**Decisions.**
- **`push()` returns `FramedMessage[]`,** each `{ ok: true, value }` or `{ ok: false, error }`, and not the sketch's `unknown[]`. A throwing `push()` would lose the good lines after a bad one in the same chunk.
- **The plan names only two results, so the rest are ours.** `session/create` and `session/open` return `{ session, head }`, `session/list` returns `{ sessions, nextCursor? }`, `turn/interrupt` returns `{ interrupted }`, `approval/list` returns `{ pending }`, and checkout and fork return `{ session, head }`. N27 implements them.
- **A server request's answer is `{ resolutions }` or `{ content, isError }`.** The plan left it open. An approval request is answered with the SDK's `Resolution`s, so one answer can settle a group.
- **`TurnResultSummary` is `{ stopReason, steps, costUsd, error? }`.** The plan named the type without defining it.
- **The SDK's `AgentEvent` is mirrored loosely in the schema.** Its 29 event types would be a second copy to keep in step with the SDK, so the schema checks `type` and the base fields, and a test compares the type list with the SDK's `AGENT_EVENT_TYPES`.
- **The `dist/` scan builds to a temporary folder,** with `--customConditions source`, because the packages it takes types from may not be built when the tests run.
- **The schema's shared shapes are named by a hash of their content,** after the generator's own `__schema7` names, which renumber when a shape is added. A shape zod can name by id (`Id`, `ContentBlock`, `SessionEntry`, `SignedPendingRequest`, `Resolution`, `RpcError`) keeps that name.
- **A client opts into an experimental method by listing its name in `initialize`'s `capabilities`.** The plan said a client "must opt in" without naming how. The server's `experimental` list names the methods, and the dispatcher (N27) answers `NotOptedIn` for one not listed.
- **The framing rule stands, with a corrected reason.** Pi's documentation says Node's `readline` splits on U+2028 and U+2029, and the plan repeats it. Node 22.23.5 did not when checked (it splits on a lone `\r`), so the README says what was checked, and the rule stays: split on the newline byte alone ([fact-check row N26-4](../../plans/reviews/fact-check-build-harness.md)).
- **No batch support.** JSON-RPC allows an array of messages. The framing puts one message on each line, so a batch is an `invalid_request`.

**Left out.** The dispatcher, queues and transports (N27 to N29).

