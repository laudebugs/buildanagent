---
title: The server answers every client from one dispatcher
description: How a dispatcher serves protocol commands over a harness, starts turns, asks every watching client for approvals and replays what a reconnecting client missed.
---

You will connect a client, such as an editor or a script, to a harness and start its turns with protocol messages. You need this when a program other than your own loop must drive the agent and answer its questions.

Check who is connecting before you hand a transport its streams or socket. The transports authenticate nobody, so whoever holds them acts as the dispatcher's user and can answer approval requests. For a WebSocket, check the caller's identity and its `Origin` header first, because the transport makes no such check. A web page in the user's browser can open a socket to a local server, and without the check it could approve your agent's tool calls. The dispatcher is the object that serves the protocol's commands over a harness, and the [protocol](/protocol/quick-start/) is the set of messages a client sends. Both need a harness from [the quick start](/harness/quick-start/).

## A client in the same process needs no framing

`createDispatcher()` from `@buildanagent/harness/server` takes a harness, a session store, an index, a lock and the user's id. `inProcessTransport()` connects a client that runs in the same process. Its `request()` resolves with the result of a command, or rejects with an `RpcFailure` that holds the error code and message.

This client answers every approval request with `allow`. `onMessage()` hears the server's notifications and requests, and `respond()` answers a request. Its type allows only the result type of that request's method, so an approval cannot be answered with a tool result. The client then says who it is, creates a session and starts a turn:

```ts file="packages/harness/examples/in-process-client.ts" region="client"
```

This handler allows every request, which suits only a scripted example. A real client shows the person the request's `tool`, sends the `allow` or `deny` the person chose, and sets `by` after it has authenticated that person.

`turn/start` answers first with a disposition: `{ accepted: true, turn }`, or `{ accepted: false, reason }`. The reason is `busy` when this dispatcher already runs a turn in the session, `locked` when another process holds the session's lock, and `invalid` for a session the connection never created or opened. The turn's events follow as `event` notifications, and every turn ends with one `turn/settled`.

## A request for a person goes to every watching client

When a call needs a person, as [Permissions](/harness/permissions/) describes, the turn ends and the dispatcher sends `approval/request` to every connection that watches the session. It sends the request only after the log holds the `approval_requested` entry, so a client that hears of a request can always find it in the log.

The first answer wins. The dispatcher withdraws the same question from every other connection with `$/cancelRequest` and ignores a later answer. An answer resumes the paused turn as a turn of its own, once the session is free. The `by` field of an answer passes through unchecked, so authenticate clients before you give them a transport.

Nothing holds a session open while a client thinks. A client that never answers costs one entry in a table until its connection closes, and the request stays in the log. A client that joins later finds waiting requests in the `initialize` response and is asked again when it opens the session.

## Two transports carry the same messages to another process

`stdioTransport()` serves one client over a pair of byte streams, such as a program's standard input and output. Each message is one line, and the output carries protocol lines only, so send diagnostics to the standard error stream. `webSocketTransport()` serves one client on one WebSocket, with one JSON message in each text frame.

The dispatcher bounds what a slow client can cost, whichever transport it uses:

- **Commands.** A connection holds at most 128 unanswered commands. The 129th gets the JSON-RPC error `-32001` with the message "the queue holds 128 commands; send again later".
- **Events.** While a slow client keeps messages waiting, at most 128 live events wait with them. The server drops the rest and sends an `events_dropped` marker that says how many.
- **Never dropped.** Responses, requests the server sends, `turn/settled` and the marker always go out.

## A reconnecting client replays what it missed

A client that lost events, or reconnected after its socket dropped, sends `session/open` with `fromSeq`, the sequence number of the first entry it lacks. The dispatcher reads the session's log from that entry and sends each entry as an `entry_appended` event, then the live stream. The log is the replay window, so no `fromSeq` is too old, and a second process replays what the first wrote. Only entries replay. Streamed text deltas are transient, and the entries that follow hold the same content.

A client cancels its own `turn/start` by sending `$/cancelRequest` with that request's id. The turn still ends with one `turn/settled`, with the stop reason `aborted`.

Next, read how [extensions](/harness/extensions/) add hooks and tools.
