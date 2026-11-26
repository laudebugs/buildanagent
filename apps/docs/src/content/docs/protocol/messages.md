---
title: Messages between a client and the harness
description: How a client opens a session, starts a turn and reads what the harness sends back over one JSON line at a time.
---

You will see how a client talks to the harness: which requests it writes, which messages come back and which rules keep the stream readable. You need this before you write a client that runs turns.

## Any program that writes JSON lines is a client

Every message is a JSON-RPC 2.0 message, the standard way to call methods with JSON ([specification](https://www.jsonrpc.org/specification)), written on one line. `buildanagent rpc` is the server: it serves one client over its standard input and output, so an editor, a script or a program in another language can drive the harness through it. The server reads each command and hands it to the harness, which runs the sessions and the turns. It then writes the answers and events back.

::figure[Any program that writes JSON lines can drive the harness]{id="protocol-clients" alt="Any program that writes JSON-RPC lines, such as an editor or a script, can drive the harness through buildanagent rpc, which passes each message on."}

## Open a session and start a turn

A client sends `initialize`, then `session/create` or `session/open`, then `turn/start`. The client waits for each response before it sends a command that depends on it, because the server may answer commands out of order. These functions write the last two requests:

```ts file="packages/protocol/examples/client-requests.ts" region="requests"
```

`turn/start` answers with a disposition, which says whether the server took the turn: `{ accepted: true, turn }`, or `{ accepted: false, reason }` with a reason of `busy`, `locked` or `invalid`. Every accepted turn ends with a `turn/settled` notification that carries the stop reason.

## Read what the server sends

The server sends four kinds of message: an error, an answer to a request, a request of its own and a notification. This function tells them apart:

```ts file="packages/protocol/examples/client-requests.ts" region="reply"
```

The server's own requests are `approval/request`, `clarification/request` and `tool/call`. The client answers each with a response that has the same id. Events arrive as `event` notifications that carry a sequence number.

## Read a stream that arrives in pieces

The server's output arrives in chunks of any size. This function frames the chunks, checks each message and reports each bad line without stopping the lines after it:

```ts file="packages/protocol/examples/read-stream.ts" region="read"
```

## Keep standard output for protocol lines

Four rules govern the stream over standard input and output:

- **Standard output holds protocol lines only.** The server writes its diagnostics to standard error, so a line on standard output that is not a message means the server is broken.
- **A bad line gets an error, and the stream goes on.** A line that is not JSON gets `ParseError` (-32700). A message without a valid envelope, a JSON-RPC batch (several messages in one array) or a line over 8 MiB gets `InvalidRequest` (-32600).
- **A client that stops reading loses events.** The server drops the events past its queue bound and replaces them with an `events_dropped` marker.
- **Closing standard input ends the connection.** The server answers every command it has read, then closes. A turn still running goes on, but its events have nowhere to go, so a client that wants `turn/settled` keeps its input open until that notification arrives.

Next, read a [session file](/protocol/session-files/).
