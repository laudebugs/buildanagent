# N35: Harness triage capstone, second-process resume and the granularity test (HD1)

| Field | Value |
| --- | --- |
| ID | `N35` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N29](N29-stdio-transport.md), [N30](N30-cli.md), [N34](N34-ablation-switches.md), [B19](B19-triage-capstone.md), [B20](B20-versioning-docs.md) |
| Size | M |

## Goal

Run the SDK's triage capstone inside the harness end to end, resume its approval from a second process over stdio, replay it byte for byte, and settle HD1 by recording it at three granularities.

## Context

- [build-harness.md §5.4](../../plans/build-harness.md#54-the-harness-triage-capstone-checks-the-whole-stack-against-the-sdks-capstone): the capstone rows
- [SDK plan §5.3](../../plans/build-sdk.md#53-the-triage-capstone-checks-the-whole-sdk-against-the-reference-capstones): the SDK capstone
- [HD1](../../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-provisional): the decision and its evidence

## Scope

**In scope**

- `packages/harness/examples/triage-session.ts` using the B19 capstone's tools on the harness
- Approved, rejected and policy-changed-after-pause cases
- A second process (`buildanagent rpc`) resolving the pause
- Playback and the byte-identical check
- An HD1 note: file size, playback fidelity and resume code size at per-delta, per-block and per-message granularity
- Recorded sessions saved as offline replay fixtures for N36
- The final `initialize` capability list from B20

**Out of scope** (and which todo covers it)

- Real-model runs (N38)

## Tasks

- [ ] Port B19's capstone tools into `packages/harness/examples/triage-session.ts` and register them with no built-ins.
- [ ] Run the approved, rejected and policy-changed-after-pause cases on `ScriptedModel` through `runTurn()`.
- [ ] Resolve the pause from a second process over `buildanagent rpc`, and check the call ran once.
- [ ] Play the session back and compare the files byte for byte.
- [ ] Scan every entry and span for the provider key and the injected credential.
- [ ] Write the per-delta and per-message recorders as test-only observers; keep only per-block in the package, and write the HD1 note.
- [ ] Save the recorded sessions as N36's replay fixtures, and check `initialize` against B20's `CAPABILITIES`.

## Acceptance criteria

- [ ] All capstone rows in §5.4 pass on `ScriptedModel`
- [ ] The second-process resolution runs the approved call once
- [ ] Playback is byte-identical
- [ ] No provider key or injected credential appears in any entry or span
- [ ] The HD1 note exists and ADR 0013's status reflects its result
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/capstone.test.ts`.

## Docs to update

`packages/harness/README.md`: the capstone; ADR 0013 status. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

If B19's capstone changes shape, adapt the tools, not the rows.

## Revision (2026-11-18, SDK gaps)

The rewind report found that the capstone has no crash test, so "exactly once" in our plans means "once, if nothing crashes" ([rewind report](../../research/reversible-actions/rewind-vs-rollback.md#two-ledgers-and-the-first-fields-to-add)). Gap 2 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) adds:

- [ ] Kill the harness process after a fake external system accepts a write and before its `tool_result` is appended; the resumed session reconciles to `applied` and sends nothing twice.

The rule under test comes from the [N7](N7-rebuild-resume-replay.md) revision, which N35 already follows through its dependencies.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
