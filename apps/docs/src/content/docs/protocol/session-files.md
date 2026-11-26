---
title: Read a session file
description: Count the entries of a stored session by type and stop safely at a file from a newer format.
---

You will read a session file, count its entries by type and report the lines that are not entries. You need this to analyse sessions in a script or to build a viewer without running the harness.

## A session file holds one entry per line

The harness stores each session as a `.jsonl` file, one `SessionEntry` per line. The log is an append-only tree: every entry names the entry it follows, with `parentId` set to `null` on the first. Each entry has six base fields (`id`, `parentId`, `seq`, `timestamp`, `type` and `origin`) and the fields of its type.

## Count the entries

`parseEntry()` reads one line and returns a typed entry. It throws a `ProtocolError` for a line it cannot read. This function counts a file's entries by type and notes the number of each line that failed:

```ts file="packages/protocol/examples/read-session-file.ts" region="read"
```

A header from a format the package does not know throws `unsupported_format_version`, so a reader never misreads a newer file. The function rethrows it and treats every other failure as an unreadable line.

## Rely on the stable part of an entry

The base fields, the entry type names and `formatVersion` are stable. Every other field may change with a `formatVersion` bump, which ships with a migration that writes a new file. `parseEntry()` checks the base fields and the header's version, and nothing else, because the JSON Schema checks each type's own fields.

Next, look up every export in the [protocol API reference](/reference/protocol/).
