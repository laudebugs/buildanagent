# The session file format

A session is a JSONL file of typed entries, one JSON object per line, and your own tools can read it without the harness. Three things in it are stable: the six base fields every entry carries, the entry type names, and `formatVersion`. Every other field is documented below but may change, and a change ships with a `formatVersion` bump and a migration (see [How the format changes](#how-the-format-changes)). The entry types are defined in [`@buildanagent/protocol`](../../protocol/src/entries.ts), and the [JSON Schema](../../protocol/schema/session-entry.schema.json) checks one line of any of them.

## Where the files are

`jsonlStore({ dir })` keeps a session in `<dir>/<user>/<session>.jsonl`. User and session ids are percent-encoded in file names, so every byte outside `a-z`, `0-9`, `_` and `-` becomes `%XX`. A line counts once it ends in a newline, and a last line without one was never acknowledged, so a reader skips it.

- **Derived files.** A revert or a migration writes a new file whose name starts with `~` and moves the session's pointer to it. The old file is never changed. A fork's file continues its parent's, which its header names.
- **The pointer.** `<session>.pointer.json` holds `{ "file": "<id>" }`, the file that holds the session's log now. A session with no pointer is in the file named by its id. The pointer is the only mutable state.
- **The archive.** With a retention period set, `<dir>/.archive/<user>/<file>.jsonl.gz` holds an expired session's files, each the gzip of the original. The folder name starts with `.`, which percent-encoding never leaves in a name, so no user's folder can be the archive. See [Nothing expires unless you set a retention period](#nothing-expires-unless-you-set-a-retention-period).

## Every entry carries six base fields

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The entry's id, unique within its session. Appending the same id twice changes nothing. |
| `parentId` | string or `null` | The entry this one follows, or `null` for the first entry. |
| `seq` | integer | The position in the file, from 0 and rising by 1. |
| `timestamp` | string | When the entry was written, as an ISO 8601 date and time with a zone. |
| `type` | string | The entry type name, one of the twenty-one below. |
| `origin` | string | Who produced the content: `user`, `operator`, `model`, `tool` or `harness`. |

The log is an append-only tree: `parentId` links an entry to the entry it follows, and a branch is a second entry with the same parent. The entries a session sees are the path from the root to its HEAD, and a `checkout` entry moves HEAD.

## Twenty-one entry types

Each section lists the fields the type adds to the base. A field marked optional may be absent, and the others are always present. The types appear in the order of `SESSION_ENTRY_TYPES`.

### `session_header`

The first entry of every file, and the only one that may be first. It says what ran the session and which session it came from.

| Field | Type | Meaning |
| --- | --- | --- |
| `formatVersion` | `1` | The file's format. Stable. A reader refuses a header with another value. |
| `harnessVersion` | string | The harness version that wrote the file. |
| `sdkVersion` | string | The SDK version that ran the loop. |
| `defaultsHash` | string | The SDK's `DEFAULTS_HASH` for the run. |
| `capabilities` | string[] | The SDK's capability strings. |
| `ablationHash` | string | A hash of the ablation switches the session ran with. |
| `parent` | object, optional | `{ session, entryId }`: the file and entry a fork continues, or, with `spawn`, the session and `subagent_link` entry that started a child. |
| `spawn` | object, optional | `{ spawningCallId }` or `{ stepId }`, never both: the tool call or workflow step that started a subagent's log. A spawned log does not continue its parent's. |
| `product` | object, optional | `{ name, version, bundleHash }`: the product that owns the session. Outside the stable surface. |

### `turn_start`

A run began.

| Field | Type | Meaning |
| --- | --- | --- |
| `runId` | string | The run's id. |
| `mode` | `"run"` or `"continue"` | Whether the run started from new input or continued a pause. |
| `system` | string | The frozen system prompt, byte for byte, so a rebuilt context carries it. |

### `message_block`

One content block of a message. A message is several of these, in `index` order, closed by a `message_end`.

| Field | Type | Meaning |
| --- | --- | --- |
| `messageId` | string | The message the block belongs to. |
| `role` | `"user"` or `"assistant"` | Who the message is from. |
| `index` | integer | The block's position in the message. |
| `block` | object | The content: `{ type: "text", text }`, `{ type: "reasoning", text, signature? }`, `{ type: "image", mediaType, data }` or `{ type: "tool_call", callId, name, input }`. |
| `delivery` | `"input"`, `"steer"` or `"follow_up"`, optional | How a user message reached the run, when it did not start it. |

### `message_end`

A message is complete.

| Field | Type | Meaning |
| --- | --- | --- |
| `messageId` | string | The message that ended. |
| `model` | object | `{ api, provider, id }`: the model that wrote it. |
| `stopReason` | string | Why the model stopped: `stop`, `length`, `tool_calls`, `error` or `aborted`. |
| `error` | object, optional | `{ kind, message, status?, code?, retryAfterMs? }`, with `kind` one of `retryable`, `overflow`, `quota` or `fatal`. |

### `tool_result`

What a tool call returned to the model.

| Field | Type | Meaning |
| --- | --- | --- |
| `callId` | string | The call this answers. |
| `tool` | string | The tool's name. |
| `content` | array | Text blocks and image blocks, in the shapes of `message_block`. |
| `isError` | boolean | Whether the call failed. |
| `details` | any, optional | Data for the host, not sent to the model. |
| `spill` | object, optional | `{ path, bytes }`: where the full output went when it was too large to keep in the entry. |
| `trust` | `"trusted"` or `"untrusted"` | Whether the output may carry instructions an attacker wrote. |

### `code_call`

A tool call that the host's own code made with `Harness.invokeTool()`, with no model step. It is written before the call is decided, and its `id` is its `callId`. The call's `permission_decision`, `approval_requested` and `tool_result` entries follow it, and the model never reads any of them.

| Field | Type | Meaning |
| --- | --- | --- |
| `callId` | string | The call's id, equal to the entry's own `id`. |
| `tool` | string | The tool's canonical name. |
| `input` | any | The input the call runs with. |
| `inputHash` | string | `canonicalInputHash()` of `input`, which a resolution checks before the call runs. |
| `compensates` | string, optional | The call id of an earlier code call that this one undoes. |

### `permission_decision`

The permission pipeline's verdict on one call, written for every decision.

| Field | Type | Meaning |
| --- | --- | --- |
| `callId` | string | The call decided. |
| `tool` | string | The tool's name. |
| `decision` | string | `allow`, `deny` or `ask`. |
| `rule` | string, optional | The rule that decided, when one did. |
| `by` | string, optional | Who decided, when a person or a hook did. |
| `policyVersion` | string | The version of the policy that decided. |
| `inputHash` | string | The hash of the input the decision covers. |

### `usage`

The tokens and cost of one model call, a summary or a judge call.

| Field | Type | Meaning |
| --- | --- | --- |
| `source` | string | `model_call`, `summary` or `judge`. |
| `usage` | object | `{ uncachedInput, cacheRead, cacheWrite: { "5m", "1h" }, output, reasoning, raw, unreported? }`, in tokens. |
| `lastAttemptUsage` | object, optional | The usage of the last attempt alone, when a retry made `usage` a sum. |
| `cost` | object | `{ total, basis, currency, catalogAsOf? }`: `total` is a number in US dollars, or `null` when the price is unknown, and `basis` is `provider`, `catalog` or `unknown`. |

### `turn_end`

A run ended.

| Field | Type | Meaning |
| --- | --- | --- |
| `runId` | string | The run that ended. |
| `stopReason` | string | The SDK's stop reason: `done`, `max_steps`, `aborted`, `no_progress`, `budget`, `error`, `stopped`, `awaiting_approval` or `clarification_requested`. |
| `steps` | integer | How many model steps the run took. |

### `checkout`

HEAD moved to another entry. Logging it means a restart finds HEAD where it was left.

| Field | Type | Meaning |
| --- | --- | --- |
| `headId` | string | The entry HEAD moved to. |

### `compaction`

A summary replaced older entries in the context a rebuilt run sends. The older entries stay in the log.

| Field | Type | Meaning |
| --- | --- | --- |
| `layer` | string | Which layer wrote it: `summarize`, `mid_turn` or `overflow_retry`. |
| `summary` | string | The summary text. |
| `firstKeptEntryId` | string | The first entry the context keeps whole. |
| `tokensBefore` | number | The context size before the summary. |
| `tokensAfter` | number | The context size after it. |
| `model` | object | `{ api, provider, id }`: the model that wrote the summary. |
| `promptVersion` | string | The version of the summary prompt. |
| `usageEntryId` | string | The `usage` entry that records the summary call's cost. |
| `focus` | string, optional | The focus hint the caller gave. |

### `env_stamp`

The environment the session ran in.

| Field | Type | Meaning |
| --- | --- | --- |
| `cwd` | string | The working directory. |
| `permissionMode` | string | `default`, `accept_edits`, `read_only`, `bypass` or `shadow`. |
| `approvalPolicy` | string | `on-request`, `granular` or `never`. |
| `sandbox` | string | The sandbox tier: `none`, `os`, `container`, `gvisor` or `microvm`. |
| `model` | object | `{ api, provider, id }`: the model in force. |
| `effort` | string, optional | The reasoning effort in force. |

### `loadout`

The tools and model in force changed.

| Field | Type | Meaning |
| --- | --- | --- |
| `tools` | string[] | The tools exposed to the model. |
| `model` | object, optional | `{ api, provider, id }`, when the model changed. |
| `effort` | string, optional | The reasoning effort, when it changed. |

### `completion_check`

The commands that checked a finished task, and whether they passed.

| Field | Type | Meaning |
| --- | --- | --- |
| `checks` | array | `{ command, exitCode }` for each command run. |
| `passed` | boolean | Whether the checks passed. |
| `flagged` | string[] | What the checks flagged. |

### `skill_loaded`

A skill's instructions entered the context.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The skill's name. |
| `path` | string | Where its file is. |

### `extension_loaded`

An extension was loaded.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | The extension's name, or the MCP server's name for tier `mcp`. |
| `tier` | string | `in_process`, `mcp` or `skill`. |
| `contentHash` | string | The hash of what ran. For tier `mcp`, the hash of `mcp`. |
| `mcp` | object, optional | For tier `mcp` only: `transport` (`stdio`, `in_process`, `http` or `sse`), `commandHash` (a hash of the command and its args, for stdio), `urlHash` (a hash of the normalised URL, for http and sse), `era` (`2026-07-28` or `legacy`) and `toolsHash` (a hash of the registered tools). It never holds an argument, an environment value, a URL or a header. |

### `subagent_link`

A child session exists. It names the tool call or workflow step that started it, one of the two.

| Field | Type | Meaning |
| --- | --- | --- |
| `childSession` | string | The child's session id. |
| `spawningCallId` | string, optional | The tool call that started it. |
| `stepId` | string, optional | The workflow step that started it. |

### `approval_requested`

A tool call waits for a person. The entry holds no key bytes: the signature names the key by id.

| Field | Type | Meaning |
| --- | --- | --- |
| `request` | object | The SDK's signed pending request, unchanged: `{ id, kind, callId, tool, inputHash, policyVersion?, appHash?, question?, reason?, keyId, signature, createdAt }`, with `kind` either `approval` or `clarification`. |
| `input` | any | The input the call would run with once approved, which the approver is shown. |

### `approval_resolved`

A person's answer to a pending request, written before the run that applies it starts.

| Field | Type | Meaning |
| --- | --- | --- |
| `resolution` | object | `{ requestId, decision, reason?, by? }` with `decision` either `allow` or `deny`, or `{ requestId, answer, by? }` for a clarification. |
| `sticky` | `"run"` or `"session"`, optional | Set on an allow that also covers the same call later. |
| `allowance` | object, optional | What a sticky allowance matches: `{ tool, inputHash?, commandPrefix?, policyVersion? }`. |
| `groupId` | string, optional | Set when one answer covered several requests of one step that share a tool and an input. |
| `quorum` | `"pending"`, optional | Set on an answer that a quorum still waits on, which no run has been given yet. |

### `shadow_call`

A call that shadow mode recorded and did not run.

| Field | Type | Meaning |
| --- | --- | --- |
| `callId` | string | The call. |
| `tool` | string | The tool's name. |
| `inputHash` | string | The hash of the input it would have run with. |

### `product_record`

A record the product owns. It sits outside the stable surface, and the harness never reads it.

| Field | Type | Meaning |
| --- | --- | --- |
| `name` | string | A namespaced name, such as `triage.record`. |
| `data` | any | The record. |

## How the format changes

`formatVersion` is in the `session_header`, and the current value is 1. A reader that meets another value refuses the file, so no tool misreads a newer one. A change to any field outside the stable surface, or any new field a reader must understand, bumps `formatVersion`, and the same release ships a migration that takes a file from the old version to the new one. `migrateSession()` writes the result as a new file, reads it back, and only then moves the pointer, so the old file stays as it was.

A tool of your own should read a line as JSON, check `type` against the names above, and ignore a field it does not know. It can rely on the base fields, the type names and `formatVersion` staying as they are. It should not rely on any other field name or value staying as it is across a version bump.

## Nothing expires unless you set a retention period

A session is never deleted or moved unless you set a retention period. Without one, `jsonlStore()` and `pruneSessions()` touch no file.

With `retention: { days, action }`, a session expires when the newest entry in any of its files is more than `days` old. A session is its first file, the derived files that continue it and its pointer, and its files count whether they are live or archived. `archive` gzips each of the session's live files into `<dir>/.archive/<user>/`, keeps the pointer, and removes the original once the archive reads back to the same bytes. The store still lists and loads an archived session, so a search over `list()` and `load()` finds it, and a write brings back the file it writes to. `purge` deletes the session's files, live and archived, and then its pointer, so a session archived before a switch to `purge` is deleted once it expires.

Every doubt keeps a file. Before a run removes anything, it takes the lock of each session it means to expire, reads the folder again, and decides from that second read which sessions survive: the fresh ones, the locked ones, and the ones whose file or pointer it can't read or date. A purge keeps every expired session that a survivor continues, directly or through another kept session, so no log loses its ancestors. It removes a fork before the session the fork continues, and keeps that session when the fork can't be removed. A file the store wrote whose header can't be read could be a fork of any session, so it stops every purge for that user until it is gone; the run lists it in `skipped`. A file with no complete line holds nothing. If an archive sits beside that live file, the store reads the archive and the run judges the session by it: a purge removes both files, and an archive leaves both alone. If no archive exists, the run ignores the file.

A run handles a session's files one at a time, each before the file it continues, so the newest file goes first, the first file last and the pointer after that. A run that stops part-way never leaves a file whose parent it removed, every remaining file still continues the first file, and the next run finds the session and finishes. Each lock is given up as soon as its session is archived, purged or kept. A run reads each live file only at its two ends, the header and the last complete line, and unpacks each archive once while its size, modification time and inode stay the same. A file that another process deletes during a run is not brought back from the archive. A failure stops only its own session, which the result keeps with reason `error` and the error in `errors`.

Expiry runs in two places and never in the background. `pruneSessions({ dir, userId, retention })` runs it when you call it, and the `sessions prune` command will call it. A `jsonlStore({ dir, retention })` runs it for a user the first time it lists, loads, appends or deletes that user's sessions in a process, which for a session is when it opens. After one clean pass it does not run again for that user until the process restarts, so a long-running server calls `pruneSessions()` on its own schedule, with the lock its writers hold. The store passes each error to `onRetentionError` and ignores anything that callback throws. A pass that had an error runs again on the first call at least a minute after it ended. A store call waits for a running pass, and a pass keeps every session that one of the store's calls is already reading or writing.

**What `delete()` leaves behind.** A store's `delete()` leaves a session's derived files and pointer, and retention expires them as the deleted session. `delete()` removes the session's first file and that file's archive. A run expires what is left on the dates of those files and never brings the deleted first file back.

## A memory delete marks entries, and a targeted purge removes their content

Nothing in a session file changes when a memory record is deleted. The memory extension (`@buildanagent/harness/memory`) keeps a purge list instead: one mark per tool call that wrote or returned the deleted record, each a run id, a call id and a tool name. `readPurgeMarks()` reads the list. A mark matches a call's entries: the `message_block` holding the `tool_call`, the call's `tool_result`, and, for a call the host's code made, its `code_call` and `approval_requested` entries. It matches by call id and tool name, and by run id where the log shows the run. A call's run is the one whose `turn_start` came before its entries with no `turn_end` between, or, for a host code call, its own call id. A call resumed in a later run counts for both runs. So when a provider reuses a call id such as `call_1` across sessions, a delete blanks only the marked run's call. Where no open run covers a call's entries, as in a file that continues another mid-run, the mark matches by call id and tool alone, so the purge removes more than the marked call, never less.

`purgeSession({ store, index, key, lock, marks })` from `@buildanagent/harness/session` removes the marked content, much as a migration rewrites a file:

- **What changes.** The files from the furthest one that holds a marked entry down to the session's current file are written again as derived files, each header naming the new copy of the file above it. The copy of the session's first file is named `~o…`. The copy of a file above it, one the session continues from the session it was forked from, is named `~q…`. Every other copy is named `~p…`. A marked call's `input` becomes `{}`. A marked `tool_result` keeps one text block, `PURGED_TEXT`, and loses its `details` and `spill`. Every entry keeps its base fields, its `callId` and its tool name, so the tree still resolves and each call still pairs with its result.
- **In what order.** Each new file is read back and checked before the pointer moves to the new current file, and the session's old files are deleted only after that. A crash leaves the session readable from the old files or the new. When the session's first file was rewritten, its purged copy is then written under the session's id again, replacing the copy an earlier purge wrote there, because a listing finds a session by its first file. A crash just before that write leaves a session that opens but is missing from the listing until its next purge.
- **Which files are the session's.** A session's own files run from its current file to its first file, or to that file's `~o` copy, and then through the `~q` copies above it. Every file past those belongs to the session it was forked from. A purge deletes only the session's own files, and the retention purge gives each session the same files, so a purged fork never takes its parent's current file.
- **Forks.** A fork that continues one of the old files must be purged first, or the purge throws `session_conflict` before it writes anything. A fork's purge copies the part of the parent it continues into its own new files and leaves the parent's file for the parent's own purge.
- **Replay.** A byte-for-byte replay of a purged session no longer matches the session that ran. Where the content was, a replay reads `PURGED_TEXT` and an empty input, so a replay reports the purge instead of failing silently.
- **What stays, and how the result reports it.** The spill store's copy of a large result is outside the log, so the purge can't delete it. The result's `spills` lists the path of each purged result's spill file, and the caller deletes it with the spill store that wrote it; a later purge does not list it again. A compaction summary written after the marked call may still hold the fact, and so may the model's own text where it repeated it. The marks cover neither, so both stay until the retention purge removes the whole session. The result's `residual` lists them by entry id: `compactions` for the summaries, and `assistantBlocks` for the assistant's blocks other than tool calls, each after the session's first marked call. The purge counts these entries without reading them, so a listed entry may hold nothing of the fact.

`pruneSessions()` reads the same list as `marks`. A `purge` removes marked entries with their whole session, and the result's `purgedMarks` lists the marks it removed so. An `archive` keeps a marked entry as it is, and the result's `markedArchives` names each archived session that holds one, which `purgeSession()` can still clean: the store reads an archived file, and the purge deletes the archive with the old file. `clearPurgeMarks()` removes the marks it is given from the list once every session that held them has been purged. A mark joins the list with the date it was added, in `at`. A mark that no session holds, such as one whose call never reached the log, would otherwise stay on the list for good, so `clearPurgeMarks(files, marks, { unmatched })` drops each `unmatched` mark once it has been on the list for 30 days. The caller passes as `unmatched` only the marks that a pass over every session that could hold them, live and archived, found in none; a mark with no date is dated by that clear and drops 30 days later. The 30 days give a pass that missed a session time to find it, so a pending delete is not dropped early. It waits for the memory calls of any extension in the same process over the same `MemoryFiles` object, and nothing coordinates two processes.

## What a month of sessions costs on disk

At 100 turns a day, a month is about 3,000 turns and about 30 MB uncompressed. That projection rests on one measurement. On 2026-11-22 a scripted model ran 20 turns of a triage-shaped session through `runTurn()` and `jsonlStore()`. Each turn made two tool calls, with a 2 KB system prompt and 1.6 KB tool results. The file held 263 entries and 199,770 bytes, or 13 entries and about 10 KB a turn. A session's size grows with its turns, because each `turn_start` carries the system prompt and each tool result is stored in full up to the entry size bound (64 KiB by default). Tool results were 38% of the bytes, `message_block` entries 23% and `turn_start` entries 22%. Gzip took the file to 15,040 bytes, but the scripted text repeats, so that ratio is far better than real text gets. This is a projection from a synthetic session, and the harness capstone's recorded sessions will replace it.
