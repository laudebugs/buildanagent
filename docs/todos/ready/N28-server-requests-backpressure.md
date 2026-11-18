# N28: Server requests, cancellation, bounded queues and reconnect

| Field | Value |
| --- | --- |
| ID | `N28` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N27](N27-dispatcher-core.md), [N13](N13-signed-approvals.md) |
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

- [ ] Send `approval/request` and `clarification/request` only after the `approval_requested` entry's append resolves; route each response through `Approvals.resolve()`.
- [ ] Send `tool/call` for `client_request` tools and resolve the SDK tool call with the client's result.
- [ ] Implement `$/cancelRequest` in both directions: a cancelled server request rejects its pending promise, and a cancelled `turn/start` aborts the run.
- [ ] Bound the command queue at 128 and reject the overflow with `-32001`; let notifications drop under load with a gap marker, and never drop a server request.
- [ ] Number events with `seq`, keep a replay window per session, and serve `session/open` with `fromSeq`.
- [ ] Test a client that disconnects with a pending approval and reconnects: `initialize` re-arms it.

## Acceptance criteria

- [ ] An approval request survives a client disconnect and is re-sent on reconnect
- [ ] Filling the command queue returns `-32001` for the 129th command
- [ ] Under a flood of events, no server request is lost (asserted by count)
- [ ] Cancelling a `turn/start` aborts the run and still emits `turn/settled`
- [ ] Reconnecting with `fromSeq` replays exactly the missed events
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/server/requests.test.ts`, `backpressure.test.ts`, `reconnect.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
