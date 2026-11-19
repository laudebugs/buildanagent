# @buildanagent/sdk

The SDK runs your agent's loop over [`@buildanagent/gateway`](../gateway/README.md): it calls the model, runs the tools the model asks for, and stops when the work is done. Its testing export lets you test that agent offline against a scripted model, with no API key.

As of November 2026 the package holds the loop, tool definitions and the testing export. Hooks, approvals and budgets come next.

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

`model` comes from `createModel()` in the gateway, and a bare model id is a type error. A tool whose `exposure` is `"deferred"` or `"hidden"` is never sent to the model, and a call to it gets the unknown-tool error.

### Every run ends with a stop reason

A failed model call or a failing tool never makes a run throw. The run ends with a result whose `stopReason` says why:

- **`done`**: the model answered without calling a tool, or an output tool accepted its answer. A text answer cut off at `maxOutputTokens` also ends `done`, so check whether the last message's `stopReason` is `"length"` before you show it as complete.
- **`max_steps`**: the run made `maxSteps` model calls, 20 by default, and the model still wanted to go on. The run also emits a `warning` event with `code: "max_steps"`, so a cap that cut a run short shows up in your logs.
- **`error`**: a model call failed. `result.error` copies the failure's `kind`, `message` and HTTP `status`. Its `kind` is `overflow` for a request too large for the model's window, `quota` for an account out of credit, `retryable` for a temporary failure that outlasted the gateway's retries, and `fatal` otherwise.
- **`aborted`**: you aborted the run.
- **`stopped`**: a tool from `clarificationTool()` asked the user a question, and `result.stoppedBy` is `"clarification"`.

`maxSteps` counts model calls, so an output call that fails its schema spends one of them. The tool calls of the last allowed response still run, so every call in the transcript has a result.

Only the `done` result carries `output`. TypeScript rejects `result.output` until you have checked `result.stopReason === "done"`, so an unfinished run can't pass for a finished one. Every result carries `usage` and `cost`, summed over the run's model calls, and `steps`, the number of calls. `result.messages` holds the messages this run added. `result.context` holds the whole conversation, ready to continue.

### `runOrThrow()` turns an unfinished run into an exception

If you would rather catch an exception than check the stop reason, `runOrThrow(run)` returns the `done` result and throws a `RunStoppedError` for any other. The error carries the `result` and the `context` to continue from. `RunStoppedError.isInstance(error)` recognises it, even across two copies of the package:

```ts
const result = await runOrThrow(run({ model, system, input }));
```

### Continue a conversation with `continueRun()`

`continueRun(context, options)` goes on from a context: a previous result's `context`, or one you rebuilt from your own store. A context is plain JSON holding the system prompt and the messages. A run that stopped at `max_steps` continues with the model reading its last tool results. A `done` context ends with the model's answer, so add a user message to it before you continue, or pass the messages as `history` to `run()` with the new input.

### Abort a run with `run.abort()` or a signal

`run.abort(reason)` stops a run, and so does the `signal` option. A model call in flight ends, and a running tool sees its `ctx.signal` fire. The run waits for that tool to return, so pass the signal on to your own I/O. Calls that haven't started get an error result instead of running.

An aborted run's transcript stays well formed: every tool call has a result, and the last message is an assistant message with `stopReason: "aborted"`. When tool results would end the transcript, because the abort came while tools ran or cut off a response that held tool calls, the loop appends an empty aborted message after them. Each gateway adapter drops it before the next request, so the transcript can be sent again as it is.

## A run streams one closed set of events

Iterating a run yields its events. Each iteration starts from the run's first event, so you can start iterating at any time, even after the run has ended. Every event carries the run's `runId`, a `seq` that counts events from 0, a `stepIndex` that counts model calls from 0, and a `timestamp` from the run's clock.

The events come in two layers. The delta layer streams each content block by its index, for a user interface: `text_start`, `text_delta` and `text_end`, and the same three for `reasoning` and `tool_input`. The item layer carries the finished pieces for a log:

- **`run_start`** comes first, with the SDK's version, the spec version and the model.
- **`step_start`** and **`step_end`** wrap one model call and its tool calls; `step_end.stopCheck` says whether the run goes on.
- **`model_call_start`** carries the request, and **`model_call_end`** the final message.
- **`tool_call_start`**, **`tool_call_update`** and **`tool_call_end`** follow each tool call; `tool_call_end.result` is what the model reads.
- **`retry`** reports a failed request the gateway is retrying, and **`warning`** reports a reached cap or a model warning.
- **`error`** and **`abort`** report a failed call and an abort request.
- **`agent_settled`** fires once nothing is running any more, retries and tools included. **`run_end`** follows it and carries the result.

`AGENT_EVENT_TYPES` lists every type at run time, and a run emits no other. The union is closed, so a `switch` over `event.type` can be exhaustive.

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

`clarificationTool()` gives the model a tool named `ask_user` that takes one `question`. Pass `{ name }` to call it something else. Once the model calls it, the run ends with `stopReason: "stopped"` and `stoppedBy: "clarification"`, and the question is the call's input in `result.messages`. To go on, add the user's answer to `result.context` as a user message and pass the context to `continueRun()`.

## A step's tool calls run in parallel

When the model asks for several tools in one response, the run checks them one at a time, in the order the model sent them, and then starts them all together. Results are added to the transcript in the model's order, whichever call finishes first, and a result is added as soon as every result before it is in. Three settings on a tool change the schedule:

- **`executionMode: "sequential"`** makes every call in that step run one at a time, in the model's order. Use it for a tool that depends on the calls around it. One call to a sequential tool is enough: its whole step runs in sequence, including calls to other tools, even when that call itself fails validation.
- **`resourceKey(input)`** returns a string that names what a call touches, such as a file path. Calls in one step with the same key never run at the same time, even when they come from different tools, and they run in the model's order. Calls with different keys, or no key, still run together.
- **`readOnlyHint`**, set in `annotations`, says that a tool changes nothing. It affects scheduling only when the tool is also `firstParty: true` and declares no `effect`. A read-only call doesn't wait for other read-only calls that share its key, though it still waits for a write before it, and a write waits for the reads before it. A tool from an MCP server stays `firstParty: false`, so its hint is ignored: the hint is a claim by whoever runs the server.

Every tool gets a `ctx.signal` that fires when the run is aborted. It also fires when a sibling call in the same step throws a programmer error, an `SdkError` such as a malformed result, because the run stops there. Calls waiting for a key never start after it fires, and get an error result instead. The run passes on every other call's result, including those of calls after the failing one that had already run, and then throws. A sibling's error result, one the model can read and answer, such as invalid input or a tool that threw, cancels nothing. When the signal fires, the run waits for the other calls to return, so pass the signal on to your own I/O.

## `SdkError` marks a mistake in your code

The SDK throws only for programmer errors, never for a failure the model caused. `isSdkError(error)` recognises the error, and its `code` says why:

- **`invalid_tool_definition`**: a tool's name, description, schema, exposure, `executionMode` or `resourceKey` is unusable, or two tools share a name.
- **`invalid_tool_result`**: `execute` returned something other than a tool result, or an invalid outcome. A text block needs a string `text`, and an image block a string `mediaType` and `data`. The run's `result` rejects with this error, and iterating the run throws it after the last event.
- **`invalid_run_options`**: `run()` or `continueRun()` got a model that isn't from `createModel()`, a `maxSteps` that isn't a positive integer, or an output tool whose `exposure` isn't `"direct"`.
- **`invalid_model_stream`**: a model's stream ended without a final message, which only a broken adapter does.
- **`run_stopped`**: the error is a `RunStoppedError` from `runOrThrow()`.
- **`unexpected_model_call`**: the error is an `UnexpectedModelCallError` from `ScriptedModel`.

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

## Tests give the same result every run

Nothing in the testing export reads the system clock or `Math.random()`. `fixedClock(start, stepMs)` returns a clock that advances by a fixed step, and `sequentialIds(prefix)` returns `prefix-1`, `prefix-2` and so on. Pass them to `run()` as `clock` and `idGenerator`. For random numbers you can repeat, import `seededRandom(seed)` from `@buildanagent/gateway/testing`. The same script with the same clock and ids streams the same events every time, timestamps and run id included.

Start each test file with `import "@buildanagent/gateway/testing/setup"`, which keeps the test offline.

## Build the SDK with its dependencies

The SDK compiles against the gateway's built `dist/*.d.ts`, so build both from the repo root with `pnpm --filter "@buildanagent/sdk..." build`, which builds the gateway first. `pnpm build` builds every package in the same order. On a clean checkout, `pnpm build` or `pnpm pack` run inside `packages/sdk` fails, because the gateway has no `dist/` yet. Tests and type-checks need no build.
