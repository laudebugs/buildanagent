---
title: Context keeps a long conversation inside the window
description: How the harness rebuilds the conversation from the log and keeps it small with five layers, from a write cap to a summary.
---

You will see what the model reads on each turn and how the harness keeps a long conversation inside the model's window. You need this when your agent runs tools with long output or talks for more than a few turns.

## The model reads what the log holds

The context is everything one request sends to the model: the system prompt and the conversation so far. The window is the most text a model accepts in one request, counted in tokens, the units a model counts text in. A turn that passes no `history` builds its context from the log with `session.toContext()`, which returns the messages in order and the system prompt of the latest `turn_start` entry.

The log keeps every original entry, so the harness shrinks the context the model reads and never edits the log. A tool result that the model reads in cut form is stored in the log in cut form, with the full text in a file.

## Five layers keep the context small

`createContextPolicy()` builds the layers, and `createHarness({ ..., context })` applies them to every turn. Layers 1 and 2 call no model. Layers 3 to 5 ask a model for a summary.

- **Layer 1, the write cap.** After each tool call, it cuts a result that is over about 64 KiB, keeps the first part and saves the full text to a file.
- **Layer 2, masking.** Before each model call, it shrinks older tool results to their first 500 characters and a line that says where the full text is.
- **Layer 3, the summary.** At the start of a turn whose context is over its budget, it replaces the older messages with a summary and keeps the newest ones as they were.
- **Layer 4, mid-turn.** Inside a turn, when a call would pass 90% of a small window, it writes a summary and goes on from it.
- **Layer 5, overflow retry.** After the provider refuses a request as too large, it writes a summary and retries once.

All five layers are on by default, except layer 4, which is on only for windows under 128,000 tokens. A single turn can fill a smaller window. Turn a layer off with `layers: { write_cap: false }` and the matching name.

Layer 1 saves the full text to a `spill` store, so a policy with the write cap on and no `spill` throws `invalid_context_options`. `fileSpillStore()` writes one file for each cut result. Layer 2 moves its cutoff once every eight messages, so the start of the request stays the same between moves and the provider's prompt cache keeps hitting.

The budget of layer 3 defaults to the smaller of the model's window less 16,384 tokens and 200,000 tokens. The harness keeps about the newest 20,000 tokens word for word.

## Summarize a chat that outgrew its budget

This policy gives a chat a budget of 2,000 tokens, keeps the newest 300 tokens word for word and asks the summary to hold on to file names and error messages. A real agent keeps the default budget. The harness then uses the policy for every turn:

```ts file="packages/harness/examples/compaction.ts" region="policy"
```

The function below asks each question in one session and then reads the log for the latest `compaction` entry, which the harness writes when it replaces older messages with a summary:

```ts file="packages/harness/examples/compaction.ts" region="run"
```

`reportOn()` reads that entry and counts the entries that come before the first one the summary kept:

```ts file="packages/harness/examples/compaction.ts" region="report"
```

In the example's test, two long questions fill the budget, and the third turn starts with a summary. Five of the log's 23 entries come before the first kept entry. The next request reads the summary and the newest messages instead of those five, and all 23 stay in the log.

## The log keeps every original

A summary never edits or removes an entry. `session.toContext()` starts from the latest `compaction` entry: its summary as a user message, then the kept messages, then everything written after it. A re-run from an entry before the compaction rebuilds the original context from the file.

The summary call costs money, so the harness records it as a `usage` entry with the source `summary` before it writes the `compaction` entry. Set `summarize.capUsd` and the harness skips the summary when the session's spend plus the call's projected cost would pass the cap. A failed summary never fails the turn.

Next, see how the harness holds [tools](/harness/tools/).
