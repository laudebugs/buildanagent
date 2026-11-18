# N13: Signed approvals in the log: key ring, pause, resume with re-evaluation

| Field | Value |
| --- | --- |
| ID | `N13` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 3](../../plans/build-harness.md#43-stage-3-adds-the-registry-the-permission-pipeline-signed-approvals-and-code-initiated-calls) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N12](N12-permission-pipeline.md), [N7](N7-rebuild-resume-replay.md) |
| Size | M |

## Goal

Make every approval a signed pause in the log that survives restarts and resumes in any process, with a host-only key ring and a policy re-check on resume that lets a deny win.

## Context

- [HD5](../../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5): the decision and its evidence
- [ADR 0015](../../decisions/0015-harness-approval-key-ring.md), [ADR 0005](../../decisions/0005-approval-signing.md): the decision records
- [SDK D5](../../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-accepted-with-hd5): the signer interface
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): need 7

## Scope

**In scope**

- `approval_requested` and `approval_resolved` entry types, added to the union and schema
- `fileKeyStore()` with `load`, `rotate`, `prune`; mode `0600`; outside the sandbox and the log
- `hmacSigner()` passed on every `run` and `continueRun`
- `Approvals.pending()` and `Approvals.resolve()`: append the resolution, re-run the pipeline on each allow, then `continueRun`
- `ResolveOptions` with `budgetUsd`, `signal` and `hostContext`, passed to the resumed run like a turn's (R9)
- `approval/list` data for the protocol (wired in N27)

**Out of scope** (and which todo covers it)

- Sticky, grouped and quorum resolution (N14)
- Protocol server requests (N28)

## Tasks

- [ ] Write the `approval_requested` entry before emitting anything to a client.
- [ ] Resume from a second process in the test: a child process opens the session file and resolves.
- [ ] Test rotation: sign with key `a`, rotate to `b`, resolve, then `prune` removes `a`.

## Acceptance criteria

- [ ] A gate `ask` ends the turn `awaiting_approval` with one `approval_requested` entry
- [ ] A second process resolves it and the call runs once
- [ ] A tampered entry signature runs nothing and re-issues the request
- [ ] A deny rule added after the pause turns an `allow` resolution into a denial result
- [ ] A resume whose remaining session cap is below the next call's projection ends `budget` before the call (R9)
- [ ] `prune` keeps any key named by an unresolved request
- [ ] No key bytes appear in any entry, event or environment passed to a sandbox
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/permissions/approvals.test.ts`, `keystore.test.ts`, `approvals-second-process.test.ts`.

## Docs to update

`packages/harness/README.md`: approvals and keys. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

The owner's HD5 answer may change the key store's default path or require a remote store; the `KeyStore` interface absorbs both.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
