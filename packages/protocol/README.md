# @buildanagent/protocol

The protocol package holds the types that cross a boundary: the entries of a session log, the messages a client and a harness exchange, and the JSONL framing that carries them. The session entry union is built; the messages and the framer arrive in later todos.

As of November 2026 the package is private and not on npm. It depends on the gateway and the SDK, and its code will import them for types only, so its built JavaScript will load neither. The [harness plan](https://github.com/laudebugs/buildanagent/blob/main/docs/plans/build-harness.md) says what each package will hold and in which order.

## A session file is a list of entries, one per line

Each line of a session file is one `SessionEntry`: six base fields and the fields of its type. The log is an append-only tree, so an entry names the entry it follows. [`src/entries.ts`](src/entries.ts) holds the types, and the harness re-exports them from `@buildanagent/harness/session`.

The base fields are `id`, `parentId` (`null` for the first entry), `seq`, `timestamp`, `type` and `origin`, which says who produced the content: `user`, `operator`, `model`, `tool` or `harness`. A message is several `message_block` entries, one per content block, closed by a `message_end`. The harness list in [its README](../harness/README.md#the-session-log-holds-eighteen-entry-types) says what each of the eighteen types records. A `usage` entry accepts a `cost.total` of `null`, for a price that is unknown. Approval entries and `code_call` arrive with the todos that write them.

The stable surface is the base fields, the entry type names and `formatVersion`. The `@stable` tag marks each of them in the source. Every other field is documented but may change with a `formatVersion` bump, which ships with a migration that writes a new file. `session_header.product` and the `product_record` entry belong to the product that owns the session, so they sit outside the stable surface.

### `parseEntry()` reads a line and refuses a format it does not know

`parseEntry(line)` takes a JSON line or a parsed value and returns a `SessionEntry`. It checks what every reader relies on: the value is an object, its base fields are valid, its `type` is in `SESSION_ENTRY_TYPES`, and a `session_header` has `formatVersion: 1`. A header from any other version throws a `ProtocolError` with code `unsupported_format_version`, so a reader never misreads a newer file. Other failures throw `invalid_entry`. It does not check each type's own fields; the JSON Schema does.

### The JSON Schema describes every entry for other languages

[`schema/session-entry.schema.json`](schema/session-entry.schema.json) is a JSON Schema, draft 2020-12, of one entry. It is generated from a zod description in `scripts/session-entry-schema.ts`, because TypeScript 7's programmatic API is still marked unstable, and a type-based generator such as `ts-json-schema-generator` needs the stable one. Run `pnpm --filter @buildanagent/protocol schema` after a change to the union. A test fails while the committed file differs from the generator's output, and another fails when the type and the description name different fields. The package's published code does not import zod; only the generator and the tests do.
