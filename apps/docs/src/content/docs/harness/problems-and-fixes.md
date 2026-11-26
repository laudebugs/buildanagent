---
title: Problems and fixes
description: Twenty-three problems you may hit with sessions, context, tools, permissions, the sandbox, the server and extensions, each from what you see, to its cause, to its fix.
---

You will find twenty-three problems, each written from what you see to why it happens and how to fix it. You need this page when a turn throws an error or the agent acts in a way you did not expect.

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

## Permissions

### A tool call is denied and the reason says nobody can be asked

**You see.** A call to a tool does not run. Its denial reads `No rule covers this call and nobody can be asked, so it is refused.`, and the log's permission decision entry for the call carries the same reason.

**Cause.** The permission pipeline has `interactive: false`, so nobody can answer a question, and no deny, ask or allow rule names the tool. With no host callback, such a call is denied.

**Fix.** Add an allow rule for the tool, as the [permissions page](/harness/permissions/) shows. If a person can answer, set `interactive: true` and the call asks instead.

### Answering an approval throws `approval_unavailable`

**You see.** `resolve()` on the object that `createApprovals()` returns throws a `HarnessError` with the code `approval_unavailable` and the message `the harness has no signer, so no approval can be checked`.

**Cause.** The harness was built without a `signer`. A signer signs each pause and checks each answer, so a harness without one cannot tell a real request from a forged one.

**Fix.** Pass a signer to `createHarness()`, such as `hmacSigner()` from `@buildanagent/sdk`, built from a key ring that every process which may answer can load.

### Answering an approval throws `approval_not_pending`

**You see.** `resolve()` throws a `HarnessError` with the code `approval_not_pending`. The message reads `no request <id> is waiting in this session`, or `request <id> is answered twice in one resume` when one call holds two answers for the same request.

**Cause.** The request id is not waiting. Another process may have answered it already, the call may have a result, or the id may belong to another session.

**Fix.** Call `pending()` on the same object to list the requests that still wait, and answer one of those. Pass one answer for each request in a call.

## Sandbox and credentials

### `noneSandbox()` throws `unsafe_sandbox_not_acknowledged`

**You see.** `noneSandbox()` throws a `HarnessError` with the code `unsafe_sandbox_not_acknowledged` and the message `noneSandbox confines nothing, so it needs { unsafe: true } to say the caller knows`.

**Cause.** The `none` backend runs each command as you, with your files and network, so it asks you to say so. TypeScript flags the missing option, and JavaScript gets this error.

**Fix.** Pass `{ unsafe: true }` only on a machine that is already disposable. Otherwise choose a backend that confines commands, such as `srtSandbox()` or `dockerSandbox()`, as the [sandbox page](/harness/sandbox/) shows.

### A request through the egress proxy fails with `egress_denied`

**You see.** A fetch through the proxy rejects with a `HarnessError` with the code `egress_denied` and a message such as `the egress proxy refused evil.example: not_allowed`. A tunnel from the sandbox gets a 403.

**Cause.** The proxy allows only the names in its `allow` list, over HTTPS, on port 443 unless the entry adds a port. The word after the colon says which rule refused: not_allowed for a host that is not listed, only_https for a plain HTTP request and address_literal for a host written as an address.

**Fix.** For a host the sandbox should only tunnel to, add its exact name to `allow` and use HTTPS. For a host that carries a credential, send the request to the route's address on the proxy, `<proxy.url>/<route>/path`, because a request to the host's real URL is refused. Keep a git route's host out of `allow`, which the policy refuses. An address literal can never be listed, so use the host's name.

### `compileEgressPolicy()` throws `invalid_egress_options`

**You see.** `compileEgressPolicy()` throws a `HarnessError` with the code `invalid_egress_options`. One message reads `the egress policy holds what looks like a credential; name it in a route's credential instead`.

**Cause.** The policy holds a secret where only a name belongs, or breaks another rule. A string that starts like a token, such as `ghp_` or `sk-` with a long body, is refused. A wildcard in `allow`, a credential name that is not upper case and a git route whose host is also in `allow` are refused too. The message names the place of the entry and never its value.

**Fix.** Put the secret on the host and write only its upper-case name in the route's `credential`, such as `GITHUB_TOKEN`. Pass a `secret` function to `compileEgressPolicy()` that reads the value there.

### Provisioning a hosted sandbox throws `invalid_egress_options` for a git route

**You see.** `provision()` on the backend from `vercelSandbox()` or `e2bSandbox()` throws a `HarnessError` with the code `invalid_egress_options`. On Vercel the message reads `route 0 is a git route, and the Vercel firewall can't enforce its ref filter`. On E2B it reads `route 0 is a git route, and E2B can't filter a push by ref; reach git through the egress proxy`.

**Cause.** A provider's firewall cannot read a push's branch names, so it cannot enforce a git route's `pushRefs`. Only the host proxy can.

**Fix.** Remove the git route from the policy you pass to the hosted backend. Push through a host-side tool behind the [permission pipeline](/harness/permissions/), as the [sandbox page](/harness/sandbox/) describes.

## Server and clients

### `turn/start` answers `accepted: false`

**You see.** A client's `turn/start` resolves with `{ accepted: false, reason: "busy" }` or `{ accepted: false, reason: "locked" }`, and no events follow.

**Cause.** The reason `busy` means this dispatcher already runs a turn, a checkout or a fork in that session. The reason `locked` means another process holds the session's lock. A reason of `invalid` means the connection never created or opened the session.

**Fix.** For `busy`, wait for the running turn's `turn/settled` notification and send the command again. For `locked`, wait until the other writer closes its session, or stop that process. For `invalid`, call `session/create` or `session/open` on the same connection first.

### A client misses events and a command fails with `-32001`

**You see.** A client that reads slowly loses live events, and a marker takes their place that says how many were dropped. A client that sends faster than it reads gets the JSON-RPC error `-32001` with the message `the queue holds 128 commands; send again later`.

**Cause.** Each connection queues at most `queueSize` unanswered commands and at most `queueSize` waiting live events, 128 each by default. The server drops live events past the second bound and refuses commands past the first.

**Fix.** Read each message as it arrives. To catch up after a gap, send `session/open` with `fromSeq` one past the last entry you received. The server replays the entries from the log, and you drop by sequence number any entry you get twice. To hold more, raise `queueSize` in `createDispatcher()`, but a client that reads each message at once never reaches the limit.

### An approval is answered by a client you did not expect

**You see.** A tool call that should have waited for you was approved, and the answer's `by` names someone who was not at the keyboard, or a name you never set.

**Cause.** The transports authenticate nobody. Whoever holds the streams or the socket acts as the dispatcher's user, and the dispatcher passes `by` on as the client sent it. A web page in a browser can open a WebSocket to a local server, so a socket handed over without a check lets that page answer.

**Fix.** Check the caller's identity and its `Origin` header before you hand a WebSocket to `webSocketTransport()`, and close the socket of a caller you do not know. Set `by` yourself after you have authenticated the approver. The [server page](/harness/server/) says more.

## Extensions

### A project's extension does not load and a notice says it is skipped

**You see.** The extension never runs. The load result holds a notice that reads `the project extensions of <path> are skipped: the project is not trusted`, or `... are skipped: this run is headless`.

**Cause.** A project's extensions run in your process, so `loadProjectExtensions()` loads none of them unless the trust store holds the project's real path. A headless run skips them as well, even in a trusted project.

**Fix.** Read the extensions, then add the project to the trust store you pass in. For a headless run you have decided to allow, also pass `loadInHeadless: true`.

### Loading throws `extension_hash_mismatch`

**You see.** `loadProjectExtensions()` throws a `HarnessError` with the code `extension_hash_mismatch`. The message reads `the extension "audit" is refused: its files changed since they were pinned`, `the extension "audit" is refused: the lock file does not list it`, or `the extension "audit" is pinned but the project no longer holds it`. None of the project's extensions load.

**Cause.** The project has a lock file that pins each extension folder to a hash of its files, and a folder no longer matches it. A process that already imported a changed folder also refuses it, with the message `changed after this process loaded it; restart the process to load the new files`.

**Fix.** Read what changed. If you accept it, run `pinProjectExtensions(root)` again to write a new lock file. If a process imported the older files, restart it.

### Composing extensions throws `invalid_extension`

**You see.** `composeExtensions()` or `registerExtensionTools()` throws a `HarnessError` with the code `invalid_extension`. The message reads `two extensions are named "audit"` or `an extension needs a name and a version`.

**Cause.** Each extension needs a unique name and a version, because the session log records them by name.

**Fix.** Give every extension a distinct `name` and a `version`. A project extension whose module does not export a name and a version throws the same code.

Next, browse the [harness API reference](/reference/harness/).
