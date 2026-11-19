# @buildanagent/agent-safety

When a tool changes the world, such as sending an email or issuing a refund, your agent must know exactly what happened. This package gives every such write one of five typed outcomes, renders each one as text the model can act on, and hashes tool inputs the same way on every runtime.

As of November 2026 the package is not on npm yet. It holds the write outcomes, `renderOutcome()`, `canonicalInputHash()` and an adapter for the Vercel AI SDK. Effect keys, signed approvals and plan approvals come next.

## A failed write reports one of five outcomes

A bare error tells the model too little. "The email may have gone out" and "nothing happened" both look like failure, yet they call for opposite next steps. A write outcome names which one happened, and its kind decides whether a retry is safe:

| Kind | What happened | Default retry | The model must not |
| --- | --- | --- | --- |
| `applied` | The write took effect | `never` | Run it again for the same request |
| `not_applied` | The write was rejected before any effect | `same_key` | Say that it happened |
| `compensated` | The write took effect and was then undone | `new_operation_only` | Say it took effect, or hide what could not be undone |
| `partial` | Some effects hold, and the rest could not be undone | `never` | Present it as a success |
| `unknown` | Nobody knows whether it took effect, as after a timeout | `reconcile_first` | Retry it as a new request |

The four retry rules mean this:

- **`same_key`:** retry with the same effect key, so the write takes effect at most once.
- **`new_operation_only`:** start a new operation, and only if the user still wants it.
- **`reconcile_first`:** check what happened before any retry.
- **`never`:** don't retry; tell the user or hand the task to a person.

A tool may choose a retry rule other than the default, but only one its kind allows. An `applied` outcome allows only `never`, and an `unknown` outcome never allows `new_operation_only`, because the first attempt may already have taken effect. TypeScript rejects a rule the kind doesn't allow, and so does `writeOutcome()` at runtime.

## Build an outcome with `writeOutcome()`

`writeOutcome()` fills in the default retry rule and empty effect lists, checks every field and returns a frozen outcome. This refund tool reports that the payment provider declined the refund:

```ts
const outcome = writeOutcome({
  kind: "not_applied", operation: "refund_create", reason: "CARD_DECLINED",
  next: "Ask the requester for another payment method",
});
```

Every outcome needs `operation` and `next`, which tells the model what to do now. Optional fields add detail: `applied`, `reverted` and `notReversible` list effects, `currentState` gives one line the model can trust, and `avoid` adds what the model must not do. A `reason` must be upper snake case of at most 63 characters, such as `CARD_DECLINED`. An optional text field or listed effect must not be blank, and an effect list must not contradict the kind: a `not_applied` outcome lists no effects, an `applied` one nothing `reverted`, and a `compensated` one nothing `applied`. A `partial` or `unknown` outcome may use `same_key` only with an `effectKey`, since without one a retry could take effect twice. A field that breaks a rule throws a `SafetyError` with the code `invalid_outcome`.

## The model reads a sentence and a payload

`renderOutcome()` turns an outcome into what the model reads. It checks the outcome as `writeOutcome()` does, so an outcome built by hand or parsed from JSON follows the same rules. For the refund above, it returns this text:

> The refund_create call did not take effect, and nothing changed. Next: Ask the requester for another payment method. Retrying this same call is safe, because this attempt changed nothing. Do not say that it happened.

Beside the text, it returns the outcome's fields as a JSON `payload`, and `isError`, which is true for every kind except `applied`. Send all three to the model. Some SDKs show the model only the text or only the structured part, and some adapters drop the provider's error flag, so the outcome must survive in each channel alone.

## Use an outcome as an AI SDK tool result

The `./ai` subpath hands outcomes to the Vercel AI SDK (`ai` 7.0.162). Return the outcome from your tool's `execute`, and convert it in `toModelOutput`:

```ts
import { toAiToolResult } from "@buildanagent/agent-safety/ai";

const refund = tool({ inputSchema, execute: issueRefund, toModelOutput: ({ output }) => toAiToolResult(output) });
```

The model then receives one tool result whose value holds the sentence as `message` beside the payload. Every kind except `applied` arrives as an `error-json` result, which sets the provider's error flag; `applied` arrives as `json`.

## Hash a tool input with `canonicalInputHash()`

An approval signs a hash of the tool's input, and an effect record stores the same hash. `canonicalInputHash()` serializes the input as canonical JSON (RFC 8785), so key order never changes the hash, and returns its SHA-256 as 64 lowercase hex digits:

```ts
await canonicalInputHash({ to: "ada@example.com", body: "Hi" }) === await canonicalInputHash({ body: "Hi", to: "ada@example.com" }); // true
```

Any changed value gives a different hash. A property set to `undefined` counts as absent, as it does in `JSON.stringify`. The hash is async, because Web Crypto's digest is. For an input with no single JSON form, it rejects with a `SafetyError` with the code `invalid_input`: a number that isn't finite, `undefined` or a hole in an array, a string with a lone surrogate, a bigint, a function, an object that isn't plain, such as a `Date`, or an object that contains itself.

## The root entry loads without any third-party SDK

`@buildanagent/agent-safety` imports no third-party SDK, so it runs anywhere Web Crypto does: Node 22, Cloudflare Workers and other edge runtimes. Adapters for other SDKs live in subpaths. `./ai` needs `ai` and `@ai-sdk/provider-utils`, which are optional peer dependencies. `./agents` will hold the adapters for Cloudflare `agents`, and it holds none yet.

To see how the model runs these tools, read the [SDK's README](../sdk/README.md).
