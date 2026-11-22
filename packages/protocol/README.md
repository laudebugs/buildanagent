# @buildanagent/protocol

The protocol package holds the types that cross a boundary: the entries of a session log, the messages a client and a harness exchange, and the JSONL framing that carries them. The session entry union, the messages and the framer are built; the dispatcher that serves them is the harness's.

As of November 2026 the package is private and not on npm. It depends on the gateway and the SDK and imports them for types only, so its built JavaScript loads neither. A test scans the build for any import from outside the package. It declares no dependency on the harness, so the workspace has no cycle. The [harness plan](https://github.com/laudebugs/buildanagent/blob/main/docs/plans/build-harness.md) says what each package will hold and in which order.

## A session file is a list of entries, one per line

Each line of a session file is one `SessionEntry`: six base fields and the fields of its type. The log is an append-only tree, so an entry names the entry it follows. [`src/entries.ts`](src/entries.ts) holds the types, and the harness re-exports them from `@buildanagent/harness/session`.

The base fields are `id`, `parentId` (`null` for the first entry), `seq`, `timestamp` (an ISO 8601 date and time with a zone), `type` and `origin`, which says who produced the content: `user`, `operator`, `model`, `tool` or `harness`. A message is several `message_block` entries, one per content block, closed by a `message_end`. The [harness README](../harness/README.md#the-session-log-holds-twenty-entry-types) says what each of the twenty types records. A `usage` entry accepts a `cost.total` of `null`, for a price that is unknown. `code_call` is not written yet. An `approval_requested` entry holds the SDK's signed request and the input it would run with, and an `approval_resolved` entry holds a person's answer.

The stable surface is the base fields, the entry type names and `formatVersion`. The `@stable` tag marks each of them in the source. Every other field is documented but may change with a `formatVersion` bump, which ships with a migration that writes a new file. `session_header.product` and the `product_record` entry belong to the product that owns the session, so they sit outside the stable surface.

### `parseEntry()` reads a line and refuses a format it does not know

`parseEntry(line)` takes a JSON line or a parsed value and returns a `SessionEntry`. It checks what every reader relies on: the value is an object, its base fields are valid, its `type` is in `SESSION_ENTRY_TYPES`, and a `session_header` has `formatVersion: 1`. A header from any other version throws a `ProtocolError` with code `unsupported_format_version`, so a reader never misreads a newer file. Other failures throw `invalid_entry`. It does not check each type's own fields; the JSON Schema does.

### The JSON Schema describes every entry for other languages

[`schema/session-entry.schema.json`](schema/session-entry.schema.json) is a JSON Schema, draft 2020-12, of one entry. It is generated from a zod description in `scripts/session-entry-schema.ts`, because TypeScript 7's programmatic API is still marked unstable, and a type-based generator such as `ts-json-schema-generator` needs the stable one. Run `pnpm --filter @buildanagent/protocol schema` after a change to the union. A test fails while the committed file differs from the generator's output, and `pnpm typecheck` fails when the type and the description accept different values. An optional field that only one of them has is not visible to that check, so a test also compares each entry's field names with its fixtures. The package's published code does not import zod; only the generator and the tests do.

## The protocol is JSON-RPC 2.0, one message per line

Every message is a JSON-RPC 2.0 message and carries `"jsonrpc": "2.0"`. [`src/messages.ts`](src/messages.ts) holds the types and [`src/jsonrpc.ts`](src/jsonrpc.ts) the framing. A client sends commands and answers server requests, and the server sends answers, requests and notifications.

- **Client methods.** `initialize`, `session/create`, `session/open`, `session/list`, `turn/start`, `turn/steer`, `turn/followUp`, `turn/interrupt` and `approval/list` are requests, and `$/cancelRequest` is a notification that has no response. `session/checkout` and `session/fork` are experimental: a client opts in by listing the method name in the `capabilities` of its `initialize`, and the server answers `NotOptedIn` otherwise. The server's `experimental` list in its `initialize` result names them. A `turn/start` may carry a top-level `trace` member, a trace context.
- **Turns.** `turn/start`, `turn/steer` and `turn/followUp` answer with a `Disposition`, either `{ accepted: true, turn }` or `{ accepted: false, reason }` with a reason of `busy`, `locked` or `invalid`. Every accepted turn ends with a `turn/settled` notification that carries a `TurnResultSummary`.
- **Server requests.** The server asks for `approval/request`, `clarification/request` and `tool/call`, each with a string id. The client answers with a response of the same id: `{ resolutions }` for the first two and `{ content, isError }` for a tool call.
- **Events.** `event` notifications carry the session, a sequence number and either an SDK `AgentEvent` or a `HarnessEvent` (`entry_appended`, `budget_warning`, `context_fill` or `completion_check`).
- **Errors.** `ErrorCodes` holds the standard JSON-RPC codes and three of ours: `QueueFull` (-32001), `SessionLocked` (-32002) and `NotOptedIn` (-32003).
- **Envelope check.** `decode()` and `encode()` check the envelope and nothing else, because a method's params are the dispatcher's to check. A message without `jsonrpc: "2.0"`, a batch, an id that isn't a number or a string, or a response with both or neither of `result` and `error` throws a `ProtocolError` with code `invalid_request`, and its `rpcCode` and `requestId` say what to answer with. Text that isn't JSON throws `invalid_json`.

### The framer splits on newlines only

`JsonlFramer` turns a byte stream into messages. `push(chunk)` returns one result for each line the chunk finished, either `{ ok: true, value }` or `{ ok: false, error }`, so one bad line never stops the lines after it. It splits on `\n` and nothing else, and never uses Node's `readline`, which also ends a line at a lone `\r`. Pi's RPC documentation warns that a line reader may split at U+2028 and U+2029 too, characters that may sit inside a JSON string. When checked, Node 22's `readline` did not split at U+2028 or U+2029, but a reader in another language might, so the rule is to split on the newline byte alone. A line is decoded only when it is whole, so a character cut across two chunks is read correctly. It drops a trailing `\r`, skips blank lines, and skips a line over `maxLineBytes` (default 8 MiB) after reporting it once. `end()` reports a last line that was never finished.

### The protocol schema covers every message

[`schema/protocol.schema.json`](schema/protocol.schema.json) is a JSON Schema, draft 2020-12, of one message in either direction. It is generated from a zod description in `scripts/protocol-schema.ts` by `pnpm --filter @buildanagent/protocol schema`, the same command that writes the entry schema. A test fails while the committed file differs from the generator's output, and `pnpm typecheck` fails when the types and the description accept different values. That check can't see an optional field that only one side has, so a test also requires every property the schema lists to be used by a fixture and every key a fixture uses to be in the schema. The shared shapes under `$defs` are named by a hash of their content, so adding one doesn't rename the others. One part is loose on purpose: an SDK `AgentEvent` in an `event` notification is checked for its `type` and the base fields every event has, because the SDK owns that contract and its 29 event types would be a second copy to keep in step. A test checks the schema's list of types against the SDK's. Every message kind has a fixture that the compiler checks against its type and the test validates against the schema.

