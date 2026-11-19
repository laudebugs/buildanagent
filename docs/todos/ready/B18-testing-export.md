# B18: Complete the `testing` exports: `autoResponder`, seam doubles, record and replay, mock server

| Field | Value |
| --- | --- |
| ID | `B18` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B8](../ongoing/B8-anthropic-adapter.md), [B9](B9-openai-chat-adapter.md), [B15b](B15b-continue-run.md) |
| Size | M |

## Goal

Finish the `testing` exports so users of the SDK, and the harness, can test agents offline with the same safety rules our verification harnesses learned.

## Context

- [agent-SDK guide §8](../../guides/agent-sdk.md#8-the-sdk-should-ship-a-strict-scripted-test-model-in-a-testing-export-from-the-first-release): five safety rules, record and replay at the normalised boundary
- [test strategy §5](../../plans/build-sdk.md#5-test-strategy)

## Scope

**In scope**

- `autoResponder()` with a default host-tool deny list matched by name (`bash`, `exec_command`, `shell`, `write`, `edit`, `delete`)
- `scriptedApprovals()` and scripted doubles for the approval and MCP seams, and `testSigner()`, which re-exports [E3](E3-signed-approvals-third-party.md)'s fixed-key test signer (plan review 2, 2026-11-19)
- `recordPairs()` and `replayPairs()` at the normalised request and response boundary, stamped with SDK, provider and model versions and an expiry
- `startMockServer()` bound to 127.0.0.1, writing a JSONL request log

**Out of scope** (and which todo covers it)

- A sandbox double: the sandbox interface is P2's; add the double when P2 defines it

## Tasks

- [ ] Synthesise tool arguments from JSON Schema as the existing mock does.
- [ ] Reject replay of expired or mismatched stamps with a typed error.
- [ ] Strip `authorization` and API-key headers from anything recorded.

## Acceptance criteria

- [ ] `autoResponder()` never calls a tool on the deny list, even when it is the only tool offered (it answers in text instead)
- [ ] A recorded run replays through `replayPairs()` to the same event log
- [ ] An expired recording throws on replay
- [ ] No recorded pair contains an `authorization` or `x-api-key` header
- [ ] `startMockServer()` refuses to bind to a non-loopback address
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/testing-export.test.ts`, `packages/gateway/test/mock-server.test.ts`.

## Docs to update

`packages/sdk/README.md`: the testing guide. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Record and replay must never capture real credentials; the header strip is tested.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
