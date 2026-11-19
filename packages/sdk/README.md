# @buildanagent/sdk

The buildanagent SDK runs the agent loop over [`@buildanagent/gateway`](../gateway/README.md): tools, hooks, signed pauses and budgets. As of November 2026 it holds only its testing export (todo B3); the loop arrives from B10 onward. The design is in the [SDK plan §3.3](../../docs/plans/build-sdk.md#33-sdk-api).

## Testing: a strict scripted model, not a lenient mock

`@buildanagent/sdk/testing` exports `ScriptedModel`, the model every loop, tool, hook and pause test drives. It implements the gateway's `ModelAdapter`, so a test can pass it anywhere a real adapter goes, and it fails loudly when a test's expectations drift:

- **Over-run throws.** A call past the last scripted step throws `UnexpectedModelCallError`.
- **Under-run fails.** `assertComplete()` throws if any step was never called; call it in teardown.
- **Requests are snapshots.** `calls` holds a cloned, deeply frozen `RecordedRequest` per call, taken when the call is made, so later changes to the caller's context never show up in it.
- **Streams look real.** Text, reasoning and tool-input JSON arrive in deltas of `chunkSize` characters (default 4), and the abort signal is checked between deltas. An abort ends the stream with an `error` terminal whose `stopReason` is `"aborted"`, carrying the text so far.

A step is either a fixed `AssistantScript` or a responder that builds one from the recorded request:

```ts
import { ScriptedModel, sequentialIds } from "@buildanagent/sdk/testing";

const model = new ScriptedModel(
  [
    { content: [{ type: "tool_call", callId: "", name: "lookup", input: { order: 42 } }] },
    (request) => ({ content: [{ type: "text", text: `Saw ${request.context.messages.length} messages` }] }),
  ],
  { idGenerator: sequentialIds("call") },
);
```

A script's `stopReason` defaults to `"tool_calls"` when its content has a tool call, and to `"stop"` otherwise. Setting `error` ends the stream with an `error` terminal instead. Every stream passes the gateway's `assertStreamContract()`.

## Tests are deterministic and offline

Nothing in the testing export reads `Date.now()` or `Math.random()`. `fixedClock(start, stepMs)` returns an ISO 8601 clock, `sequentialIds(prefix)` returns `prefix-1`, `prefix-2` and so on, and `seededRandom(seed)` returns a seeded generator. The same script with the same clock and ids produces deep-equal events on every run.

Every test file starts with `import "@buildanagent/gateway/testing/setup"`. The setup blocks `fetch` to non-loopback hosts, fails if a provider key variable is set, and calls `allowModelRequests(false)`, so any adapter whose transport is not marked as a mock throws before it sends.
