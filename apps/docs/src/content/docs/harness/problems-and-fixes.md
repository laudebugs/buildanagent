---
title: Problems and fixes
description: Ten problems you may hit with sessions, context and tools, each from what you see, to its cause, to its fix.
---

You will find ten problems that sessions, context and tools cause, each written from what you see to why it happens and how to fix it. You need this page when a turn throws an error or the agent behaves in a way you did not expect.

## Sessions

### Opening a session throws `session_locked`

**You see.** `openSession()` throws a `HarnessError` with the code `session_locked` and the message `another writer holds the session "chat-1"`.

**Cause.** Another writer holds the session's lock. It is often your own process: an earlier `openSession()` for the same key that never reached `close()`.

**Fix.** Close every session in a `finally` block, as the [quick start](/harness/quick-start/) does. Remove a lock by hand only when you know its writer is gone, because removing the lock of a live writer lets two writers into one log. Call `unlockSession()` from `@buildanagent/harness/session/jsonl`, or run `buildanagent session unlock <session> --force` for the CLI's own sessions.

If the writer died on the same host, you need not remove anything: its lock becomes free once the lease lapses, 30 seconds by default. A lock from another host is never taken over, because this host cannot tell whether that process still runs.

### `runTurn()` throws `session_read_only`

**You see.** `runTurn()` throws a `HarnessError` with the code `session_read_only` and the message `this session was opened without a lock`.

**Cause.** You opened the session without a `lock`. A session with no lock reads and never writes, because readers do not lock.

**Fix.** Pass a lock to `openSession()`, such as `fileLock({ dir })`, in every process that runs turns.

### A fork throws `entry_not_found` and says the session has no entries

**You see.** `fork()` throws a `HarnessError` with the code `entry_not_found` and the message `the session chat-1 has no entries to branch from yet`.

**Cause.** The session has no log to fork. The harness writes the header on a session's first turn, so a session that has run no turn has nothing to copy.

**Fix.** Run a turn first. `runTurn()` returns `lastEntryId`, the id of the last entry it wrote, which is the id to pass to `fork()` to start from the end of that turn.

### A fork or a checkout throws `entry_not_found` and names an entry

**You see.** `fork()`, `checkout()` or `revert()` throws a `HarnessError` with the code `entry_not_found` and the message `no entry <id> in the session chat-1`.

**Cause.** The id you passed is not in this session's log. It may have a typo, belong to another session, or follow an entry that a revert left behind, because the entries after a revert's target are no longer part of the session.

**Fix.** Take the id from this session: `lastEntryId` from a turn's result, or an entry from `session.path()`.

### A session opens with no memory of the conversation

**You see.** You open `chat-1` and the model answers as if the conversation never happened. The first request carries one message, and the log has only the new turn.

**Cause.** A session's key is the user id and the session id together. A session opened under a different `userId`, or with a different `sessionId`, is a new, empty session, and the store treats another user's session as one that does not exist.

**Fix.** Open the session with the same `userId` and `sessionId` that wrote it, and point the store, the index and the lock at the same folders.

## Context

### A tool result ends with `[output cut: ...]`

**You see.** The model's view of a tool result ends with `[output cut: the first N of M bytes are shown; the full text is in <path>]`, with real numbers and a real path. The agent misses what the cut part held.

**Cause.** The write cap, layer 1 of the context policy you passed to `createHarness({ context })`, cuts a result over about 64 KiB and saves the full text to the spill store.

**Fix.** Give the agent a way to read the saved file. The built-in `read` tool opens spill files when you pass `spills`, as the [tools page](/harness/tools/) shows. To keep more of each result in the request, raise `writeCapBytes` in `createContextPolicy()` and the store's `maxEntryBytes` with it, because a store refuses an entry over 64 KiB.

### `createContextPolicy()` throws `invalid_context_options`

**You see.** `createContextPolicy()` throws a `HarnessError` with the code `invalid_context_options` and a message that starts `the write_cap layer needs a spill store`.

**Cause.** The write cap saves the cut text somewhere, and you did not say where.

**Fix.** Pass `spill: fileSpillStore({ dir })` from `@buildanagent/harness/context/file`, or `memorySpillStore()` in a test. To drop the cap instead, pass `layers: { write_cap: false }`.

### The agent forgets a detail from early in a long conversation

**You see.** After many turns, the agent no longer knows a file name or an error message that you gave it early on.

**Cause.** The context policy you passed to `createHarness({ context })` summarized the older messages because the context passed its budget. The summary left the detail out. The log still holds the originals.

**Fix.** Ask the summary to keep what matters with `summarize: { focus: "file names and error messages" }`, and raise `budgetTokens` if the model's window allows. To see what the model read, call `session.toContext()`. The original messages stay readable with `session.playback()` until you delete the session.

## Tools

### The model calls a tool and gets an error that says there is no such tool

**You see.** A tool result comes back as an error that reads `There is no tool named "glob"` and lists the tools the model may use, though your code registered `glob`.

**Cause.** The turn's `tools` list left `glob` out, so the request did not offer it. A registered tool that the turn does not offer has the same effect as one that does not exist.

**Fix.** Add the name to the `tools` list, or leave `tools` out to offer every tool. A name in the list that the registry lacks throws `invalid_turn_options` before the turn starts, so check the spelling first.

### Registering a tool throws `duplicate_tool`

**You see.** `register()` throws a `DuplicateToolError` with the code `duplicate_tool` and the message `the tool name "order_status" is already registered: builtin already holds it`. The text after the colon names the source that holds the name.

**Cause.** A tool with that name is already in the registry.

**Fix.** Give each tool its own name. A tool from an extension or the client replaces a built-in tool of the same name only when it passes `override: true`. Any other repeat of a name throws.

Next, browse the [harness API reference](/reference/harness/).
