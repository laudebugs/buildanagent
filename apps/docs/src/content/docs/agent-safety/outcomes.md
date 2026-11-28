---
title: Write outcomes
description: The five typed outcomes a write reports, what each one lets the model retry, and how to build one and hand it to the model.
---

You will report every write as one of five outcomes, so the model knows whether to retry, ask or stop. You need this when a tool can fail in more than one way, such as a refund that was declined, one that went through, or one whose answer never arrived.

A bare error tells the model too little. "The email may have gone out" and "nothing happened" both look like a failure, yet they call for opposite next steps. A write outcome is a typed answer that names which one happened.

## Five kinds say what happened

The outcome's `kind` says what happened, and its `retry` rule says whether trying again is safe. Each kind below lists its default retry rule and what the model must not do next:

- `applied`: the write took effect. The default retry is `never`, and the model must not run it again for the same request.
- `not_applied`: the write was rejected before any effect. The default retry is `same_key`, and the model must not say that it happened.
- `compensated`: the write took effect and was then undone. The default retry is `new_operation_only`, and the model must not say it took effect or hide what could not be undone.
- `partial`: some effects hold, and the rest could not be undone. The default retry is `never`, and the model must not present it as a success.
- `unknown`: nobody knows whether the write took effect, as after a timeout. The default retry is `reconcile_first`, and the model must not say that it happened or that it failed, and must not retry it as a new request.

The four retry rules mean this:

- `never`: do not retry; tell the user or hand the task to a person.
- `same_key`: retry with the same effect key, the hash that names one write, so the write takes effect at most once.
- `new_operation_only`: start a new operation, and only if the user still wants it.
- `reconcile_first`: check what happened before any retry.

A tool may choose a retry rule other than the default, but only one its kind allows. An `applied` outcome allows only `never`, and an `unknown` outcome never allows `new_operation_only`, because the first attempt may already have taken effect. TypeScript rejects a rule the kind does not allow when the kind is a literal. `writeOutcome()` rejects it at runtime.

## Build an outcome with `writeOutcome()`

`writeOutcome()` fills in the default retry rule and empty effect lists, checks every field and returns a frozen outcome. This function reports that the payment provider declined a refund:

```ts file="packages/agent-safety/examples/outcome-tool.ts" region="declined"
```

Every outcome needs `operation` and `next`, which tells the model what to do now. Optional fields add detail. The fields `applied`, `reverted` and `notReversible` list effects, `currentState` gives one line the model can trust, and `avoid` adds what the model must not do. `effectKey` names the write for a retry, and `reason` is a stable code for the cause.

`writeOutcome()` throws a `SafetyError` with the code `invalid_outcome` when a field breaks a rule. The [Problems and fixes](/agent-safety/problems-and-fixes/) page lists the messages. The rules are:

- A `reason` holds upper-case letters, digits and underscores, starts with a letter, ends with a letter or a digit and has 3 to 63 characters, such as `CARD_DECLINED`.
- No optional text field and no listed effect is blank.
- The effects agree with the kind: a `not_applied` outcome lists none, an `applied` one lists nothing in `reverted`, and a `compensated` one lists nothing in `applied`.
- A `partial` or `unknown` outcome uses `same_key` only with an `effectKey`, because without one a retry could take effect twice.

## The model reads a sentence and a payload

`renderOutcome()` turns an outcome into what the model reads. It checks the outcome as `writeOutcome()` does, so an outcome built by hand or parsed from JSON follows the same rules. It returns three values:

- `text`, a few sentences about what happened and what to do next;
- `payload`, the outcome's fields as plain JSON;
- `isError`, which is true for every kind except `applied`.

Send all three to the model. Some SDKs show the model only the text or only the structured part, and some adapters drop the provider's error flag, so the outcome must survive in each channel alone. The [quick start](/agent-safety/quick-start/) shows the text for an `applied` and a `not_applied` outcome.

## Return an outcome from an AI SDK tool

The `./ai` subpath hands outcomes to the Vercel AI SDK, the `ai` package. It needs the optional peers `ai` and `@ai-sdk/provider-utils`, which the package pins to exactly 7.0.173 and 5.0.81 as of November 2026, so any other release may warn at install. Install them beside the package:

```bash
pnpm add @buildanagent/agent-safety@alpha ai@7.0.173 @ai-sdk/provider-utils@5.0.81
```

Return the outcome from your tool's `execute`, and convert it in `toModelOutput`. The tool below always reports the declined card:

```ts file="packages/agent-safety/examples/outcome-tool.ts" region="tool"
```

The model then receives one tool result whose value holds the sentence as `message` beside the payload. Every kind except `applied` arrives as an `error-json` result, which sets the provider's error flag; `applied` arrives as `json`.

Next, see how a [signed approval](/agent-safety/approvals/) keeps a person's yes tied to one exact call.
