# @buildanagent/evals

The evals package judges the harness by cost as well as by pass rate. It turns a session log into one row, turns rows into a report that sets pass@1 and pass^k beside the cost, tokens and steps of a task, and turns the same log into a mini-swe-agent trajectory.

As of November 2026 the package is private and not on npm. It stays private, because its reports are for us and not for users of the packages. The [harness plan](https://github.com/laudebugs/buildanagent/blob/main/docs/plans/build-harness.md) says what each package will hold and in which order.

## A report pairs every pass rate with what it cost

`report()` groups rows by harness and gives each harness one line. The line holds pass@1 with a 95% Wilson interval, pass^k, and the mean cost, tokens, steps, preamble size, approval prompts and wall time of one attempt at a task. A pass rate alone hides a harness that wins by spending ten times more, so the cost sits in the same line.

```ts
import { report } from "@buildanagent/evals";

const result = report(rows, { k: 2 });
console.log(result.harnesses.ours?.passAt1, result.harnesses.ours?.perTask.costUsd);
```

Take six trials of two tasks from one harness: four passed, one failed and one hit an infrastructure error. With `k: 2`, the line says `passAt1` is 0.8 over the five graded trials, with an interval from 0.376 to 0.964. It says `passHatK` is 2/3 and `perTask.costUsd` is 0.2 if the trials cost $1.20 together.

Each line also breaks the harness down by task. `byTask` maps each task id to the same figures for that task alone, with its own pass^k, so two harnesses or two ablations can be compared task by task with paired statistics.

`ReportOptions` takes four fields. `k` is required and must be a whole number of at least 1. `harness`, `tag` and `ablation` each keep only the rows that match, so `tag: "safety"` reports the safety slice alone.

## Pass@1 and pass^k answer different questions

Pass@1 is the share of graded trials that passed, pooled over every task. Pass^k is the chance that k trials of one task all pass, which measures whether the agent is reliable and not only whether it can succeed once. The report averages it over tasks.

Pass^k uses the unbiased estimator C(c, k) / C(n, k), where n is a task's graded trials and c the ones that passed. For n = 5 and c = 3, pass^1 is 3/5, pass^2 is 3/10 and pass^3 is 1/10. A task with fewer than k graded trials is left out of the average and counted in `tasksBelowK`, and `passHatK` is `null` when no task has k.

The interval around pass@1 is the Wilson score interval, which stays inside 0 and 1 and keeps a width at 0 or 10 passes out of 10. Eight passes in ten trials give an interval from 0.490 to 0.943, so ten trials cannot separate 0.8 from 0.6.

## An infra error is never a failure

Each trial counts in exactly one of four outcomes: passed, failed, `infraError` or `unscored`. An infra error means the infrastructure failed, in the agent's run or in the grader, so the trial says nothing about the agent. A trial is `unscored` when the grader answered `judge_unknown`. Neither kind enters pass@1 or pass^k, and neither counts as a failure.

Their cost still counts. Every per-task figure is a mean over all of a harness's trials, infra errors and ungraded trials included, because each of them ran and was paid for. A harness with no graded trial has a `null` `passAt1` and interval.

## An unknown price stays unknown

A row's `costUsd` is `null` when any model call in the trial had no known price, and a `null` is never read as zero. One unknown makes that harness's `totalCostUsd` and `perTask.costUsd` `null`, and `unknownCostTrials` says how many trials caused it. A smaller sum that silently skips a call would make the harness look cheaper than it was.

## A row is one trial, and its rules are checked once

An `EvalRow` holds one trial of one task: `task`, `trial`, `costUsd`, `tokens`, `passed`, `steps`, `preambleTokens`, `wallMs`, `prompts`, `exit`, `harness`, `ablation` and optional `tags`. `harness` is any string, such as `"ours"`, `"mini-swe-agent"` or `"single-call"`, and `ablation` is the hash of the harness's switches or `"none"`.

Every count, including each token count, must be a whole number of at least 0, and `task`, `harness` and `ablation` must be non-empty. Three rules tie the grade to the exit. `passed: null` needs an `unscored` reason, and a set `passed` forbids one. An `exit` of `"infra_error"` needs `passed: null` and `unscored: "infra_error"`. `exit` is `"submitted"` when the agent handed in an answer and `"limit"` when a step, budget, time or progress limit stopped it.

`report()` and `discordance()` check every row they read and refuse a row that breaks a rule. `report()` also refuses two rows that share a harness, ablation, task and trial, and a harness whose kept rows span several ablations, because pooling their trials would mix two configurations in one pass^k. Choose one with `ablation`.

## A session log becomes a row with `toEvalRow()`

`toEvalRow()` reads a session's entries and what the log cannot know: the task, the trial, the harness, the ablation, the preamble size and the grader's verdict. The log supplies everything else.

```ts
import { toEvalRow } from "@buildanagent/evals";

const row = toEvalRow(entries, {
  task: "triage-checkout-500", trial: 0, harness: "ours", ablation: "none", preambleTokens: 120, passed: true,
});
```

Cost and tokens sum the agent's model calls and context summaries. A judge's calls are left out, because the baseline's cost counts the agent's calls only. Steps add up every turn's steps, and prompts count approval requests. Wall time sums each turn's time from its `turn_start` to its `turn_end`, so the time a paused session waits for a person's approval is left out.

The last turn's stop reason sets `exit`. `done` becomes `"submitted"`, and `error` becomes `"infra_error"`. `max_steps`, `budget` and `no_progress` become `"limit"`. So do `aborted`, because an eval runner aborts a trial only at its time limit, and `stopped`, because a host hook that stops a run ends it as a limit would. An `infra_error` row is ungraded whatever `passed` says. A session whose last turn never ended, or waits for a person's approval or answer, has no outcome, so `toEvalRow()` throws `unfinished_session`.

## A trajectory lets one script read our runs and the baseline's

`toMiniSweTrajectory()` writes a session log in mini-swe-agent's `mini-swe-agent-1.1` format. A script that reads the baseline's `info.model_stats.instance_cost`, `info.model_stats.api_calls` and `info.exit_status` then reads ours without a branch.

```ts
import { MINI_SWE_TRAJECTORY_FORMAT, toMiniSweTrajectory } from "@buildanagent/evals";

const trajectory = toMiniSweTrajectory(entries, { submission: patch });
console.log(trajectory.trajectory_format === MINI_SWE_TRAJECTORY_FORMAT, trajectory.info);
```

The shape follows mini-swe-agent v2.4.6: `DefaultAgent.serialize()` in `src/minisweagent/agents/default.py`, lines 159 to 180, at commit `a83fcae`. `instance_cost` sums the cost of the agent's model and summary calls, `api_calls` counts them, and a judge's call is in neither. The log does not record what a run handed in, so `submission` is `""` unless you pass one.

`exit_status` comes from the same classification as a row's `exit`, so the two always agree. A submission is `"Submitted"`, every limit is `"LimitsExceeded"`, and an infra error is `"error"`. The status is `""` while the last turn has not ended or waits for a person, and the trajectory then has no exit message.

Messages follow the baseline's shapes. The first is the system prompt, and assistant messages carry `extra.cost` and `extra.timestamp`. Tool results are `{ role: "tool", tool_call_id, content }`, and the last message has role `exit`. Images and reasoning blocks are left out, because the format's content is text, and `info.config` and `info.mini_version` are left out because they describe mini-swe-agent's own agent.

Two fields depart from the baseline. When any call's price is unknown, `instance_cost` is `null`, as the row's cost is. By default mini-swe-agent raises an error instead, unless its `cost_tracking` is set to `ignore_errors`, in which case it counts the call as $0. An infra error's `exit_status` is `"error"`, our own stop reason, not a status mini-swe-agent writes.

## Discordance says how much a rerun already flips

`discordance(a, b)` pairs the trials of two runs by task and trial number and counts the pairs graded differently. Each run must hold one harness and one ablation. Swapping one mature harness for another flips about as many tasks as rerunning the same harness, so a gain means little until it beats the rerun's own discordance.

```ts
import { discordance } from "@buildanagent/evals";

const { flipped, total } = discordance(firstRun, secondRun);
```

A pair counts only when both runs graded it. A trial missing from one run, an infra error and an unscored trial are left out of `total` and of `flipped`. A run that lists the same task and trial twice throws `duplicate_trial`.

## Every failure is an `EvalsError` with a code

`EvalsError` carries a `code`, and `isEvalsError()` narrows an unknown error to it.

| Code | Cause |
| --- | --- |
| `invalid_row` | A row breaks one of its rules, such as `passed: null` without an `unscored` reason |
| `duplicate_trial` | Two rows of one harness, ablation and run name the same task and trial |
| `invalid_option` | An option is out of range, such as a `k` below 1, one harness spans several ablations in a report, or one run of `discordance()` spans several harnesses or ablations |
| `unfinished_session` | A session's last turn did not finish, so it has no outcome to report |
| `invalid_session` | A session log can't be read as a trial: it holds a stop reason this package doesn't know, such as one a newer SDK wrote, or a `turn_end` with no `turn_start` for its run |

## The replay suite checks recorded sessions with no model and no network

The package's tests replay the three sessions that the harness capstone recorded. Each case runs the triage agent again on its recorded model calls through the SDK's `replayPairs()`: it pauses at the page, and a second harness answers the pause. The suite fails when a request differs from the recorded one, and it compares every entry the rerun writes with the recorded log, so a change to any entry fails it. It also checks each log's eval row and trajectory. The suite runs on every commit.

The recordings carry an expiry, and the replay checks it against the fixed time the capstone recorded them at, as the harness's own capstone test does, so the suite gives the same result on any day.

## The package exports these types

The package exports the types `EvalRow`, `EvalExit`, `UnscoredReason`, `EvalRowMeta`, `ReportOptions`, `EvalReport`, `HarnessReport`, `TaskReport`, `TrialFigures`, `OutcomeCounts`, `PerTask`, `Interval`, `Discordance`, `EvalsErrorCode`, `MiniSweTrajectoryV1_1`, `MiniSweTrajectoryOptions`, `MiniSweMessage`, `MiniSweTextMessage`, `MiniSweAssistantMessage`, `MiniSweToolMessage`, `MiniSweExitMessage` and `MiniSweToolCall`. Live runs against mini-swe-agent come with the Inspect bridge, and the report format above is what they will fill.
