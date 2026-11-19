# @buildanagent/sdk

The SDK runs your agent's loop over [`@buildanagent/gateway`](../gateway/README.md): it calls the model, runs the tools the model asks for, and stops when the work is done. Its testing export lets you test that agent offline against a scripted model, with no API key.

As of November 2026 the package holds tool definitions and the testing export. You can define your tools and their rules now; the loop that calls the model and runs them comes next, with hooks, approvals and budgets.

## Install the alpha with `pnpm add @buildanagent/sdk@alpha`

Every release is an alpha until the first stable one, and npm serves the alphas under the `alpha` dist-tag. Add the gateway too when your code calls a model, since its adapters make the calls:

```bash
pnpm add @buildanagent/sdk@alpha @buildanagent/gateway@alpha
```

Both packages always share one version, and the SDK depends on that exact version of the gateway. Name the tag: a plain `pnpm add @buildanagent/sdk` installs `0.0.0-bootstrap.0`, a deprecated placeholder, because `latest` stays on it until the first stable release. The package needs Node 22 or later.

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

The input schema is either a Standard Schema or a raw JSON Schema object. A Standard Schema is a schema from a library such as Zod 4, Valibot or ArkType that can also describe itself as JSON Schema. A raw schema follows draft 2020-12, or draft 7 when its `$schema` names draft 7. Raw schemas check `format` keywords such as `email` and `date`.

`execute` receives the validated input and returns a tool result with three channels:

- **`content`** is the text and images the model reads.
- **`details`** is for your logs and user interface; the model never sees it.
- **`structured`** is typed data for your code, such as the order above.

`defineTool()` checks the tool once, when you call it. A name outside the tool-name rule, 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`, throws an `SdkError`. So does a schema that does not compile.

## A failed call becomes an error the model can fix

Every tool call runs the same steps in order: find the tool by name, coerce the arguments, validate them, give `repair` one chance, then run `execute`. A failure at any step returns an error result to the model and throws nothing. When the model sends `"forty-two"` as the order number, it reads this:

```text
The arguments for tool "lookup_order" are invalid:
- /order: Invalid input: expected number, received string
Received arguments: {"order":"forty-two"}
Do not substitute a mock, a placeholder or invented data for this tool's result. Fix the call, try another approach, or tell the user what failed.
```

Each failing field appears as its JSON Pointer path, so the model knows exactly what to fix. The last line is there because agents have been seen to answer a failed tool by inventing a result. Four options change what happens:

- **`repair`** receives invalid input and its issues, and returns fixed input to validate again, or `undefined` to report the failure.
- **`formatError`** builds the model's content for a failed call in place of the default text.
- **`redactErrors: true`** shows the model a fixed line when `execute` throws, and keeps the thrown message in the result's `details`. Use it when error messages may hold secrets, such as connection strings.
- **`isError: true`** on your own result marks a failure you report yourself, such as an order that doesn't exist.

The model also sees an error for a tool name that doesn't exist, with the list of real ones. A response that stopped at its output limit runs none of its tool calls, because their arguments may be cut short; the model is asked to send each call again.

## Arguments are coerced by three rules

Models sometimes send a number as a string. Before validation, the SDK converts these values, and nothing else:

1. A string holding JSON becomes the object or array it encodes, where the schema expects an object or an array.
2. A string holding a decimal number becomes that number, where the schema expects a number, or an integer when the number is whole.
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

`outputTool({ name, schema })` turns the run's final answer into a tool call. A call whose input passes the schema ends the run, and the validated answer is the result's `structured` value. A call that fails the schema returns the issues to the model, which can correct its answer and call again.

`clarificationTool()` gives the model a tool named `ask_user` that takes one `question`. Its result carries the question as a pause, so the run can wait for the user's answer. Pass `{ name }` to call it something else.

## `SdkError` marks a mistake in your code

The SDK throws only for programmer errors, never for a failure the model caused. `isSdkError(error)` recognises the error, and its `code` says why:

- **`invalid_tool_definition`**: a tool's name, description or schema is unusable, or two tools share a name.
- **`invalid_tool_result`**: `execute` returned something other than a tool result, or an invalid outcome.

## Test against a strict scripted model

`ScriptedModel` plays back the responses you script, one per model call. It fails loudly when your test's expectations drift:

- **Too many calls throw.** A call past the last scripted step throws `UnexpectedModelCallError`.
- **Unused steps fail.** `assertComplete()` throws if any step was never called; call it when the test ends.
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

Nothing in the testing export reads the system clock or `Math.random()`. `fixedClock(start, stepMs)` returns a clock that advances by a fixed step, and `sequentialIds(prefix)` returns `prefix-1`, `prefix-2` and so on. For random numbers you can repeat, import `seededRandom(seed)` from `@buildanagent/gateway/testing`. The same script with the same clock and ids streams the same events every time.

Start each test file with `import "@buildanagent/gateway/testing/setup"`, which keeps the test offline.

## Build the SDK with its dependencies

The SDK compiles against the gateway's built `dist/*.d.ts`, so build both from the repo root with `pnpm --filter "@buildanagent/sdk..." build`, which builds the gateway first. `pnpm build` builds every package in the same order. On a clean checkout, `pnpm build` or `pnpm pack` run inside `packages/sdk` fails, because the gateway has no `dist/` yet. Tests and type-checks need no build.
