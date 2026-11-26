---
title: Sessions keep a conversation in a log you can fork
description: How a session stores one conversation as a log of entries, lets one writer at a time append and forks into a second conversation.
---

You will see how the harness keeps one conversation as a session: its entries are written to disk, survive a crash, continue in a new process and can fork into a second conversation. You need this when a conversation must outlive one process.

## A session is a log of entries

A session holds one conversation as an append-only log: the harness adds entries and never edits one. With the file store the log lives in one log file, and other stores keep the same entries elsewhere. Every entry carries an `id`, the `parentId` of the entry it follows, a sequence number, a timestamp, a `type` and an `origin`. The `parentId` links make the log a tree, which stays a single chain until you fork it. HEAD is the entry the next append follows, and each new entry moves it to itself.

There are 21 entry types, from `session_header` to `product_record`. The [session file page](/protocol/session-files/) shows how to read them.

The file store writes one entry per line to the log file `<folder>/<user>/<session>.jsonl`. Each append is one write of whole lines followed by an `fsync`, which asks the operating system to put the bytes on disk. A crash therefore leaves at most one unfinished last line, and the next append cuts it off.

## A key names the user and the session

A session's key is `{ userId, sessionId }`. Every store call takes both, so no call finds a session by its id alone. A session that belongs to another user looks like one that does not exist: loading it yields nothing and listing it leaves it out. Name the user even on a host that isolates users some other way, because adding the user later would change every caller.

## One writer holds the lock

Only one process may append to a session at a time. `fileLock()` keeps one lock file for each session and gives the lock to the first caller. `openSession()` takes the lock when you pass one, and it throws `session_locked` when another writer holds it. A session opened without a lock can read and cannot write.

By default, the holder renews its lease, a time limit on the lock, every 10 seconds, and each lease lasts 30 seconds. The `leaseMs` and `renewMs` options change both, and a renewal never waits longer than a third of the lease. Another process may take a lock only when its lease has lapsed and, on the same host, its process no longer exists. A lock from another host is never taken. Use the file lock on a local disk only, because an exclusive file create is not reliable on a network file system.

## A new process goes on from the log

A turn that passes no `history` rebuilds the session's conversation from the log. A process that opens the session later therefore goes on from the log without any state of its own. If the harness has a [context policy](/harness/context/), the policy may shrink what the model reads.

A crash can leave a tool call with no result in the log. Before it writes anything, the next turn settles each open call. A call to a tool that declares a write, or to a tool the registry no longer holds, gets an `unknown` outcome with the advice to check before retrying, because the write may have taken effect. A call to any other tool gets an error that says it was interrupted, which the model may retry.

## A fork starts a second conversation from an earlier entry

`fork()` starts a new session from one entry of the log. The fork's log file holds a header that names the parent session's log file and that entry as its parent, and a `checkout` entry that moves HEAD to the entry. The fork reads every entry up to that point from the parent's log file and copies none. This function forks a session at one entry, asks a new question in the fork and reports what the fork shares and adds:

```ts file="packages/harness/examples/session-fork.ts" region="fork"
```

The fork gets a new session id, and the original session is unchanged. In the figure, `chat-1` holds its header, turn 1 and turn 2. The fork's header names `chat-1` as its parent and turn 1 as the entry the fork follows, and the fork's own new turn comes after it. Turn 2 stays in `chat-1`. For a fork at the end of the first turn, the path holds nine entries, and the fork's own turn adds six.

::figure[A fork shares the first turn and writes its own after it]{id="session-log" alt="A fork shares the parent session's first turn and writes its own turn after it."}

Two other moves change where a session goes. `checkout(id)` appends an entry that moves HEAD to `id`, and a later append follows that entry, so the abandoned branch stays in the log. `revert(id)` writes the same kind of log file as a fork and points the session at it: the old log file keeps every entry, but the entries after `id` are no longer part of the session. `child()` starts a subagent's conversation as its own session and shares nothing with the parent's.

## Nothing is deleted unless you ask

The file store never deletes or moves a log file. To expire old sessions, pass `retention: { days, action }` to `jsonlStore()`. The action `archive` compresses a session's log files into an archive folder, and `purge` deletes them. The package sets no default period, and `days` must be a positive number.

Next, see how the [context](/harness/context/) of a long conversation stays inside the model's window.
