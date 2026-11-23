---
title: Stop reasons
description: Every run ends with a stop reason that says why, and a failed model call never makes a run throw.
---

A run never throws because a model call failed or a tool broke. It ends with a result whose stop reason says why. You need this to know which reasons your code must handle.

## Nine reasons end a run

The reasons fall into four groups. A run finishes with `done`. A limit or a hook stops it with `max_steps`, `budget`, `no_progress` or `stopped`. It fails or you abort it with `error` or `aborted`. It pauses for a person with `awaiting_approval` or `clarification_requested`, and a paused run resumes from its context.

::figure[The nine stop reasons, in four groups]{id="stop-reasons" alt="Nine stop reasons fall into four groups. A run finishes, is stopped by a limit or a hook, fails or is aborted, or pauses for a person."}

Each reason in turn:

- **`done`**: the model answered without calling a tool, or an output tool accepted its answer.
- **`max_steps`**: the run made its step limit of model calls, 20 by default, and the model still wanted to go on.
- **`error`**: a model call failed, a hook threw while the run fails closed, the budget could not price a call, or `continueRun()` refused to resume because the app data or a stored request did not check out. The result's `error.kind` says which of these happened.
- **`aborted`**: you aborted the run.
- **`stopped`**: a `shouldStop` hook ended the run, or `beforeModelCall` returned `{ stop }` before a call. In the second case the call the hook stopped never ran, so a run stopped at its first call has `steps` of 0. `stoppedBy` is the reason the hook gave, as in the first.
- **`no_progress`**: the progress policy found the model repeating a failing call.
- **`budget`**: the next call could have taken the run past its dollar budget, so the run ended without making it.
- **`awaiting_approval`**: a gate asked a person to approve a tool call, and the call waits.
- **`clarification_requested`**: a tool asked the user a question.

## Check the reason before you read the output

Only a `done` result carries `output`. TypeScript rejects `result.output` until you have checked that the stop reason is `done`, so an unfinished run cannot pass for a finished one.

A text answer cut off at the output limit also ends `done`. Check whether the last message's stop reason is `length` before you show the answer as complete.

Every result also carries `usage`, `cost` and `steps`, summed over the run's model calls. The result's `messages` holds the messages this run added, and its `context` holds the whole conversation, ready to continue.

Next, see [how tools work](/concepts/tools/).
