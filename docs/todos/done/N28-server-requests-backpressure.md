# N28: Server requests, cancellation, bounded queues and reconnect

| Field | Value |
| --- | --- |
| ID | `N28` |
| Status | `done` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N27](../done/N27-dispatcher-core.md), [N13](../done/N13-signed-approvals.md) |
| Size | M |

## Goal

Finish the protocol's hard parts: approvals, clarifications and client tools as server requests that are never dropped, cancellation of any request, bounded queues that reject instead of hanging, and reconnect from a sequence number.

## Context

- [harness guide §8](../../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport): Pi's disposition, Claude's cancel, Codex's 128-slot queues and `-32001`
- [HD5](../../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5): the decision and its evidence
- [build-harness.md §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the API sketch

## Scope

**In scope**

- `approval/request` and `clarification/request` sent after the `approval_requested` entry is durable; the response resolves through `Approvals.resolve()`
- `tool/call` for `client_request` tools
- `$/cancelRequest` for both directions
- Command queue of 128; a full queue rejects with `-32001`; notifications may drop under load with a gap marker, server requests never
- `session/open` with `fromSeq` replaying events after a sequence

**Out of scope** (and which todo covers it)

- Network transports (non-goal)

## Tasks

- [x] Send `approval/request` and `clarification/request` only after the `approval_requested` entry's append resolves; route each response through `Approvals.resolve()`.
- [x] Send `tool/call` for `client_request` tools and resolve the SDK tool call with the client's result.
- [x] Implement `$/cancelRequest` in both directions: a cancelled server request rejects its pending promise, and a cancelled `turn/start` aborts the run.
- [x] Bound the command queue at 128 and reject the overflow with `-32001`; let notifications drop under load with a gap marker, and never drop a server request.
- [x] Number events with `seq`, keep a replay window per session, and serve `session/open` with `fromSeq`.
- [x] Test a client that disconnects with a pending approval and reconnects: `initialize` re-arms it.

## Acceptance criteria

- [x] An approval request survives a client disconnect and is re-sent on reconnect
- [x] Filling the command queue returns `-32001` for the 129th command
- [x] Under a flood of events, no server request is lost (asserted by count)
- [x] Cancelling a `turn/start` aborts the run and still emits `turn/settled`
- [x] Reconnecting with `fromSeq` replays exactly the missed events
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/server/requests.test.ts`, `backpressure.test.ts`, `reconnect.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The dispatcher in `@buildanagent/harness/server` now asks clients for approvals, clarifications and client tool calls, cancels in both directions, bounds each connection's queues and replays a session from a sequence number. The tests are in `packages/harness/test/server/requests.test.ts` (13), `backpressure.test.ts` (7) and `reconnect.test.ts` (9), with one more in `dispatcher.test.ts`. Each acceptance criterion's test was checked by breaking the code it covers and watching the test fail.

**Wire additions** (in `@buildanagent/protocol`, with the zod mirror, the JSON Schema and fixtures in step):

- `session/open` takes an optional `fromSeq`, the first sequence number to replay. `session/create` no longer shares its params shape.
- `HarnessEvent` gains `{ type: "events_dropped", count }`, the marker for events dropped under load.
- The server may send `$/cancelRequest` to withdraw one of its own requests, so the method is in both `CLIENT_METHODS` and `SERVER_NOTIFICATION_METHODS`.
- No error code is new: a full queue answers with the existing `QueueFull` (-32001), and a bad `fromSeq` with `InvalidParams`.

**Decisions.**

- **A request is sent once its entry is durable, from the store wrapper.** The dispatcher asks every watching connection as soon as the `approval_requested` append resolves, not after `turn/settled`, so a client can show the question while the paused step finishes. An answer that arrives before the turn settles waits for it.
- **The first answer wins, and the others are withdrawn.** The dispatcher keeps the first well-formed answer to each signed request, sends `$/cancelRequest` for the same question on every other connection, and ignores any later answer. An answer must hold exactly one resolution naming the request it was asked about. A malformed one is asked again on the same connection, and an error response leaves the request waiting in the log.
- **An answer resumes the session as a turn of its own.** It goes through `Approvals.resolve()` (the new `approvals` option, default `createApprovals(harness)`) once the session is free, with its own turn id and `turn/settled`. Under the lock, the dispatcher first drops an answer whose request no longer waits, so two processes can't both resolve one request. `resumeTurn()` gained per-resume `observers` and a `clientTool` runner, so a resume streams events and reaches client tools like a turn.
- **`initialize` lists the pending requests, and `session/open` sends them again.** The brief said `initialize` re-arms a request. Sending it from `initialize` would give a client a request from a session it never opened, against N27's rule that a connection reaches only the sessions it created or opened. So `initialize` lists the requests in `pending`, and the server asks again, under new ids, once the client opens the session.
- **A client tool's call goes to the turn's owner.** That is the connection that started the turn, or for a resume the one whose answer started it. The alternative, any watching connection, could send the call to a client that lacks the tool. A call never hangs: with no owner, on close, or for a bad answer the model gets an error result. A `client_request` tool's call goes to the client only through the dispatcher; `runTurn()` without `clientTool` still runs the tool's own `execute`, so existing callers see no change.
- **The log is the replay window.** The plan asked for a replay window per session. An in-memory window would be stale as soon as a second process wrote the session, and empty after a restart. The log holds every entry, so `fromSeq` replays from the session's current file, and no `fromSeq` is too old. One past the last entry replays nothing, and anything further is refused with `InvalidParams`. Only entries are replayed: streamed events such as text deltas are transient, and the entries after them hold the same content.
- **An open holds the session's live events until its replay has gone out.** Events and `turn/settled` that arrive while the log is read wait, and an entry the replay already carried is left out, so nothing is lost, sent twice or sent before the response.
- **One `queueSize` bounds both queues, and a command keeps its place until its response has gone out.** Counting until delivery means a client that doesn't read gets `QueueFull` instead of growing the server's memory. Only live events are dropped. Responses, server requests, `turn/settled`, cancels, markers and replays are never dropped, and what produces each bounds it. A `send` that returns a promise is what makes a client slow; the in-process transport takes each message at once and never loses an event.
- **Only `turn/start` can be cancelled by the client.** Its id stays live until the turn settles, so a cancel after the disposition still aborts the run. A cancel for any other request does nothing and that request is answered as usual, which JSON-RPC allows. Answering a cancelled request with an error would have needed a new code such as LSP's -32800.
- **The dispatcher announces only entries written to the session's current file.** Before, a child session's header written through the same store would have reached its parent's stream with the child file's sequence numbers, and replay would have disagreed with the live stream.

**N27's named limits.**

- **Closed: a steer queued before the run exists when the turn fails first.** The steer belongs to the turn its disposition named and ends with it: `turn/settled` reports the failure, and the log holds no message for the steer. A test pins the behaviour, and the dispatcher now clears the queue when a turn ends.
- **Deferred again: `session/list` and `initialize` scan every session on each call.** N28 adds one read per open and per resume, but leaves both scans as they were. No todo owns the fix yet.
- **Deferred again: a created session that never takes a turn stays in the dispatcher's map.** N28's per-session state, the answers waiting for a resume, empties itself, so it adds nothing that stays.

**Named limits.**

- `Resolution.by` reaches `Approvals.resolve()` as the client sent it. The transport is where a host authenticates its clients; neither the protocol nor the dispatcher does.
- The `group` member of `approval/request` is never sent, and grouped or sticky answers can't be given over the protocol yet, because `ResolveOptions` has no wire form.
- A replay holds its entries in the connection's queue until they go out, so it costs memory in proportion to what it sends, as opening a session already does.
- A replay reads the session's current file. After a revert or a migration moves the session to a new file, whose sequence numbers start again, a `fromSeq` the client kept from the old file names a position in the new one.

**Open questions for the owner.**

- Should the protocol carry the approver's identity in a way the server checks, rather than trusting `by`?
- Proposed change 6 of the [connectors report](../../research/connectors/agent-connectors.md) adds an "authorization required" server request to this todo. It was a proposal when N28 started, so N28 does not implement it; it needs its own decision and todo.
