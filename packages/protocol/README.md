# @buildanagent/protocol

The protocol package holds the types that cross a boundary in a buildanagent harness: the entries of a session log, the messages a client and a harness exchange, and the JSONL framing that carries them. Use it to read a session file, or to write a client in TypeScript or another language.

As of November 2026 the package is private and not on npm. It depends on the gateway and the SDK for their types only, so its JavaScript loads neither. The harness serves these messages; this package only describes and checks them.

`parseEntry()` reads one line of a session file and returns a typed `SessionEntry`:

```ts
import { parseEntry } from "@buildanagent/protocol";

const entry = parseEntry(line); // throws a ProtocolError for a line it can't read
if (entry.type === "session_header") console.log(entry.formatVersion); // 1
```

## A session file is a list of entries, one per line

Each line of a session file is one `SessionEntry`: six base fields and the fields of its type. The log is an append-only tree, so an entry names the entry it follows. The harness re-exports the types from `@buildanagent/harness/session`.

The base fields are `id`, `parentId` (`null` for the first entry), `seq`, `timestamp` (an ISO 8601 date and time with a zone), `type` and `origin`. The origin says who produced the content: `user`, `operator`, `model`, `tool` or `harness`. A message is several `message_block` entries, one per content block, closed by a `message_end`. The [harness README](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/README.md#the-session-log-holds-twenty-entry-types) says what each of the twenty types records. A `usage` entry accepts a `cost.total` of `null`, for a price that is unknown. `code_call` is not written yet. An `approval_requested` entry holds the SDK's signed request and the input it would run with, and an `approval_resolved` entry holds a person's answer.

The stable surface is the base fields, the entry type names and `formatVersion`, and the `@stable` tag marks each of them in the type declarations. Every other field is documented but may change with a `formatVersion` bump, which ships with a migration that writes a new file. `session_header.product` and the `product_record` entry belong to the product that owns the session, so they sit outside the stable surface.

### `parseEntry()` reads a line and refuses a format it does not know

`parseEntry(line)` takes a JSON line or a parsed value and returns a `SessionEntry`. It checks what every reader relies on: the value is an object, its base fields are valid, its `type` is in `SESSION_ENTRY_TYPES`, and a `session_header` has `formatVersion: 1`. A header from any other version throws a `ProtocolError` with code `unsupported_format_version`, so a reader never misreads a newer file. Other failures throw `invalid_entry`. It does not check each type's own fields; the JSON Schema does.

### The JSON Schema describes every entry for other languages

The [session entry schema](https://github.com/laudebugs/buildanagent/blob/main/packages/protocol/schema/session-entry.schema.json) is a JSON Schema, draft 2020-12, of one entry. It is generated from a zod description that is checked against the TypeScript types, field by field, so the two accept the same values. The package's own code does not import zod.

## The protocol is JSON-RPC 2.0, one message per line

Every message is a JSON-RPC 2.0 message and carries `"jsonrpc": "2.0"`. A client sends commands and answers server requests, and the server sends answers, requests and notifications.

- **Client methods.** `initialize`, `session/create`, `session/open`, `session/list`, `turn/start`, `turn/steer`, `turn/followUp`, `turn/interrupt` and `approval/list` are requests, and `$/cancelRequest` is a notification that has no response. `session/checkout` and `session/fork` are experimental. A client opts in by listing the method name in the `capabilities` of its `initialize`, and the server answers `NotOptedIn` otherwise. The server's `experimental` list in its `initialize` result names them. A `turn/start` may carry a top-level `trace` member, a trace context.
- **Turns.** `turn/start`, `turn/steer` and `turn/followUp` answer with a `Disposition`, either `{ accepted: true, turn }` or `{ accepted: false, reason }` with a reason of `busy`, `locked` or `invalid`. Every accepted turn ends with a `turn/settled` notification that carries a `TurnResultSummary`.
- **Server requests.** The server asks for `approval/request`, `clarification/request` and `tool/call`, each with a string id. The client answers with a response of the same id: `{ resolutions }` for the first two and `{ content, isError }` for a tool call.
- **Events.** `event` notifications carry the session, a sequence number and either an SDK `AgentEvent` or a `HarnessEvent` (`entry_appended`, `budget_warning`, `context_fill` or `completion_check`).
- **Errors.** `ErrorCodes` holds the standard JSON-RPC codes and three of ours: `QueueFull` (-32001), `SessionLocked` (-32002) and `NotOptedIn` (-32003).
- **Envelope check.** `decode()` and `encode()` check the envelope and nothing else, because a method's params are the dispatcher's to check. Each of these throws a `ProtocolError` with code `invalid_request`: a message without `jsonrpc: "2.0"`, a batch, an id that isn't a number or a string, and a response with both or neither of `result` and `error`. Its `rpcCode` and `requestId` say what to answer with. Text that isn't JSON throws `invalid_json`.

### The framer splits on newlines only

`JsonlFramer` turns a byte stream into messages. Its `push(chunk)` returns one result for each line the chunk finished, either `{ ok: true, value }` or `{ ok: false, error }`, so one bad line never stops the lines after it:

```ts
const framer = new JsonlFramer();
for (const result of framer.push(chunk)) console.log(result.ok ? result.value : result.error.code);
```

It splits on `\n` and nothing else, and never uses Node's `readline`, which also ends a line at a lone `\r`. Pi's RPC documentation warns that a line reader may split at U+2028 and U+2029 too, characters that may sit inside a JSON string. When checked, Node 22's `readline` did not split at either, but a reader in another language might, so the rule is to split on the newline byte alone. A line is decoded only when it is whole, so a character cut across two chunks is read correctly. The framer drops a trailing `\r`, skips blank lines, and skips a line over `maxLineBytes` (default 8 MiB) after reporting it once. Its `end()` reports a last line that was never finished.

### The protocol schema covers every message

The [protocol schema](https://github.com/laudebugs/buildanagent/blob/main/packages/protocol/schema/protocol.schema.json) is a JSON Schema, draft 2020-12, of one message in either direction, generated and checked the same way as the entry schema. Every message kind has a sample message that the compiler checks against its type and the schema validates. The shared shapes under `$defs` are named by a hash of their content, so adding one doesn't rename the others.

One part is loose on purpose. An SDK `AgentEvent` in an `event` notification is checked for its `type` and the base fields every event has, because the SDK owns that contract. The schema's list of event types is kept equal to the SDK's.

To see the harness that writes these entries and serves these messages, read the [harness README](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/README.md).
