# @buildanagent/sdk

The SDK runs your agent's loop over [`@buildanagent/gateway`](../gateway/README.md): it calls the model, runs the tools the model asks for, and stops when the work is done. Its testing export lets you test that agent offline against a scripted model, with no API key.

As of November 2026 the package holds the loop, tool definitions, hooks, signed pauses for approval and their resumption, and the testing export.

## Install the alpha with `pnpm add @buildanagent/sdk@alpha`

Every release is an alpha until the first stable one, and npm serves the alphas under the `alpha` dist-tag. Add the gateway too when your code calls a model, since its adapters make the calls:

```bash
pnpm add @buildanagent/sdk@alpha @buildanagent/gateway@alpha
```

Both packages always share one version, and the SDK depends on that exact version of the gateway. Name the tag: a plain `pnpm add @buildanagent/sdk` installs `0.0.0-bootstrap.0`, a deprecated placeholder, because `latest` stays on it until the first stable release. The package needs Node 22.19 or later, the oldest Node its validator, pi-schema 1.5.2, supports.

Don't start Node with `--conditions=source` in a project that installs the SDK. Its validator, pi-schema 1.5.2, maps that condition to a source file its package doesn't ship, so the SDK's root entry fails to load under it ([validator check](docs/validator-check.md)).

## Run an agent with `run()`

`run()` starts the loop. It sends your system prompt and the user's message to the model, runs each tool the model calls, and sends the results back. It goes on until the model answers without calling a tool. This agent answers questions about orders with the `lookup_order` tool from the next section, and prints the answer as it streams:

```ts
const started = run({
  model,
  system: SYSTEM_PROMPT,
  input: question,
  tools: [lookupOrderTool(findOrder)],
  maxSteps: MAX_STEPS,
});
for await (const event of started) {
  if (event.type === "text_delta") write(event.delta);
}
const result = await started.result;
```

`model` comes from `createModel()` in the gateway, and a bare model id is a type error. A tool whose `exposure` is `"deferred"` or `"hidden"` is sent to the model only when a `beforeModelCall` interceptor names it in `activeTools`, and a call to a tool the request didn't send gets the unknown-tool error.

### Every run ends with a stop reason

A failed model call or a failing tool never makes a run throw. The run ends with a result whose `stopReason` says why:

- **`done`**: the model answered without calling a tool, or an output tool accepted its answer. A text answer cut off at `maxOutputTokens` also ends `done`, so check whether the last message's `stopReason` is `"length"` before you show it as complete.
- **`max_steps`**: the run made `maxSteps` model calls, 20 by default, and the model still wanted to go on. The run also emits a `warning` event with `code: "max_steps"`, so a cap that cut a run short shows up in your logs.
- **`error`**: a model call failed. `result.error` copies the failure's `kind`, `message` and HTTP `status`. Its `kind` is `overflow` for a request too large for the model's window, `quota` for an account out of credit, `retryable` for a temporary failure that outlasted the gateway's retries and your `turnRetries`, `hook` for an interceptor that threw while the run fails closed, `unknown_price` for a budgeted run that can't price a call, and `fatal` otherwise.
- **`aborted`**: you aborted the run.
- **`stopped`**: a `shouldStop` hook ended the run, and `result.stoppedBy` is the reason it gave.
- **`no_progress`**: the default progress policy found the model repeating a failing call, or a `shouldStop` hook ended the run with `{ stop: "no_progress", reason }`. `result.reason` says why.
- **`budget`**: the next call could have taken the run past `budgetUsd`, so the run ended without making it. `result.spentUsd`, `result.projectedUsd` and `result.budgetUsd` give the numbers.
- **`awaiting_approval`**: a `beforeToolCall` gate returned `ask`, so the call waits for a person. `result.pending` holds one signed request for each waiting call, as [the pause section](#a-gate-that-asks-ends-the-run-with-a-signed-pending-request) explains.
- **`clarification_requested`**: a tool from `clarificationTool()` asked the user a question, and no call waits for an approval. `result.pending` holds a signed request of kind `clarification` for each question, as [the clarification section](#end-the-run-with-outputtool-or-ask-with-clarificationtool) explains.

`maxSteps` counts model calls, so an output call that fails its schema spends one of them. The tool calls of the last allowed response still run, so every call in the transcript has a result, except a paused call, which waits for a person.

Only the `done` result carries `output`. TypeScript rejects `result.output` until you have checked `result.stopReason === "done"`, so an unfinished run can't pass for a finished one. Every result carries `usage` and `cost`, summed over the run's model calls, and `steps`, the number of calls. `result.messages` holds the messages this run added. `result.context` holds the whole conversation, ready to continue.

### Three layers retry a failed model call, and the SDK's is off by default

Three layers can retry a failed model call: the gateway, the loop and your own code. The gateway re-sends an HTTP request that failed before any output, twice by default. It never replays a call after output has started, because you have already seen that text. The loop's `turnRetries` covers that case: it calls the model again after a call that ended with a `retryable` error, such as a stream cut off after it began to answer. Without `turnRetries` the run ends `error` on the first failure, and `continueRun()` is how your code tries again.

```ts
const result = await run({ model, system, input, turnRetries: 3 }).result;
```

`turnRetries: 3` retries as Pi does. A turn retry follows these rules:

- **Only `retryable` failures retry.** `overflow`, `quota` and `fatal` end the run, and so does a `retryable` failure whose `error.retryAfterMs` is over the gateway's 60-second cap, which keeps its hint on the last message so you can wait and call again.
- **The wait matches the gateway's.** The first retry waits `turnRetryDelayMs` (2000 by default), each later retry of a streak waits twice as long, and a longer `retryAfterMs` hint wins, up to 60 seconds. Pass `sleep` to skip the wait in a test; a `sleep` that rejects ends the wait early and emits a `hook_error` event with `hook: "sleep"`. Aborting the run during the wait ends it `aborted`.
- **A retry costs a step.** Every attempt counts against `maxSteps`, so `maxSteps` still bounds the worst case. A run that `maxSteps` stops after at least one retry ends `max_steps`, with the last failed message in its transcript; a first failure on the last step ends `error`, as it would without `turnRetries`. The count of retries restarts after each call that succeeds.
- **A retry costs money.** The result's `usage` and `cost` include every failed attempt, and `budgetUsd` checks before each retry, counting what the failed attempts cost. A retry the budget can't cover is never announced: the run ends `budget` with the failed message in its transcript. When a failed attempt's cost is unknown, such as after a stream cut off before the provider reported usage, a budgeted run can't check its spend. It ends `error` with that failure's own error instead of retrying.
- **The transcript drops the failed message.** `result.context.messages` holds only the response the run went on with, and the failed call's tool calls never run. `afterModelCall` sees only that response, while `transformContext` and `beforeModelCall` run for every attempt. Their `lastUsage` stays the usage of the last response the run went on with.
- **The layers multiply.** A call can send up to `(retries + 1) * (turnRetries + 1)` requests, nine with the defaults and `turnRetries: 2`, so lower one of the two when a provider is failing hard.

A failed attempt ends with `model_call_end`, whose message carries its real usage. A `retry` event with `layer: "turn"` follows at once. After the wait, the failed attempt's `step_end` arrives, then the retry's `step_start` and `model_call_start`: every attempt is a step with its own `stepIndex`. A log writer should therefore drop a `model_call_end` that a turn `retry` follows, and keep every other one. A UI that rendered the failed call's text deltas must discard them when the `retry` event arrives, because the retry streams its own text.

### `runOrThrow()` turns an unfinished run into an exception

If you would rather catch an exception than check the stop reason, `runOrThrow(run)` returns the `done` result and throws a `RunStoppedError` for any other. The error carries the `result` and the `context` to continue from. `RunStoppedError.isInstance(error)` recognises it, even across two copies of the package:

```ts
const result = await runOrThrow(run({ model, system, input }));
```

### Continue a conversation with `continueRun()`

`continueRun(context, options)` goes on from a context: a previous result's `context`, or one you rebuilt from your own store. A context is plain JSON holding the system prompt, the messages and, for a paused run, `pending` and `pendingInputs`. A run that stopped at `max_steps` continues with the model reading its last tool results. A context whose last response ended in an error asks the model again, because the gateway leaves that response out of the request. A `done` context ends with the model's answer, so add a user message to it before you continue, or pass the messages as `history` to `run()` with the new input. A paused context resumes with `resolutions`, as [the resume section](#resume-a-pause-with-continuerun-and-a-resolution-for-each-request) explains.

### Abort a run with `run.abort()` or a signal

`run.abort(reason)` stops a run, and so does the `signal` option. A model call in flight ends, and a running tool sees its `ctx.signal` fire. The run waits for that tool to return, so pass the signal on to your own I/O. Calls that haven't started get an error result instead of running.

An aborted run's transcript stays well formed: every tool call has a result, and the last message is an assistant message with `stopReason: "aborted"`. When tool results would end the transcript, because the abort came while tools ran or cut off a response that held tool calls, the loop appends an empty aborted message after them. Each gateway adapter drops it before the next request, so the transcript can be sent again as it is.

## Three guards stop a runaway run

A run that loops or overspends costs real money, so the SDK ships three guards. Each is an option of `run()` and `continueRun()`, and the table gives its default (the budget has none).

| Guard | Default | Change it with |
| --- | --- | --- |
| USD budget | none | `budgetUsd: 5` |
| Progress policy | 3 identical failing calls, or 5 calls on one `progressKey` | `progress: { maxIdenticalFailures, maxSameKeyCalls }`, or `progress: false` |
| Depth cap | `maxDepth` 2 | `depth` and `maxDepth` |

These numbers are provisional. Recorded runs will retune them.

### `budgetUsd` checks the cost before each call

Before every model call, the run projects the most that call can cost and compares the spend so far plus that projection with `budgetUsd`. If the call could pass the cap, the run ends with `stopReason: "budget"` and never sends it. The projection comes from the gateway's `projectCallCost()`: the previous call's reported input, plus a character-based estimate of the messages added since, at the model's input rate, plus the call's `maxOutputTokens` (or the model's own limit) at its output rate. The SDK re-exports the function, so code that calls `Model.complete()` outside the loop projects with the same formula.

Because the projection assumes the model may use its whole output allowance, the run stops early rather than late.

On the SDK's scripted 30-step run, with caps placed just above the spend after `k` calls, the pre-emptive check overshot the cap by $0 on every cap and sent 9.3 calls on average. A check that runs after each response overshot by $0.0105 on average, almost the whole call that crossed the cap. The cost of the early stop is cap left unspent: $0.054 on average in that run, set by how far `maxOutputTokens` sits above the output the model actually writes. Lower `maxOutputTokens` in `modelOptions` to tighten the projection.

The cap counts the calls the run itself makes. A `continueRun()` does not count the cost of the context it starts from.

A run with a budget needs a price for every call. If the model's price is unknown, the run ends `error` with `error.kind: "unknown_price"` before its first call, and so does a run whose earlier call came back with an unknown cost. Add the model to a catalog you pass to `createModel()`, or drop the budget.

### The progress policy ends a run that repeats a failing call

The policy reads the run's transcript after each step, after your own `shouldStop` hook. It ends the run `no_progress` in two cases:

- **Identical failures.** The latest three tool calls name one tool, carry one input, and each returned an error. Inputs compare by `canonicalInputHash()`, so `{a, b}` and `{b, a}` are the same input. A successful call, or a call to another tool, breaks the streak.
- **One key.** A tool declares `progressKey(input)`, such as a file path plus a line, and five calls to it return that key with no success between them. A success with that key starts the count again, and calls with other keys do not affect it. The inputs may differ, which is how it catches a model that keeps rewording a failing edit. The function receives the input exactly as the model sent it, so it must cope with any shape; a key that throws or isn't a string leaves that call out of the count.

Your own `shouldStop` runs first and its stop wins, but neither its `{ continue }` nor a throw under `onFailure: "continue"` can keep a stuck run going. Pass `progress: { maxIdenticalFailures: 2 }` to tighten a threshold, or `progress: false` to turn the policy off. A `continueRun()` counts only the calls it makes, so you can continue a run that ended `no_progress` after you change what the model sees.

### `depth` and `maxDepth` stop a tree of agents

Every tool receives `ctx.depth` (0 for a top-level run) and `ctx.maxDepth` (2 by default). A tool that starts its own agent passes the next level down with `nestedRunDepth(ctx)`:

```ts
async execute(input, ctx) {
  const child = run({ model, system, input: input.task, signal: ctx.signal, budgetUsd: 0.5, ...nestedRunDepth(ctx) });
  return { content: [{ type: "text", text: (await child.result).stopReason }] };
}
```

Pass `signal: ctx.signal` so the child stops when the parent's call is aborted. The parent's `budgetUsd` counts only the parent's own model calls, so give each child a budget of its own. A tool running at `depth === maxDepth` that starts a child run this way makes `run()` throw `max_depth_exceeded`. Since the throw happens inside `execute`, the model reads it as an error result and can answer without the sub-agent.

## Steer a running agent with `run.steer()`, or queue a follow-up with `run.followUp()`

Both methods queue a user message and return a promise for a `DeliveryReceipt`. The loop applies queued messages only at a step boundary, so a model call or tool batch that is running is never cut. A steer is applied before the run's next model call: a steer sent while a batch of tool calls runs waits for the whole batch, and the model reads it after the tool results.

```ts
const started = run({ model, system, input, tools });
const receipt = await started.steer("Use order 2 instead.");
console.log(receipt.stepIndex); // the step whose model call is the first to read the message
```

A follow-up waits until the run would otherwise end. When the model answers without a tool call and a message is waiting, the run adds the waiting messages and makes one more model call, so a follow-up sent before the run ends extends it by one step. A waiting steer goes first, and follow-ups wait for the next time the run would end. The extra call counts against `maxSteps`: a run already at the cap ends as it would have.

A receipt resolves once its message is in the transcript. It holds an `id` that is unique within the run, the `kind` (`"steer"` or `"follow_up"`), the `message` as content blocks and the `stepIndex`, the step at whose start the run added the message. That step's model call is the first to read it, unless the run ends before the call, which a budget stop or a failed hook can cause. The run also emits one `steer_applied` event for each message, carrying the same receipt. A message is a string that isn't blank, or a non-empty list of text and image blocks whose text isn't blank. The run applies messages in the order they were sent.

The promise rejects with an `SdkError` whose code is `undelivered_message` when the run ends before it applies the message. That happens in four cases:

- You call after the run has its outcome.
- An abort, or any stop reason other than a text answer, ends the run.
- A `shouldStop` hook or the progress policy ends a run that answered in text.
- The run ends by calling its output tool.

The promise rejects with `invalid_run_options` for a blank message or a block that isn't text or an image. A promise you never await is safe to drop: a rejection nobody reads does not raise an unhandled rejection.

## A run streams one closed set of events

Iterating a run yields its events. Each iteration starts from the run's first event, so you can start iterating at any time, even after the run has ended. Every event carries the run's `runId`, a `seq` that counts events from 0, a `stepIndex` that counts model calls from 0, and a `timestamp` from the run's clock.

The events come in two layers. The delta layer streams each content block by its index, for a user interface: `text_start`, `text_delta` and `text_end`, and the same three for `reasoning` and `tool_input`. The item layer carries the finished pieces for a log:

- **`run_start`** comes first, with the SDK's version, the spec version and the model.
- **`step_start`** and **`step_end`** wrap one model call and its tool calls; `step_end.stopCheck` says whether the run goes on.
- **`model_call_start`** carries the request, and **`model_call_end`** the final message.
- **`tool_call_start`**, **`tool_call_update`** and **`tool_call_end`** follow each tool call; `tool_call_end.result` is what the model reads. When a `beforeToolCall` gate replaced the model's input, `tool_call_end.input` holds the input the call got instead.
- **`context_transformed`** reports the message counts before and after `transformContext` for one model call.
- **`steer_applied`** reports a queued steer or follow-up that entered the transcript, with its receipt.
- **`approval_request`** reports a call that waits for a person, with its signed `request` and the `input` that request signs: a call a gate paused, or a tool's question. That call gets no `tool_call_end`. In a resumed run, **`resolution_rejected`** reports a request or resolution that failed its check, with the cause.
- **`hook_error`** reports an interceptor or an observer that threw, with the hook's name and the message. It also reports a pause that could not be signed, with `hook: "signer"`.
- **`retry`** reports a failed call that is being retried. Its `layer` is `gateway` for an HTTP request the model re-sends, or `turn` for a call the loop re-issues, as [the retry section](#three-layers-retry-a-failed-model-call-and-the-sdks-is-off-by-default) explains. **`warning`** reports a reached cap or a model warning.
- **`error`** and **`abort`** report a failed call and an abort request.
- **`agent_settled`** fires once nothing is running any more, retries and tools included. **`run_end`** follows it and carries the result.

`AGENT_EVENT_TYPES` lists every type at run time, and a run emits no other. The union is closed, so a `switch` over `event.type` can be exhaustive.

## Hooks change a run at six moments, and observers only watch

A hook is a function that takes one event object. Interceptors can change, block or replace something; observers can only watch. Pass interceptors as one object in the `interceptors` option, and observers in `observers` or through `run.on()`.

### A step calls the interceptors in one fixed order

Each model call goes through the same moments, and each interceptor owns one of them:

1. **`transformContext`** returns the messages to send for this call. Use it to mask old tool output or summarise a long conversation. The view reaches that one request. The next call's event, `result.messages` and `result.context` all keep the full history, and each call emits a `context_transformed` event.
2. **`beforeModelCall`** returns a patch for the request: a `system` prompt, `messages`, `options`, another `model`, or `activeTools`. A patch lasts for that call only.
3. The model call runs.
4. **`afterModelCall`** returns `{ message }` to replace the response. The transcript, `model_call_end` and the tool calls that run all use the replacement, while usage and cost stay the model's own.
5. For each tool call, **`beforeToolCall`** decides whether it runs, and **`afterToolCall`** edits the result.
6. **`shouldStop`** decides whether the run ends.

Every event carries `runId`, `stepIndex`, `signal` and `timestamp`, and the two tool hooks add `callId`. Pass `signal` on to any I/O your hook does. The event's data is frozen, so a hook that tries to change it throws a `TypeError`. Return a replacement instead.

`activeTools` lists the tools to send, and only those. A tool whose `exposure` is `"deferred"` or `"hidden"` is sent when you name it, so a tool-search step can reveal a tool for the next request. Tools always go out in definition order, whatever order your list has, and a name that matches no tool throws `invalid_hook_result`. A call to a tool the request did not send gets the unknown-tool error.

### A gate decides each tool call

`beforeToolCall` returns `{ decision: "allow" }`, `{ decision: "deny", reason }` or `{ decision: "ask" }`. An `allow` may carry a new `input`, which must pass the tool's schema. A `deny` reaches the model as an error result that states the reason, so the model never sees a silent block. An `ask` pauses the call: the run ends `awaiting_approval` with a signed pending request, as the next section explains.

The run asks about one call at a time, in the order the model sent them, and no call of the step starts until every gate has answered. Without a `beforeToolCall`, every registered tool is allowed. A gate must return a decision: returning nothing throws `invalid_hook_result`, so a forgotten `return` can't pass for permission.

`afterToolCall` returns a patch of `content`, `details`, `structured`, `isError` or `terminate`. The patched result is what the model reads and what `tool_call_end` reports. It runs for calls that executed, a tool that threw included, and not for calls that never ran, such as an unknown tool, invalid input or a denied call. To change a write's `outcome`, replace `content` instead.

### `shouldStop` ends a run, or keeps it going

It returns `true` or `{ stop: "hook", reason }` to end the run `stopped`, with the reason as `stoppedBy` (`"hook"` for `true`). It returns `{ stop: "no_progress", reason }` to end it `no_progress`. It returns `{ continue: "text or blocks" }` to keep going a run whose model answered in text, with your content added as a user message. If the step called tools, the run goes on anyway and the content is not added. At the step cap the run ends `max_steps` instead. `false` leaves the decision to the run. A run that has already finished, failed, been aborted or asked a question keeps that outcome.

### A throwing interceptor fails closed

By default a hook that throws stops the unsafe thing, and the run emits a `hook_error` event:

- A failed `beforeToolCall` denies the call.
- A failed `afterToolCall` withholds the result, so a redaction that crashed can't leak the original. The stand-in tells the model the tool ran and keeps a write's outcome, so the model does not retry a write that was applied.
- A failed `transformContext`, `beforeModelCall`, `afterModelCall` or `shouldStop` ends the run with `stopReason: "error"` and `error.kind: "hook"`. If the run was aborted, it ends `aborted` instead. When `afterModelCall` fails, the transcript and `model_call_end` hold an empty stand-in with `stopReason: "error"` and the call's usage and cost, so the response is withheld but the billed call is still on record.

Set `onFailure: "continue"` to skip a failed hook and go on as if it had returned nothing. A hook that returns the wrong shape is a different case: it is a bug in your code, so the run's `result` rejects with `invalid_hook_result` whatever `onFailure` says.

### `composeInterceptors()` joins several objects

A run takes one `Interceptors` object, so `composeInterceptors(a, b)` joins a context policy, a permission check and an audit. For a moment that several define, the hooks run in the order given. `transformContext` passes the messages through each hook in turn. `beforeModelCall` merges the patches, a later field replacing an earlier one. `afterModelCall` and `afterToolCall` chain, each hook seeing the result so far. For gates the strictest answer wins: the first `deny` ends the check, an `ask` beats an `allow`, and an input one gate replaces is the input the next gate sees. For `shouldStop` the first stop wins, then the first continue. Each hook's return value is checked as if it ran alone, so a gate that returns nothing throws `invalid_hook_result` even when another gate allows the call. The joined `onFailure` is `"continue"` only when every object sets it to `"continue"`; an object that leaves it unset counts as `"fail_closed"`.

### Observers watch without changing anything

An observer is `(event) => void | Promise<void>`. Each one sees every event in order, and waits for its own promise before it gets the next. Observers don't wait for each other, so one slow observer delays only itself. The `observers` option sees events from `run_start`. `run.on(observer)` returns a function that removes it, and drops events still queued for it. Call it right after `run()` to see every event but `run_start`.

An observer that throws or rejects becomes a `hook_error` event with `hook: "observer"`, and never changes the run. The one exception is an observer that fails while handling `run_end`: nothing may follow that event, so the failure is dropped. 

The run waits for observers to handle `agent_settled` and `run_end` before it settles, for at most `observerTimeoutMs` each time, a number from 1 to 2147483647 that defaults to 10000. An observer that hasn't caught up by then is removed and reported as a `hook_error`, so an observer whose promise never settles can't hold the run open. Each observer gets a frozen copy of the event, so it can't change the run's own data.

## A gate that asks ends the run with a signed pending request

When a `beforeToolCall` gate returns `{ decision: "ask", reason, policyVersion }`, the run doesn't run that call, and doesn't block on a callback either. It signs a pending request for the call, finishes the step's other calls, and ends with `stopReason: "awaiting_approval"`. Store the request with the context, show it to a person with the input it signs, and pass the answer to `continueRun()`, which checks it against the signature before the call runs:

```ts
const result = await run({ model, system, input, tools, interceptors: { beforeToolCall: gate }, signer }).result;
if (result.stopReason === "awaiting_approval") {
  await store.save(result.context); // result.context.pending holds the same requests as result.pending
}
```

Each request is a `SignedPendingRequest`. Its signature covers six fields: the request's `id`, its `kind`, the `callId`, the `tool`, the `inputHash` and the `policyVersion`. The input hash is `canonicalInputHash()` of the input the call would run with once approved, so a stored pause whose call, tool or input changed no longer verifies. That input is the model's after coercion, `repair` and any gate's replacement, so it can differ from the call's arguments in the transcript; the request stores only its hash, and `result.context.pendingInputs` and the `approval_request` event hold the input itself, by request id. Show the approver that input, not the model's arguments.

A gate's `ask` may carry its own `input`, which must pass the tool's schema, and `composeInterceptors()` passes an earlier gate's replacement on that way when a later gate asks, so the pause signs the input the earlier gate chose.

`reason` and `createdAt` are shown to people and are not signed, so never let them decide anything. `keyId` names the key that signed.

A paused call has no result in the transcript, so the context ends with the model's call still open. The step's other calls run or are denied as usual, and every call a gate paused gets its own request, in model order. A pause wins over an output tool that answered in the same step, because its call is still waiting. The run emits `approval_request` with the request and its input once every call of the step has been gated and before any of them runs. The call gets no `tool_call_end`, and the OpenTelemetry observer ends its tool span without an error. The event is advisory. A later call in the step can still fail the run with a programmer error, which ends it `error` with no `pending`, so build an approval queue from `result.pending`, not from the events.

### Resume a pause with `continueRun()` and a resolution for each request

A person answers each request with a `Resolution`: `{ requestId, decision: "allow" | "deny", reason?, by? }` for an approval, or `{ requestId, answer, by? }` for a question. Pass the answers to `continueRun()` with the stored context, in this process or another one that holds the same key ring:

```ts
const context = await store.load(id); // plain JSON, with pending and pendingInputs
const next = continueRun(context, { model, tools, signer, resolutions: [{ requestId, decision: "allow", by: "ana" }] });
```

Before its first model call, the run checks every waiting call's stored request with its `signer`. The check verifies the signature under the request's `keyId`, then the call id and tool against the transcript's call, then the input in `context.pendingInputs` against the signed hash, and last that the resolution fits the request's kind. Each waiting call then goes one of four ways:

- **A verified `allow`** runs the call once, with the input its request signs, never the transcript's arguments. `beforeToolCall` isn't asked again, and `afterToolCall` still runs.
- **A verified `deny`** gives the model an error result with the reason, and a verified `answer` reaches the model as the call's result.
- **A request no resolution names** still waits. When any call still waits, the run ends paused again without a model call, so you can answer one call at a time.
- **A request or resolution that fails a check** runs nothing. The run emits `resolution_rejected` with the cause, such as `signature_invalid`, `input_changed`, `resolution_mismatch` or `replayed`, and the call asks again. Your gate is asked as for a new call, and the call pauses with a new request even when the gate allows it. The new request is always an approval, because a request that failed its check can't be trusted to say it was a question. A question that fails therefore comes back as an approval request for the asking tool, and once allowed, the tool runs and asks again. Only a tool the model is sent by default can ask again; a call to any other tool gets the unknown-tool error result instead. A resolution that names no request in the context is reported as `unknown_request`, and its request still waits.

Settling the requests is not a step, so `steps` and `maxSteps` count only the model calls the resumed run makes. The results are recorded in the order the model made the calls. When no call still waits and an approved call's result sets `terminate`, such as the output tool's, the run ends `done` without a model call. Pass `recheck` to run current policy just before an approved call runs. It gets copies of the request and its input, so editing them changes nothing, and resolves to `"allow"`, or to `{ deny: reason }`, which gives the model an error result instead. A `recheck` that throws or returns anything else denies the call. Without `recheck`, a verified approval runs, so check policy before you resolve.

`continueRun()` refuses a context it can't resume safely. It throws `invalid_run_options` for a context whose last assistant message has a call with no result and no pending request, because that call's pause record was lost, and silently answering it would hide the loss. It also throws for a pending request whose call doesn't wait in the context, and for malformed `pending`, `pendingInputs` or `resolutions`. Store `pending` and `pendingInputs` with the messages.

A request is meant to be answered once, but the SDK can't see your other processes, so single use is your store's job. Mark a request used, atomically, before you call `continueRun()` with its answer, and refuse a second resume of the same stored context there. Within one call, two resolutions for one request are refused as `replayed`.

### `blockingApprovals()` answers inside the run, where the person waits with the process

Where the run and the person share a process, such as a terminal, `blockingApprovals(handler)` answers approvals without ending the run. Join it with your gate:

```ts
const interceptors = composeInterceptors(gate, blockingApprovals(async (request, { input }) => askInTerminal(request, input)));
```

When a gate asks, the run signs the request and emits `approval_request` before it calls the handler, so a crash while it waits still leaves a signed record to resume from. The handler returns a `Resolution` for that request, which the run checks against the request like a resumed one. An `allow` runs the call, and a `deny` gives the model an error result. An answer that names another request, an answer of the wrong kind, a handler that throws and an abort while the run waits each deny the call, and all but the abort emit a `hook_error` with `hook: "blockingApprovals"`. `composeInterceptors()` joins at most one `blockingApprovals()` object.

### Pass `hmacSigner()` wherever a pause may resume in another process

The run signs with its `signer` option. The default, `ephemeralSigner()`, holds a random key that lives only in this process. On a serverless host an isolate or function can be recycled between the pause and the answer, and another process rejects the signature as one from an unknown key. The default signer is also shared by every run in the process, and the signed fields name no run or tenant, so a host that serves several tenants in one process stores each tenant's requests apart and passes a signer of its own. Pass `hmacSigner({ keys, current })` over a key ring you keep there:

```ts
const signer = hmacSigner({ keys: { "2026-11": key2611, "2026-12": key2612 }, current: "2026-12" });
```

`hmacSigner()` signs with the key `current` names and verifies with any key in `keys`, each 32 bytes or more. To rotate, add a new key and make it current, and keep the old key in the ring until no stored pause names it. A request whose `keyId` isn't in the ring fails verification. Keys stay inside non-extractable Web Crypto keys: no error, event, result or span holds a key's bytes.

A pause that can't be signed is never written unsigned. If the signer throws, the call is blocked with an error result, and a `hook_error` with `hook: "signer"` names the cause without the signer's own message. A request id from `idGenerator` that repeats the run's id or an earlier request's is replaced by a random UUID, so a generator that always returns one id still pauses every call.

### Sign a pause outside a run with `createPendingRequest()`

Code that makes a tool call itself, rather than through the model, can build the same record:

```ts
const request = await createPendingRequest({ kind: "approval", callId, tool: "refund", input, reason }, signer);
```

`createPendingRequest()` signs through the same code path as the loop, so for the same fields, id and signer the two requests are identical byte for byte. Its optional third argument takes `generateId` and `now`, which default to `crypto.randomUUID()` and the current time. It rejects with `invalid_run_options` for a `kind` other than `"approval"` or a signer that isn't an `ApprovalSigner`.

Before the call runs, check the person's answer against the stored request with `verifyResolution()`, the check `continueRun()` makes:

```ts
const check = await verifyResolution(request, resolution, { signer, call: { callId, tool: "refund", input } });
if (check.ok && "decision" in check.resolution && check.resolution.decision === "allow") await refund(input);
```

It verifies the signature under the key the request names, so a ring that has rotated past that key still verifies it, then checks the call id and tool, the input against the signed hash, and that the answer fits the request's kind. It never throws for bad input: it returns `ok: false` with the first `RejectionCause` it found.

### The signers and the record belong to the safety package

`ApprovalSigner`, `ephemeralSigner()`, `hmacSigner()`, `canonicalInputHash()`, `verifyResolution()`, `SignedPendingRequest`, `Resolution`, `Recheck`, `RejectionCause`, `ResolutionCheck`, `VerifyResolutionOptions`, `PendingCall` and `SignPendingOptions` are `@buildanagent/agent-safety`'s, re-exported unchanged. So are `SafetyError` and `isSafetyError()`, because `hmacSigner()` throws a `SafetyError` with code `invalid_key_ring` for an unusable ring, and `createPendingRequest()` rejects with one, code `invalid_pending` or `invalid_input`, for a blank field or an input with no canonical JSON form.

Until the safety package is published, the SDK carries byte-identical copies of its files, and a test fails if they drift. One consequence follows from the copies: in a process that loads both packages, each has its own ephemeral signer, so a pause signed by one's default doesn't verify with the other's.

## Export a run as OpenTelemetry spans with `otelObserver()`

`otelObserver()` turns a run's events into spans that follow the OpenTelemetry GenAI conventions, and it sends them only to the tracer you pass. Import it from `@buildanagent/sdk/otel` and add it to `observers`. Pass it in `observers`, not to `run.on()` later: an observer added late misses `run_start` and records nothing for that run.

```ts
import { otelObserver } from "@buildanagent/sdk/otel";
import { context, type Span, trace } from "@opentelemetry/api";

const telemetry = otelObserver({
  tracer: trace.getTracer("my-agent"),
  agentName: "triage",
  childContext: (parent) => trace.setSpan(context.active(), parent as Span),
  forceFlush: () => provider.forceFlush(),
});
const started = run({ model, system, input, observers: [telemetry] });
```

A run produces one `invoke_agent` span, one `chat` span for each model call and one `execute_tool` span for each tool call. The model and tool spans are children of the run's span. Each span starts and ends at the timestamps of its events, so a run on a fixed clock gives the same span times every time.

The observer imports nothing from OpenTelemetry. `tracer` needs only a `startSpan(name, options, context)` method, which an OpenTelemetry `Tracer` has, and `@opentelemetry/api` stays your own dependency. Two options carry the trace context explicitly, so nothing depends on an ambient `AsyncLocalStorage`, which some runtimes lack:

- **`parentContext`** is the context the run's span starts in, such as the one for an incoming request. Left out, the tracer decides, and an OpenTelemetry tracer uses the active context. Every run an observer serves starts in the same `parentContext`, so when it belongs to one request, create one observer per request.
- **`childContext(parent)`** is required. It builds the context for a model or tool span from the run's span, which makes those spans its children in the same trace. The observer can't build a context itself, because that takes `@opentelemetry/api`.

Each `chat` span records `gen_ai.usage.input_tokens` as `totalInput(usage)`, so cached tokens count in it, and `gen_ai.usage.output_tokens` as `usage.output`, which includes reasoning. It adds the cache read, cache write and reasoning counts when they are above zero. A call whose provider reported no usage gets no token attributes, because zeros would read as a measurement. The run's span carries the sums over all calls. A failed model call, a tool that returns `isError` and a run that ends in `error` set the span's status and `error.type`.

Spans hold no content unless you ask. With `captureContent: true`, the `chat` spans also record `gen_ai.system_instructions`, `gen_ai.input.messages` and `gen_ai.output.messages`, and the tool spans record `gen_ai.tool.call.arguments` and `gen_ai.tool.call.result`, all as JSON strings in the conventions' message format. The arguments are the ones the tool ran with, so a `beforeToolCall` gate's replacement wins over the model's input. Image bytes are never recorded. An error's message can quote a prompt or an argument, so it becomes the span's status description only when content is on; with content off, a failed span gets its error status and `error.type` alone. Prompts and tool results can hold secrets and personal data, so turn content on only for a backend you trust with them.

`telemetry.flush()` calls your `forceFlush`. On Cloudflare Workers, pass it to `ctx.waitUntil()` so spans survive the end of the request. An observer that throws, a tracer included, becomes a `hook_error` event and never changes the run, like any observer.

A run's `result` rejects for a programmer error, such as a tool that returns a malformed result. That run sends no `run_end`, so its spans stay open. Call `telemetry.endRun(started.id, error)` in your `catch` to end them as failed and let the observer forget the run.

One limit applies to nested runs. A run that a tool starts is another run to the observer, so its span starts in `parentContext` and is not a child of the calling tool's span, because events carry no parent run id.

The names come from one constants file. `GEN_AI_ATTRIBUTES` holds every attribute name the observer writes, and `SEMCONV_GENAI_COMMIT` (`"d28355d"`) names the commit of `open-telemetry/semantic-conventions-genai` they follow. The conventions are at Development stability as of November 2026, so a rename upstream changes only that file. Your tests can import the same constants.

## Define a tool with `defineTool()`

A tool is a name, a description the model reads, an input schema and an `execute` function. This tool looks up an order in your own store:

```ts
export function lookupOrderTool(findOrder: FindOrder) {
  return defineTool({
    name: "lookup_order",
    description: "Look up an order by its number and return its status.",
    inputSchema: z.object({ order: z.number().int().positive() }),
    async execute({ order }) {
      const found = await findOrder(order);
      if (found === undefined) return { content: [{ type: "text", text: `No order ${order} exists.` }], isError: true };
      return { content: [{ type: "text", text: `Order ${order} is ${found.status}.` }], structured: found };
    },
  });
}
```

The input schema is either a Standard Schema or a raw JSON Schema object. A Standard Schema is a schema from a library that can also describe itself as JSON Schema: Zod 4.2 or later, ArkType, or Valibot through `toStandardJsonSchema()` from `@valibot/to-json-schema`. A raw schema follows draft 2020-12, or draft 7 when its `$schema` names draft 7. Raw schemas check `format` keywords such as `email` and `date`.

`execute` receives the validated input and returns a tool result with three channels:

- **`content`** is the text and images the model reads.
- **`details`** is for your logs and user interface; the model never sees it.
- **`structured`** is typed data for your code, such as the order above.

`defineTool()` checks the tool once, when you call it. A name outside the tool-name rule, 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`, throws an `SdkError`. So does a schema that does not compile.

## A failed call becomes an error the model can fix

Every tool call runs the same steps in order: find the tool by name, coerce the arguments, validate them, give `repair` one chance, then run `execute`. A failure the model caused, at any step, returns an error result to the model and throws nothing. When the model sends `"forty-two"` as the order number, it reads this:

```text
The arguments for tool "lookup_order" are invalid:
- /order: Invalid input: expected number, received string
Received arguments: {"order":"forty-two"}
Do not substitute a mock, a placeholder or invented data for this tool's result. Fix the call, try another approach, or tell the user what failed.
```

Each failing field appears as its JSON Pointer path, so the model knows exactly what to fix. The last line is there because agents have been seen to answer a failed tool by inventing a result. Three options on the tool and one flag on your own result change what happens:

- **`repair`** receives invalid input and its issues, and returns fixed input to validate again, or `undefined` to report the failure.
- **`formatError`** builds the model's content for a failed call in place of the default text.
- **`redactErrors: true`** shows the model a fixed line when `execute` throws, and keeps the thrown message in the result's `details`. Use it when error messages may hold secrets, such as connection strings.
- **`isError: true`** on your own result marks a failure you report yourself, such as an order that doesn't exist.

The model also sees an error for a tool name that doesn't exist, with the list of real ones. A response that stopped at its output limit runs none of its tool calls, because their arguments may be cut short; the model is asked to send each call again. A response that ended in an error or was aborted runs none of its calls either, and once the run is cancelled no further call starts.

## Arguments are coerced by three rules

Models sometimes send a number as a string. Before validation, the SDK converts these values, and nothing else:

1. A string holding JSON becomes the object or array it encodes, where the schema expects an object or an array.
2. A string holding a decimal number becomes that number, where the schema expects a number, or an integer when the number is whole. A whole number beyond 2^53 stays a string, because JavaScript would round it to a different number.
3. The string `"true"` or `"false"` becomes a boolean, where the schema expects a boolean.

The rules reach nested values through `properties` and `items`, and only where the schema names a single type. A value that already has the expected type is never changed.

## Report what a write did with an outcome

A tool that changes the world, such as a refund, declares `effect: { kind: "write" }`. A tool without it counts as read-only, so it is safe to run again after a crash. The optional `businessKey` names the real-world operation, such as `refund:42`, so a retry is recognised as the same refund.

Such a tool returns an `outcome` beside its content. An outcome says which of five things happened: `applied`, `not_applied`, `compensated`, `partial` or `unknown`. It also says what the model should do next and whether a retry is safe. This refund tool reports a declined refund:

```ts
return { ...base, kind: "not_applied", retry: "never", applied: [], reason: reply.code, next };
```

The model reads the outcome first, as a sentence and as JSON, and then your content. For the declined refund the sentence begins "The refund_create call did not take effect, and nothing changed." Every kind except `applied` marks the result as an error. An outcome that breaks a rule, such as a retry its kind doesn't allow, throws an `SdkError`.

## End the run with `outputTool()`, or ask with `clarificationTool()`

`outputTool({ name, schema })` turns the run's final answer into a tool call. Pass it to `run()` as `output`. A call whose input passes the schema ends the run `done`, and the validated answer is `result.output`. A call that fails the schema returns the issues to the model, which can correct its answer and call again. If the model answers in text instead, or another tool returns `terminate: true`, the run still ends `done`, with `result.output` undefined. The output tool must keep the default `exposure`, because the model has to be sent it.

`clarificationTool()` gives the model a tool named `ask_user` that takes one `question`. Pass `{ name }` to call it something else. Once the model calls it, the run signs a pending request of kind `clarification` with the question in `question`, emits `approval_request`, and ends with `stopReason: "clarification_requested"` once the step's other calls have their results. The asking call has no result yet. Pass the user's answer to `continueRun()` as `{ requestId, answer }`, and the model reads the answer as that call's result. Any tool whose result carries `pause: { kind: "clarification", question }` pauses the same way. When a gate also paused a call in the same step, the run ends `awaiting_approval`, with both requests in `pending` in the model's order.

## A step's tool calls run in parallel

When the model asks for several tools in one response, the run checks them one at a time, in the order the model sent them, and then starts them all together. Results are added to the transcript in the model's order, whichever call finishes first, and a result is added as soon as every result before it is in. Three settings on a tool change the schedule:

- **`executionMode: "sequential"`** makes every call in that step run one at a time, in the model's order. Use it for a tool that depends on the calls around it. One call to a sequential tool is enough: its whole step runs in sequence, including calls to other tools, even when that call itself fails validation.
- **`resourceKey(input)`** returns a string that names what a call touches, such as a file path. Calls in one step with the same key never run at the same time, even when they come from different tools, and they run in the model's order. Calls with different keys, or no key, still run together.
- **`readOnlyHint`**, set in `annotations`, says that a tool changes nothing. It affects scheduling only when the tool is also `firstParty: true` and declares no `effect`. A read-only call doesn't wait for other read-only calls that share its key, though it still waits for a write before it, and a write waits for the reads before it. A tool from an MCP server stays `firstParty: false`, so its hint is ignored: the hint is a claim by whoever runs the server.

Every tool gets a `ctx.signal` that fires when the run is aborted. It also fires when a sibling call in the same step throws a programmer error, an `SdkError` such as a malformed result, because the run stops there. A call still waiting for its key never starts after the signal fires and gets an error result instead. The run waits for the other calls to return, passes on their results in the model's order (calls after the failing one that had already run included), and then throws, so pass the signal on to your own I/O. A sibling's error result, one the model can read and answer, such as invalid input or a tool that threw, cancels nothing.

## `SdkError` marks a mistake in your code

The SDK throws only for programmer errors, never for a failure the model caused. `isSdkError(error)` recognises the error, and its `code` says why:

- **`invalid_tool_definition`**: a tool's name, description, schema, exposure, `executionMode`, `resourceKey` or `progressKey` is unusable, or two tools share a name.
- **`invalid_tool_result`**: `execute` returned something other than a tool result, or an invalid outcome. A text block needs a string `text`, and an image block a string `mediaType` and `data`. The run's `result` rejects with this error, and iterating the run throws it after the last event.
- **`invalid_run_options`**: `run()` or `continueRun()` got a model that isn't from `createModel()`, a `maxSteps` that isn't a positive integer, an output tool whose `exposure` isn't `"direct"`, a `budgetUsd` that isn't a non-negative number, a `progress` threshold that isn't a positive integer, or a `depth` or `maxDepth` that isn't a whole number. `continueRun()` also throws it for a context it can't resume, such as one whose waiting call lost its pending request.
- **`max_depth_exceeded`**: a tool started a run nested deeper than `maxDepth` allows.
- **`undelivered_message`**: `steer()` or `followUp()` rejects with it when the run ended before it could apply the message.
- **`invalid_model_stream`**: a model's stream ended without a final message, which only a broken adapter does.
Hooks add two `SdkError` codes:

- **`invalid_hook_result`**: an interceptor returned something its type forbids, such as a gate that returned no decision, an `activeTools` list that names no tool, or a replacement input that fails the tool's schema. The run's `result` rejects with this error.
- **`hook_failed`**: an interceptor threw while the run fails closed. The run catches it and reports a `hook` error result, so it never reaches your code.
- **`run_stopped`**: the error is a `RunStoppedError` from `runOrThrow()`.
- **`unexpected_model_call`**: the error is an `UnexpectedModelCallError` from `ScriptedModel`.
- **`invalid_recording`, `recording_expired` and `recording_mismatch`**: the error is a `RecordingError` from `recordPairs()` or `replayPairs()`, for a malformed recording, an expired one, or one that differs from the replay.

## Test against a strict scripted model

`ScriptedModel` plays back the responses you script, one per model call. It fails loudly when your test's expectations drift:

- **Too many calls throw.** A call past the last scripted step throws `UnexpectedModelCallError`, an `SdkError` with code `unexpected_model_call`. Behind `createModel()`, the gateway turns that throw into a failed call, so a run ends `error` instead of throwing.
- **`assertComplete()` catches both drifts.** It throws if any step was never called, or if a call came after the last step. Call it when the test ends, so an over-run fails the test even when the run swallowed it.
- **Requests are snapshots.** `calls` holds a frozen copy of each request, taken when the call was made, so later changes to your conversation never show up in it.
- **Streams look real.** Text, reasoning and tool-call input arrive in small pieces (4 characters by default), and an abort is checked between pieces.

This test model answers a refund request with a tool call, then reads the conversation it is sent the second time:

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

A step is either a fixed response or a function that builds one from the request. A response stops with `"tool_calls"` when it contains a tool call and with `"stop"` otherwise. Setting `error` ends the stream with an error instead. Set `usage` to the token counts the response reports; counts you leave out are zero. A response without `usage` acts like a provider that reported none: its usage is marked `unreported`, so `createModel()` prices it as unknown rather than free. Pass `usage: {}` to report zero tokens.

## `autoResponder()` drives an agent without a script, and never calls a host tool

`autoResponder()` returns a step that behaves like a cooperative model. On a request whose conversation has no tool call yet, it calls one offered tool: the one the user's text names, or else the first. It fills the tool's input with `synthesizeInput(schema)`, which picks `const`, the first `enum` value, `default`, the first `anyOf` branch, or a plain value of the schema's type, such as `"example"` or the `minimum`. On every later request it answers in text.

The step never calls a tool named in `DEFAULT_DENIED_TOOLS`, which lists the shell, file-editing and screen tools of the agent SDKs we verify, such as `bash`, `exec_command`, `apply_patch`, `write`, `edit`, `multi_edit`, `str_replace_based_edit_tool`, `computer` and `delete`. It matches the whole name, ignoring case, hyphens and underscores, because one of our verification runs let OpenAI's `exec_command` through a filter that checked only the tool's kind. When a denied tool is the only tool offered, the step answers in text instead. `denyTools` adds names or regular expressions to the list, and nothing removes the defaults. One step answers one call, so this model calls a tool and then answers:

```ts
const model = new ScriptedModel([autoResponder({ denyTools: [/^deploy/] }), autoResponder()]);
```

## Record a real model once, then replay it offline with `replayPairs()`

`recordPairs(model, { providerVersion, expiresAt })` wraps a model and records each call as a pair: the normalised request (model, context and options) and every event the call streamed. Pass `recorder.model` to `run()`, then write `recorder.pairs()` to a fixture as JSON. Each pair is stamped with the SDK version, the model's API, provider and id, the provider version you name, the recording time and the expiry.

A pair holds the gateway's transcript types, not wire bytes, so it survives changes to an adapter's wire format. It also holds no credential. The adapter's key and headers never reach a call, and from the call's options the recorder leaves out every property named like a credential header (`authorization`, `x-api-key`, `api-key`, `x-goog-api-key`, `proxy-authorization`, `cf-aig-authorization` or a cookie), `apiKey`, or a name ending in `token`, `secret` or `password`, at any depth and in any spelling. The conversation and the model's output are kept exactly, because the replay must reproduce them. `retry` events stay out, because a replay can't reproduce them.

`replayPairs(pairs)` returns a `ReplayModel`, a `ScriptedModel` that streams each pair's events exactly as they were recorded. Wrap it with `createModel()` under the recorded id, so the replayed calls are priced from the same catalog entry. Leave out the middleware the recorded model had: the recorder sat outside it, so the pairs already hold its effect.

```ts
const replay = replayPairs(JSON.parse(fixture), { expect: { providerVersion: "2026-10-21" } });
const model = createModel({ adapter: replay, id: replay.modelId });
```

Given the same clock and ids, the replayed run streams the same events as the recorded one. A replay refuses four kinds of fault, each with a `RecordingError`, an `SdkError`:

- **`recording_expired`:** the clock has reached the stamp's `expiresAt`. Record the fixture again.
- **`recording_mismatch` on the stamp:** the pairs disagree on their stamp, a field differs from `expect`, or the SDK that recorded them is on another release line (another minor version under 0.x).
- **`recording_mismatch` on a request:** a call sent a request other than the recorded one. The run ends `error`, and `replay.assertComplete()` throws the error, which names the first field that differs.
- **`invalid_recording`:** the pairs are empty or malformed.

## Scripted doubles stand in for the approver and an MCP server

`scriptedApprovals(answers)` answers the run's approval requests in order, through `blockingApprovals()`, so a test drives the real signing and checking path. Join it with a gate that returns `ask`. Each answer takes the id of the request it answers, so give a `requestId` only to test an answer that names the wrong request. `requests` holds every request the run raised, and `assertComplete()` throws when an answer went unused or a request came after the last answer, which the run denied:

```ts
const approvals = scriptedApprovals([{ decision: "allow" }, { decision: "deny", reason: "not today" }]);
run({ model, system, input, tools, interceptors: composeInterceptors(gate, approvals), signer: testSigner() });
```

`testSigner()` signs with a fixed, published key whose id is `TEST_KEY_ID`, so a pause signed in one test process verifies in another and can be checked into a fixture. Anyone can forge its signatures, so use it only in tests.

`scriptedMcpServer({ name, tools })` builds the tools an MCP server would lend an agent. Each tool is named `mcp__<server>__<tool>`, has `kind: "dynamic"` and `firstParty: false`, and returns its scripted results one call at a time. `calls` records every call, and `assertComplete()` throws when a result went unused or a call came after the last one.

## Tests give the same result every run

Nothing in the testing export reads the system clock or `Math.random()`. `fixedClock(start, stepMs)` returns a clock that advances by a fixed step, and `sequentialIds(prefix)` returns `prefix-1`, `prefix-2` and so on. Pass them to `run()` as `clock` and `idGenerator`. For random numbers you can repeat, import `seededRandom(seed)` from `@buildanagent/gateway/testing`. The same script with the same clock and ids streams the same events every time, timestamps and run id included.

Start each test file with `import "@buildanagent/gateway/testing/setup"`, which keeps the test offline.

## The support-triage capstone shows the whole SDK working in one agent

The capstone is the support-triage agent that each of the eight SDKs we verified implements, built on our SDK in [`examples/triage-agent.ts`](examples/triage-agent.ts). It gives the model a read-only `lookup_customer` tool, an `escalate` tool that waits for a person, and a `submit_triage` output tool. An audit observer records every call, the run stops after 8 steps, and a $0.25 budget stops it earlier. `startTriage()` runs the agent, and `resumeTriage()` resumes a paused run from its stored `context`, which can happen in another process that holds the same signing key.

The conformance suite in [`test/triage-suite.ts`](test/triage-suite.ts) takes a loop's `run` and `continueRun` and checks these behaviours on each backend. The backends are the scripted model and the Anthropic and Chat Completions mock transports:

- an approved escalation runs once in a second process and ends with a typed result;
- a rejected escalation never runs, and the model reads the denial;
- a result that fails its schema returns to the model as an error;
- a forged signature runs nothing and calls no model;
- a stored input that no longer matches its signature runs nothing;
- the step cap and the budget each end a runaway run;
- every request offers only `lookup_customer`, `escalate` and `submit_triage`.

The cases assert nothing about observers, so a loop without them can run the suite. `test/capstone.test.ts` checks the audit trail on the SDK's loop.

The tables in the [deep comparison](../../docs/comparison/deep-comparison.md#1-the-same-agent-takes-58-to-115-lines-on-every-sdk-and-differs-in-its-gate) count non-blank, non-comment lines, and include each reference file's scripted model and assertions. Our agent file holds neither, so the second row adds the suite and its backends, which cover more cases on three backends. The figures below are counted from the files as they are now, so two reference rows differ from the comparison's, which predates later edits to those files. A test recounts every row and the hook count, and fails when the table drifts. The Hooks column counts the extra pieces a capstone needs beyond its tools. Ours are the `beforeToolCall` gate and the audit observer, and LangChain's are two as well; a blank cell means the comparison records none.

| Capstone | Code lines | Hooks |
| --- | --- | --- |
| Our capstone, the agent alone | 80 | 2 |
| Our capstone with its cases and backends | 434 | 2 |
| Vercel AI SDK | 58 | |
| Claude Agent SDK | 62 | |
| LangChain.js | 67 | 2 |
| OpenAI Agents SDK | 76 | |
| Pi | 87 | |
| Copilot SDK | 105 | |
| Google ADK | 114 | |
| Cloudflare Agents | 122 | |

## A reference loop shows the real loop's shape in under 400 lines

[`reference-loop/reference-loop.ts`](reference-loop/reference-loop.ts) is a loop you can read in one sitting. It exports `run()` and `continueRun()`, ends a run with every stop reason of the real loop except `clarification_requested`, and imports only the public exports of `@buildanagent/gateway` and `@buildanagent/sdk`. The capstone's conformance suite runs against it on the scripted model and both mock transports, so it cannot drift into a toy: a change to the real loop that the reference no longer matches fails `test/reference-loop.test.ts`. That file also counts the loop's non-blank, non-comment lines and fails at 400, and it checks that the reference and the real loop end seventeen scripted runs with the same stop reason, step count, message count and failed tool results, and it runs five resume cases on both loops.

Each step runs in the real loop's order: `transformContext`, `beforeModelCall`, the streamed model call, `afterModelCall`, the tools, then the stop check with `shouldStop` and the progress rule. The table maps each part to the module it simplifies.

| Part of the reference loop | Real module | What the reference leaves out |
| --- | --- | --- |
| `run()`, `continueRun()`, `start()` | `run.ts` | Streaming events (they arrive after the run ends), `steer()`, `followUp()`, `on()`, observers and option checks |
| `drive()`, `step()`, `callModel()` | `loop.ts` | The raw model events, the `retry` and `warning` events, the withheld stand-in for a failed `afterModelCall`, the aborted closing message and `onFailure: "continue"` |
| `budgetBlock()` | `budget.ts` | The unknown-price check before the first call |
| `runCalls()`, `runCall()`, `execute()` | `tools/pipeline.ts` | Parallel calls (it runs them one at a time, so an abort while one call runs also stops the calls after it), coercion, `repair`, raw JSON Schema validation, rendering write outcomes and `clarificationTool()` |
| `pause()`, `settle()`, `failedCheck()` | `pauses.ts`, `resume.ts`, `hook-runner.ts` | The `recheck` option, replayed and unknown resolutions, `blockingApprovals()` and the shape checks on a stored context. It checks each stored request with `verifyResolution()`, as the real loop does |
| `stopCheck()`, `decide()`, `stuckReason()` | `loop.ts`, `progress.ts` | The per-`progressKey` rule |

The reference loop reaches `clarification_requested` through no path, because only the SDK's internals can sign a clarification request, and `createPendingRequest()` signs approvals only. Read it first, then read `loop.ts` for what a production loop adds.

## Build the SDK with its dependencies

The SDK compiles against the gateway's built `dist/*.d.ts`, so build both from the repo root with `pnpm --filter "@buildanagent/sdk..." build`, which builds the gateway first. `pnpm build` builds every package in the same order. On a clean checkout, `pnpm build` or `pnpm pack` run inside `packages/sdk` fails, because the gateway has no `dist/` yet. Tests and type-checks need no build.
