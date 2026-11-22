---
title: Stop reasons
description: Every run ends with a stop reason that says why, and a failed model call never makes a run throw.
---

A run never throws because a model call failed or a tool broke. It ends with a result whose stop reason says why. You need this to know which reasons your code must handle.

## Nine reasons end a run

- **`done`**: the model answered without calling a tool, or an output tool accepted its answer.
- **`max_steps`**: the run made its step limit of model calls, 20 by default, and the model still wanted to go on.
- **`error`**: a model call failed. The result's `error` says what kind of failure it was.
- **`aborted`**: you aborted the run.
- **`stopped`**: a `shouldStop` hook ended the run, or `beforeModelCall` returned `{ stop }` before a call. In the second case the run made no further model call, and `stoppedBy` is the hook's text.
- **`no_progress`**: the progress policy found the model repeating a failing call.
- **`budget`**: the next call could have taken the run past its dollar budget, so the run ended without making it.
- **`awaiting_approval`**: a gate asked a person to approve a tool call, and the call waits.
- **`clarification_requested`**: a tool asked the user a question.

## Check the reason before you read the output

Only a `done` result carries `output`. TypeScript rejects `result.output` until you have checked that the stop reason is `done`, so an unfinished run cannot pass for a finished one.

A text answer cut off at the output limit also ends `done`. Check whether the last message's stop reason is `length` before you show the answer as complete.

Every result also carries `usage`, `cost` and `steps`, summed over the run's model calls. The result's `messages` holds the messages this run added, and its `context` holds the whole conversation, ready to continue.

Next, see [how tools work](/concepts/tools/).
