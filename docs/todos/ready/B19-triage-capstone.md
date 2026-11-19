# B19: Triage capstone and the conformance suite

| Field | Value |
| --- | --- |
| ID | `B19` |
| Status | `ready` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B12](B12-parallel-tools.md), [B14](../done/B14-budget-progress.md), [B15b](../done/B15b-continue-run.md), [B16](B16-steering.md), [B18](../ongoing/B18-testing-export.md) |
| Size | M |

## Goal

Prove the SDK end to end: write the support-triage capstone that every reference implements, on our SDK, and run it on the scripted model and both mock transports.

## Context

- [deep comparison §1](../../comparison/deep-comparison.md#1-the-same-agent-takes-58-to-115-lines-on-every-sdk-and-differs-in-its-gate): the capstone contract and the per-SDK rows
- [test strategy §5.3](../../plans/build-sdk.md#53-the-triage-capstone-checks-the-whole-sdk-against-the-reference-capstones): the rows this capstone must satisfy

## Scope

**In scope**

- `packages/sdk/examples/triage-agent.ts`: a read-only `lookup_customer`, an approval-gated `escalate`, an `outputTool` result, an audit observer, a step cap and a budget
- Three cases: approved escalation, rejected escalation, and a result that fails its schema
- Runs on `ScriptedModel` and on the Anthropic and Chat Completions mock transports
- A resume from a JSON-serialised `context` in a fresh run, standing in for a second process
- The D6 hook count, recorded

**Out of scope** (and which todo covers it)

- A real-model run (the harness's evals, N37 and N38)
- The readable reference loop (B19b)

## Tasks

- [ ] Write the capstone from the reference capstones' contract, not by copying any one of them.
- [ ] Add a forged-signature case that must run nothing.
- [ ] Count non-blank, non-comment lines as the deep comparison does, and add our row to a short results note in the package README.
- [ ] Export the capstone's test cases as a conformance suite that takes a `run` function, so B19b can run the same cases on the reference loop.

## Acceptance criteria

- [ ] All three cases pass on `ScriptedModel` and on both mock transports, with `assertComplete()`
- [ ] The forged-signature case runs no tool
- [ ] Only `lookup_customer`, `escalate` and the output tool appear in any recorded request
- [ ] The conformance suite takes a `run` function and passes on the SDK's `run`
- [ ] The README records the capstone's line count and hook count beside the reference figures
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/examples/triage-agent.ts` and `packages/sdk/test/capstone.test.ts`.

## Docs to update

`packages/sdk/README.md`; the deep comparison may later gain a row for our SDK (a follow-up, not this todo). The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The reference loop moved to B19b on the P4 review's advice (R25), which brings this todo to size M.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
