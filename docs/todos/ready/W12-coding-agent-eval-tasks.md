# W12: Ten coding-agent eval tasks that bring the seed suite to thirty

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `W12` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [N38](N38-seed-suite-baseline.md), [W2](W2-coding-tool-profile.md) |
| Size | M |

## Goal

Add ten coding-agent tasks to N38's seed suite, so the suite reaches thirty tasks at k = 5 before W8 publishes the coding agent's baseline. HD8 asked for thirty tasks, ten of them triage tasks from the deferred Round A. On 2026-11-19 the owner amended it: "20 now, plus coding tasks". N38 ships the twenty repository tasks, and this todo fills the other ten with the failures a coding agent meets.

## Context

- [HD8 and its amendment](../../plans/build-harness.md#hd8-a-30-task-seed-suite-of-20-repository-and-10-coding-agent-tasks-at-k--5-accepted-amended): the suite size, k = 5, the per-trial guarantees and the $3 cap.
- [N38](N38-seed-suite-baseline.md): the task format, graders and report this todo extends.
- [W2](W2-coding-tool-profile.md): the coding tool profile and the completion check the tasks exercise.
- [CA2](../../plans/build-coding-agent.md#ca2-the-coding-agent-replaces-triage-as-the-first-agent-accepted): why the coding agent replaced triage as the first agent.
- [Harness guide §10](../../guides/agent-harness.md#10-evals-should-run-on-inspect-against-mini-swe-agent-and-report-cost-per-task-beside-pass-rate): tasks drawn from real failures, with outcome graders and a clean environment per trial.

## Scope

**In scope**

- Ten tasks in N38's suite format, each with a fixed starting repository, an instruction and an outcome grader that runs outside the agent's writable sandbox
- Tasks drawn from real coding-agent failure modes. This todo picks the ten; examples:
  - a multi-file edit that must keep every caller compiling;
  - a failing test that must be fixed without deleting or skipping it;
  - a dependency install that must go through `EgressPolicy` and fail on a host outside it;
  - a pull request description that must match the diff;
  - a refusal to push to any branch outside `agent/*`.
- A suite manifest that lists all thirty tasks with their source and grader

**Out of scope** (and which todo covers it)

- Running the cloud-mode baseline (W8)
- The ten triage tasks, which return with Round A and extend the suite beyond thirty (N38b)
- Browser tasks (a later browser-use todo)

## Tasks

- [ ] Choose the ten failure modes, and record for each why it matters and where it was seen.
- [ ] Build each task's starting repository as a fixture with no secrets and no network-only checks.
- [ ] Write each grader so it checks the outcome, not the transcript.
- [ ] Run each task once on the scripted model to prove the grader rejects a wrong answer and accepts a right one.
- [ ] Add the ten tasks to the suite manifest beside N38's twenty.

## Acceptance criteria

- [ ] The manifest lists thirty tasks, each with its source, instruction and grader.
- [ ] Every new grader fails a scripted wrong answer and passes a scripted right one, offline.
- [ ] No task fixture contains a credential, and none needs the network except through `EgressPolicy`.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

The grader checks run offline in `pnpm test` on the scripted model. Live runs belong to W8.

## Docs to update

HD8's amendment note in the harness plan (with the final task list), and the coding agent plan's todo table.

## Risks and open questions

- Ten tasks added to twenty still sit near the floor of the 20–50 range that HD8's evidence cites, so the suite catches only large regressions.
- A task that would otherwise need live GitHub must use the fake GitHub from the coding agent's end-to-end test, never a real repository.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
