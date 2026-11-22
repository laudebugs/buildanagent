# N27: Dispatcher and in-process transport: `initialize`, turns, events, `turn/settled`

| Field | Value |
| --- | --- |
| ID | `N27` |
| Status | `done` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N26](../done/N26-protocol-package.md), [N7](../done/N7-rebuild-resume-replay.md), [B16](../done/B16-steering.md) |
| Size | M |

## Goal

Build the one dispatcher every interface talks to, with the in-process transport first, so a turn is accepted with a disposition, streams events with sequence numbers, and ends with exactly one `turn/settled`.

## Context

- [harness guide §8](../../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport): disposition plus `turn/settled`; capabilities and pending set in `initialize`; resume cursor is the log's sequence
- [build-harness.md §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the API sketch
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): need 11

## Scope

**In scope**

- `createHarness()`, `createDispatcher()`, `inProcessTransport()`
- `initialize` returning capabilities (from `run_start.capabilities` plus the harness's), `experimental` and `pending`
- `session/create`, `session/open`, `session/list`, `turn/start`, `turn/steer`, `turn/followUp`, `turn/interrupt`, `approval/list`
- `event` notifications with `seq` equal to the entry sequence where one exists
- `turn/settled` after the SDK's `agent_settled`, never after `run_end` alone
- The experimental gate: an un-opted method returns `NotOptedIn`

**Out of scope** (and which todo covers it)

- Server requests, cancellation and queues (N28)
- stdio (N29)

## Tasks

- [x] Return `{ accepted: false, reason: "locked" }` when the session lock says `would_block`.
- [x] Use placeholder capabilities until B20 lands, and test only that they are passed through.

## Acceptance criteria

- [x] `turn/start` replies with a disposition before the first event
- [x] Each turn emits exactly one `turn/settled`, after any retry or compaction
- [x] A second client's `turn/start` on a locked session gets `accepted: false`
- [x] `initialize` on a session with a pending approval lists it
- [x] `session/fork` without opting in returns `NotOptedIn`
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/server/dispatcher.test.ts`.

## Docs to update

`packages/harness/README.md`: driving the harness in process. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Depends on §3.6 need 11 for the final capability list; N35 checks it after B20.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`createDispatcher()` and `inProcessTransport()` are in `@buildanagent/harness/server`, with ten tests in `packages/harness/test/server/dispatcher.test.ts`. `turn/start` claims the session before its first await, answers with its disposition, and only then starts the run, so no event reaches a client first. `runTurn()` gained a per-turn `observers` option, which unlike `Run.on()` also sees `run_start`. The dispatcher wraps the store to announce each appended entry with its own `seq`, and sends one `turn/settled` after `runTurn()` resolves or throws. Not done, and left to N28: cancellation of a request in flight, bounded queues, server requests and reconnect. The file for the in-process transport is `local-transport.ts`, because the portability test's `\bprocess\s*[.[]` pattern matches the import path `./in-process.js`.
