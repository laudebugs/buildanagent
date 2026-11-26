---
title: Read a session file
description: Count the entries of a stored session by type and stop safely at a file from a newer format.
---

You will read a session file, count its entries by type and report the lines that are not entries. You need this to analyse sessions in a script or to build a viewer without running the harness.

## A session file holds one entry per line

The harness stores each session in a session file, a `.jsonl` file with one `SessionEntry` per line. The log is an append-only tree: every entry names the entry it follows, with `parentId` set to `null` on the first. Each entry has six base fields (`id`, `parentId`, `seq`, `timestamp`, `type` and `origin`) and the fields of its type.

## Count the entries

`parseEntry()` reads one line and returns a typed entry. It throws a `ProtocolError` for a line it cannot read. This function counts a session file's entries by type and records the line number of each line that failed:

```ts file="packages/protocol/examples/read-session-file.ts" region="read"
```

`parseEntry()` throws `unsupported_format_version` on a header from a format it does not know, so a reader never misreads a newer file. The function rethrows that error and treats every other failure as an unreadable line.

## Rely on the stable part of an entry

The base fields, the entry type names and `formatVersion` are stable. Every other field may change with a `formatVersion` bump, which ships with a migration that writes a new file. `parseEntry()` checks only the base fields and the header's version. The [session entry schema](https://github.com/laudebugs/buildanagent/blob/main/packages/protocol/schema/session-entry.schema.json), a JSON Schema for one entry, checks each type's own fields.

Next, look up every export in the [protocol API reference](/reference/protocol/).
