# B23: Give `ToolContext` typed app data that the caller sets when a run starts and the model never sees

| Field | Value |
| --- | --- |
| ID | `B23` |
| Status | `done` |
| Plan | [Build SDK §4.6](../../plans/build-sdk.md#46-trusted-app-data-for-tools-from-the-books-chapter-3-added-2026-11-19) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B10](B10-tool-runtime.md), [B11](B11-loop-core.md) |
| Size | M |

## Goal

Add an app-data field to our SDK's `ToolContext`, such as `ctx.app`, so a tool can read the signed-in user from data the caller set, never from an argument the model wrote. As of B10, `ToolContext` holds the run and call ids, the abort signal, the nesting depth, a clock and `update()`, but nothing of the caller's, so a tool on our SDK can only close over the user. With the field, the caller passes the value when it starts a run, the type flows from the run to every tool's `execute`, and the SDK never puts the value in a request, an event or a saved `Context`. The agent guide asks for exactly this, "a trusted run context that the model cannot write" ([agent guide, R2 and §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next)), and Chapter 3 of the book teaches it as the rule that identity comes from the signed-in session. The owner accepted this todo on 2026-11-19 ("yes, i accept these"), answering the second open question in [T12's Outcome](../done/T12-chapter-tools.md#outcome).

## Context

- [`packages/sdk/src/tools/types.ts`](../../../packages/sdk/src/tools/types.ts): `ToolContext`, `ToolDefinition` and `execute(input, ctx)`; [`packages/sdk/src/loop.ts`](../../../packages/sdk/src/loop.ts) builds the context from `state.setup`, and [`packages/sdk/src/run.ts`](../../../packages/sdk/src/run.ts) holds `RunOptions`, `continueRun()` and `nestedRunDepth()`.
- [B10's Outcome](../done/B10-tool-runtime.md#outcome): the tool pipeline and why `ToolDefinition` holds only the fields its todos use.
- [Agent guide §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next) and requirement R2 in its introduction: tools that read customer data take no identity argument and read the requester from the trusted run context.
- Chapter 3's identity section (`apps/manual/src/content/chapters/tools.md`, "Identity comes from the signed-in session, never from the model"): the table of what each SDK hands a tool beside its arguments, and the rule that a server builds a tool, or the object it closes over, per request from that request's authenticated session.
- [Agent plan §3.2](../../plans/build-agent.md#32-trusted-run-context-helpdesk-and-tool-contracts) and [harness plan §3.2](../../plans/build-harness.md#32-session-log-api): the agent's `TrustedContext` and the harness's per-turn `hostContext`, which today reach `execute` only through a wrapper the registry builds for each turn.
- [T52](../ready/T52-chapter-tools-on-our-sdk.md): Chapter 3's tabs on our SDK, whose identity tab should read the user from this field.

## Scope

**In scope**

- An app-data field on `ToolContext`, typed by a generic that `RunOptions` and `ToolDefinition` share, so `defineTool()` can declare the type it expects and a mismatch fails to compile
- A matching option on `run()` and `continueRun()`: the caller passes the value on every call, because a `Context` is plain JSON that a caller stores and the app data must never be in it
- A nested run that a tool starts gets no app data unless the tool passes it, and the README shows how
- The value never reaches a model request, a run event, a telemetry span or a saved `Context`, and tests prove each one
- TSDoc on the field and the option, and a README section with a tested example that reads the signed-in customer from `ctx.app`
- A changeset, a `minor` bump under 0.x, because the new generic parameter changes exported types

**Out of scope** (and which todo covers it)

- Chapter 3's tab on our SDK: [T52](../ready/T52-chapter-tools-on-our-sdk.md)
- Mapping the harness's per-turn `hostContext` onto this field instead of the registry's per-turn wrapper: the harness todos that build the runner and the registry, N6 and N11, once this todo is done
- Authorization itself: the field carries the caller's facts, and the tool or the downstream system still checks them

## Tasks

- [x] Choose the field's name with the type in place. `app` is the working name; record the choice and the rejected names, such as `context` (which `Context` already means) and `state`, in the pull request.
- [x] Add the generic to `ToolContext`, `ToolDefinition`, `defineTool()` and `RunOptions`, defaulting to `unknown`, so existing code compiles unchanged.
- [x] Thread the value from `run()` and `continueRun()` through the loop's setup to the context each `execute` receives, without copying it into `Context`, events or observers.
- [x] Write the tests and the type tests below.
- [x] Document the field: TSDoc, and a README section that builds the value per request from the authenticated session and never from a module-level variable, the rule Chapter 3 states.
- [x] Move our own capstone off the hole Chapter 3 opens with. `packages/sdk/examples/triage-agent.ts` offers `lookup_customer` with an `email` the model fills in ("Look up a customer's plan and open tickets by email."); make it read the customer from the field instead, and run the conformance suite and B19's triage suite. If the shared suite needs the email argument, keep it there and say why in the pull request.

## Acceptance criteria

- [x] A tool declared with `defineTool<..., { customerId: string }>` reads `ctx.app.customerId`, and a run that passes no app data or the wrong type fails to compile (type tests with `@ts-expect-error`)
- [x] A test scripts the model to send `{ customerId: "cust-999" }` to a lookup whose schema declares no identity field, and the lookup answers for the customer the caller set; the recorded requests hold no app data
- [x] A test serialises the run's events and its saved `Context` and finds no app data in either; `continueRun()` without the option gives tools `undefined`
- [x] A test shows that two overlapping runs with different app data each see their own, so no state is shared between runs
- [x] A tool that starts a nested run passes its app data on explicitly, and a test checks that the child sees nothing otherwise
- [x] A changeset is in the pull request, and CI's `changesets` job passes
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

New unit and type tests in `packages/sdk/test/`, such as `tool-app-data.test.ts`; the README example under the package's docs-example check; the conformance suite and the triage capstone.

## Docs to update

- `packages/sdk/README.md`: a section on app data for tools, in the tools part
- [SDK plan §4.6](../../plans/build-sdk.md#46-trusted-app-data-for-tools-from-the-books-chapter-3-added-2026-11-19): this todo's row
- [T52](../ready/T52-chapter-tools-on-our-sdk.md): once this lands, its identity tab reads the field instead of closing over the customer
- The compiled API docs and `llms.txt` that B20's checks regenerate

## Risks and open questions

- A per-run value invites the mistake Chapter 3 warns about: a server that builds it once at module level, or keeps it in one shared variable, hands one user's identity to every request. The README must show the value built per request, and the overlapping-runs test pins that the SDK itself shares nothing.
- A second generic on `ToolDefinition` makes a list of mixed tools harder to type. If the type tests show that, the pull request may type the field per run instead and let `execute` narrow it; the owner reviews that trade-off.
- The harness already plans a per-turn `hostContext` that a wrapper binds (agent plan AH2). The two must not diverge: N6 and N11 should pass `hostContext` through this field once it exists, and this todo records the follow-up in the harness plan.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

A caller can now pass trusted facts, such as the signed-in customer, to a run, and every tool reads them as `ctx.app`. The model never sees them. The capstone's `lookup_customer` no longer takes an email: it looks up the customer the caller set.

**Public API.**
- `RunOptions<S, A>` gains `app?: A`, and `ContinueOptions<S, A>` inherits it. `run()` and `continueRun()` take a second type parameter `T`, the type of the `tools` list, which defaults to the open list. Because it is not the app type, a call that named both type arguments, such as `run<Triage, Session>()`, no longer compiles.
- `ToolContext<A>` gains `app: A`, and `ToolDefinition<I, S, A>` and `defineTool<I, S, A>()` take `A` as a third parameter, so `defineTool<Input, unknown, Session>()` declares the type a tool reads. Existing code compiles unchanged, except a hand-built `ToolContext`, which now needs `app`; the changeset says so.
- `AppFor<T>` is exported. `run()` and `continueRun()` take it over the type of the `tools` list the call infers: it asks for an `app` that has every app type the tools declare, and nothing when none declares one. A typed tool beside an untyped one still needs `app`, and `null` or another type fails to compile. Type tests with `@ts-expect-error` pin each. (The first version took `AppRequired<NoInfer<A>>`; its review found that a typed tool beside an untyped one, and `app: null`, compiled. It is replaced.)

**Behavior.**
- The value goes from `setupOf()` through the loop's setup and the pipeline context to each `execute`. It is never copied into a request, an event, a span or a saved `Context`; tests check each.
- `continueRun()` without `app` gives tools `undefined`, and a call approved after a pause runs with the `app` the resuming process passes.
- `nestedRunDepth(ctx)` does not carry it, so a nested run sees none unless the tool passes `app: ctx.app`.
- Two overlapping runs each see their own value.

**Decisions.**
- **Field name: `app`.** Rejected: `context`, because `Context` already means the conversation, and `state`, because it suggests the run changes it.
- **One `app` that has every declared type.** A typed tool beside an untyped one still needs `app`. Two tools that declare different object types need an `app` with both, and types that cannot both hold, such as `string` and `number`, leave no `app` that compiles. A tool may declare a union, and the whole union is its type. Type tests pin each. The risk note's fallback, typing the field per run only, was not needed.
- **The compile-time check reads the `tools` list.** With explicit type arguments, such as `run<Triage>()`, the list's type is not inferred and `app` is optional. The README and the TSDoc say so, and a type test pins it. The suite's `Loop` type is explicit, so the shared suite runs without the check.
- **The capstone keeps no email argument.** The scripted `LOOKUP` call now sends `{}`, and a new suite case has the model send `victim@example.com` and checks the lookup used `user@example.com`. The reference loop passes `app` to its tools too, and its cap of 400 lines still holds.
- **The harness follow-up** is recorded in the [harness plan](../../plans/build-harness.md): N6 and N11 pass `hostContext` as `RunOptions.app` instead of binding it in a wrapper.

**Left out.** The book's T52 identity tab, which reads this field once its todo runs, and authorization, which stays with the tool.

**Follow-up (2026-11-22): the pause binds the app.** The owner chose app binding, then a keyed MAC. A pause now signs `appHash`, the signer's MAC of the tagged canonical JSON of `app`, verified under the request's own key, and `continueRun()` checks it right after the signature and before every other check. An `app` that is missing or different, and any request that fails its signature in a run that has `app`, ends the run with an `error` result of kind `app_mismatch` or `request_unverified`, with `run_end` emitted and no new request signed. A request signed without app data binds none, so a pause from before the field still resumes. The README and the pull request describe it.
