# B19: Triage capstone and the conformance suite

| Field | Value |
| --- | --- |
| ID | `B19` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B12](../done/B12-parallel-tools.md), [B14](../done/B14-budget-progress.md), [B15b](../done/B15b-continue-run.md), [B16](../done/B16-steering.md), [B18](../done/B18-testing-export.md) |
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

- [x] Write the capstone from the reference capstones' contract, not by copying any one of them.
- [x] Add a forged-signature case that must run nothing.
- [x] Count non-blank, non-comment lines as the deep comparison does, and add our row to a short results note in the package README.
- [x] Export the capstone's test cases as a conformance suite that takes a `run` function, so B19b can run the same cases on the reference loop.

## Acceptance criteria

- [x] All three cases pass on `ScriptedModel` and on both mock transports, with `assertComplete()`
- [x] The forged-signature case runs no tool
- [x] Only `lookup_customer`, `escalate` and the output tool appear in any recorded request
- [x] The conformance suite takes a `run` function and passes on the SDK's `run`
- [x] The README records the capstone's line count and hook count beside the reference figures
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/examples/triage-agent.ts` and `packages/sdk/test/capstone.test.ts`.

## Docs to update

`packages/sdk/README.md`; the deep comparison may later gain a row for our SDK (a follow-up, not this todo). The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The reference loop moved to B19b on the P4 review's advice (R25), which brings this todo to size M.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked (drafted; the review is pending on the pull request)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

The capstone is `packages/sdk/examples/triage-agent.ts` (80 code lines, two hooks: the `beforeToolCall` gate and an audit observer). Its conformance suite is `packages/sdk/test/triage-suite.ts`, and `triageSuite(loop, backends)` takes a loop's `run` and `continueRun`, so B19b runs the same cases on the reference loop. `test/triage-backends.ts` plays one neutral script on `ScriptedModel` and on the Anthropic and Chat Completions mock transports, and `test/capstone.test.ts` runs the suite on all three. No changeset: the pull request changes no `src/`, `package.json` or `tsconfig.build.json`, and the README edit alone does not need a release.

Decisions:

- **The suite covers more than the three cases.** Beside the approved, rejected and invalid-result cases it checks a forged signature, a stored input that no longer matches its signature, the step cap and the budget, each on every backend.
- **The agent file holds no test scaffolding**, as the examples guideline requires, so its 80 lines are not comparable with the reference files, which include their scripted model and assertions. The README therefore reports a second row, 434 lines, for the agent plus the suite and the backends.
- **Hook count: two.** The gate and the audit observer, the same as LangChain's two pieces, so D6's tie stands.
- **The step cap and budget are tested through the example's constants**, and the budget case reports 1,000,000 input tokens so the next call's projection passes $0.25 on both priced models.
- **The guidelines' Known gaps row stays open.** An `examples/` folder already existed, and the README's longer code blocks still come from no example file.
