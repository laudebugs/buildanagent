# Fact-check: the docs app and its first pages

This log checks the claims that the pages of `apps/docs` make on 2026-11-22 (todo L5), and the versions the app pins. Each page restates what a package README or the source says, so each row names the primary source: the package's `package.json`, its source files, its README section (which its own docs check type-checks) or the npm registry.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

## Pins

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| L5-1 | Astro 7.4.11 and Starlight 0.42.10 are at least a week old, and `starlight-links-validator` 0.27.0 is the latest | ✅ | `npm view <package> time`, read 2026-11-22: Astro 7.4.11 on 2026-11-11, Starlight 0.42.10 on 2026-11-06, the validator 0.27.0 on 2026-10-09. Newer releases exist (Astro 7.4.12 and 7.4.13, Starlight 0.43.1); the plan and the book pin Astro 7.4.11, so the two apps share one |
| L5-2 | Starlight 0.42.10 accepts Astro 7.4.11, and the validator accepts that Starlight | ✅ | `npm view @astrojs/starlight peerDependencies`: `astro ^7.2.10`; the validator's peers are `astro >=7.2.10` and `@astrojs/starlight >=0.42.0` |

## Start pages

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| L5-3 | The gateway has adapters for Anthropic's Messages API and for servers that copy OpenAI's Chat Completions API | ✅ | `packages/gateway/package.json` exports `./anthropic` and `./openai-chat`; the gateway README's adapter sections |
| L5-4 | Both packages always share one version | ✅ | `.changeset/config.json`: `fixed` lists `@buildanagent/gateway` and `@buildanagent/sdk` in one group |
| L5-5 | The packages need Node 22.19 or later | ✅ | `packages/sdk/package.json`: `engines.node` is `>=22.19.0` |
| L5-6 | A plain `pnpm add @buildanagent/sdk` installs `0.0.0-bootstrap.0`, because `latest` stays on it until the first stable release | ✅ | `npm view @buildanagent/sdk dist-tags`, read 2026-11-22: `latest` and `bootstrap` are `0.0.0-bootstrap.0`, `alpha` is `0.1.0-alpha.23` |
| L5-7 | Starting Node with `--conditions=source` makes the SDK fail to load, because its validator maps that condition to a file its package does not ship | ✅ | SDK README, "Install the alpha", and its validator check |
| L5-8 | The gateway never reads an API key from the environment | ✅ | Gateway README, "Your key is the only key the gateway sends" |
| L5-9 | The tool's schema checks the model's arguments before the function runs, so a bad order number never reaches the store | ✅ | `packages/sdk/test/examples.test.ts`, "rejects an order number that is not a positive integer": the lookup function must not run |
| L5-10 | `createModel` binds one adapter to one model id, the adapter takes your key, and `claude-opus-5-5` is a model id | ✅ | Gateway README, "A model is an adapter object plus a model id" and "The Anthropic adapter"; the snippet type-checks in `test/snippets.test.ts` |

## Concept pages

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| L5-11 | A message's blocks are `text`, `reasoning`, `image` and `tool_call`, and an assistant message records its model, stop reason, error, usage and cost, with a `null` cost for an unknown price | ✅ | Gateway README, "A conversation is a list of messages you own" |
| L5-12 | The gateway turns a transcript into one the target model accepts, and leaves the original as it was | ✅ | Gateway README, "A transcript recorded on one model replays on another": "The pass returns a new array and leaves your transcript as it was" |
| L5-13 | A stream follows four rules: `start` first, each block `*_start`, `*_delta`, `*_end`, one terminal `done` or `error`, and an error terminal with stop reason `error` or `aborted` carrying content and usage so far | ✅ | Gateway README, "Every stream follows one rule" |
| L5-14 | A failed model call ends as an error terminal and never as an exception, and a `warning` event may come anywhere between `start` and the terminal | ✅ | Gateway README, the same section ("`complete()` … returns an error terminal's message instead of throwing") and the SDK README ("A failed model call … never makes a run throw") |
| L5-15 | Every run event carries `runId`, `seq` from 0, `stepIndex` from 0 and `timestamp`, and the event set is closed | ✅ | SDK README, "A run streams one closed set of events" |
| L5-16 | The nine stop reasons, with a default step limit of 20 | ✅ | `packages/sdk/src/result.ts` declares exactly nine `stopReason` values (`done`, `max_steps`, `aborted`, `no_progress`, `budget`, `error`, `stopped`, `awaiting_approval`, `clarification_requested`); `packages/sdk/src/defaults.ts` sets `maxSteps: 20`; the SDK README, "Every run ends with a stop reason", gives each meaning |
| L5-17 | Only a `done` result carries `output`, TypeScript rejects `result.output` before the check, and a text answer cut off at the output limit also ends `done` | ✅ | SDK README, the same section |
| L5-18 | A tool schema is a Standard Schema (Zod 4.2 or later, ArkType, Valibot) or a raw JSON Schema, and a result has `content`, `details` and `structured` | ✅ | SDK README, "Define a tool with `defineTool()`" |
| L5-19 | A tool name uses 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-` | ✅ | `packages/sdk/src/tools/define.ts`, the `invalid_tool_definition` comment: "the tool-name rule (1 to 64 characters" |
| L5-20 | A failure the model caused returns an error result and throws nothing, and `isError: true` marks a failure the tool reports | ✅ | SDK README, "A failed call becomes an error the model can fix" |
| L5-21 | A tool reads the caller from `ctx.app`, never from an argument, because the model fills in arguments | ✅ | SDK README, "Tools read the signed-in user from `app`, never from an argument" |
| L5-22 | A step's calls are checked in order, then started together, and results enter the transcript in the model's order | ✅ | SDK README, "A step's tool calls run in parallel" |
| L5-23 | A gate returns `allow`, `deny` or `ask`, a `deny` reaches the model as an error with the reason, and without a gate every registered tool is allowed | ✅ | SDK README, "A gate decides each tool call" |
| L5-24 | An `ask` ends the run `awaiting_approval` with a signed request that covers the id, kind, call id, tool, input hash and policy version | ✅ | SDK README, "A gate that asks ends the run with a signed pending request" |
| L5-25 | A verified `allow` runs the call once with the input its request signs, a failed check runs nothing, and single use is the store's job | ✅ | SDK README, "Resume a pause with `continueRun()`" |

## Guides and testing pages

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| L5-26 | A tool that changes the world declares `effect: { kind: "write" }`, a tool without one counts as read-only, and `businessKey` names the operation | ✅ | SDK README, "Report what a write did with an outcome"; `examples/refund-tool.ts` declares `effect: { kind: "write", businessKey }` |
| L5-27 | An outcome is one of `applied`, `not_applied`, `compensated`, `partial` and `unknown`, and every kind except `applied` marks the result as an error | ✅ | `packages/sdk/src/vendor/agent-safety/outcome.ts` line 13: `OutcomeKind` is `applied`, `not_applied`, `compensated`, `partial` or `unknown`; SDK README, the same section, for the error marking |
| L5-28 | `ScriptedModel` plays one answer per model call, a call past the script throws and ends the run `error`, `assertComplete()` catches an unused answer and an extra call, `calls` is a frozen snapshot, and streams arrive in small pieces | ✅ | SDK README, "Test against a strict scripted model"; `examples/04-scripted-model.ts` runs the over-run case |
| L5-29 | A scripted answer may be a function of the request | ✅ | SDK README, the same section: "A step is either a fixed response or a function that builds one from the request" |
| L5-36 | A gate that asks pauses the run before the refund runs, and a verified allow resumes it from stored JSON in another signer instance | ✅ | `packages/sdk/test/examples.test.ts`, "the refund approval example pauses a refund and runs it after the person allows it": the refund does not run before the answer and runs once after it |
| L5-30 | The testing setup blocks non-local requests, stops the run when a provider key is set, and turns real model requests off, and an adapter that tries anyway throws `model_requests_disabled` | ✅ | Gateway README, "Tests run offline"; `packages/gateway/src/request-policy.ts` throws a `GatewayError` with code `model_requests_disabled` |
| L5-31 | A mock transport answers the n-th request with the n-th response, records requests with credential headers as `[redacted]`, and throws past the script | ✅ | Gateway README, "Tests run offline"; `packages/gateway/src/testing/mock-transport.ts` throws `unexpected_request` past the script |
| L5-32 | `fixedClock()` and `sequentialIds()` exist, and nothing in the testing export reads the clock or `Math.random()` | ✅ | `packages/sdk/src/testing/index.ts` exports both; SDK README, "Tests give the same result every run" |

## Reference page

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| L5-33 | The gateway has the entry points `.`, `./anthropic`, `./openai-chat`, `./testing` and `./testing/setup`, and the SDK has `.`, `./otel` and `./testing` | ✅ | The `exports` maps of both `package.json` files |
| L5-34 | The gateway root exports `createModel()` and the helpers that price and replay a conversation, and the SDK root exports `run()`, `continueRun()` and `defineTool()` | ✅ | `packages/gateway/src/index.ts` (`createModel`, `projectCallCost`, `transformMessages`); `packages/sdk/src/index.ts` |
| L5-35 | `@buildanagent/sdk/otel` exports an observer that projects a run onto OpenTelemetry spans | ✅ | `packages/sdk/src/otel/index.ts`: `otelObserver()` projects a run's events onto `gen_ai.*` spans |

**Totals:** 36 claims: 36 ✅, 0 ✏️, 0 ⚠️.
