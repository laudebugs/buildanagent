# N27: Dispatcher and in-process transport: `initialize`, turns, events, `turn/settled`

| Field | Value |
| --- | --- |
| ID | `N27` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N26](../done/N26-protocol-package.md), [N7](../done/N7-rebuild-resume-replay.md), [B16](B16-steering.md) |
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

- [ ] Return `{ accepted: false, reason: "locked" }` when the session lock says `would_block`.
- [ ] Use placeholder capabilities until B20 lands, and test only that they are passed through.

## Acceptance criteria

- [ ] `turn/start` replies with a disposition before the first event
- [ ] Each turn emits exactly one `turn/settled`, after any retry or compaction
- [ ] A second client's `turn/start` on a locked session gets `accepted: false`
- [ ] `initialize` on a session with a pending approval lists it
- [ ] `session/fork` without opting in returns `NotOptedIn`
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/server/dispatcher.test.ts`.

## Docs to update

`packages/harness/README.md`: driving the harness in process. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Depends on §3.6 need 11 for the final capability list; N35 checks it after B20.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
