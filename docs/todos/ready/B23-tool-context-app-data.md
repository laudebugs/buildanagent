# B23: Give `ToolContext` typed app data that the caller sets when a run starts and the model never sees

| Field | Value |
| --- | --- |
| ID | `B23` |
| Status | `ready` |
| Plan | [Build SDK §4.6](../../plans/build-sdk.md#46-trusted-app-data-for-tools-from-the-books-chapter-3-added-2026-11-19) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B10](../done/B10-tool-runtime.md), [B11](../done/B11-loop-core.md) |
| Size | M |

## Goal

Add an app-data field to our SDK's `ToolContext`, such as `ctx.app`, so a tool can read the signed-in user from data the caller set, never from an argument the model wrote. The caller passes the value when it starts a run, the type flows from the run to every tool's `execute`, and the SDK never puts it in a request, an event or a saved `Context`. The agent guide asks for exactly this, "a trusted run context that the model cannot write" ([agent guide, R2 and §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next)), and Chapter 3 of the book teaches it as the rule that identity comes from the signed-in session. As of B10, `ToolContext` holds the run and call ids, the abort signal, the nesting depth, a clock and `update()`, but nothing of the caller's, so a tool on our SDK can only close over the user. The owner accepted this todo on 2026-11-19 ("yes, i accept these"), answering the second open question in [T12's Outcome](../done/T12-chapter-tools.md#outcome).

## Context

- [`packages/sdk/src/tools/types.ts`](../../../packages/sdk/src/tools/types.ts): `ToolContext`, `ToolDefinition` and `execute(input, ctx)`; [`packages/sdk/src/loop.ts`](../../../packages/sdk/src/loop.ts) builds the context from `state.setup`, and [`packages/sdk/src/run.ts`](../../../packages/sdk/src/run.ts) holds `RunOptions`, `continueRun()` and `nestedRunDepth()`.
- [B10's Outcome](../done/B10-tool-runtime.md#outcome): the tool pipeline and why `ToolDefinition` holds only the fields its todos use.
- [Agent guide §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next) and requirement R2 in its introduction: tools that read customer data take no identity argument and read the requester from the trusted run context.
- Chapter 3's identity section (`apps/manual/src/content/chapters/tools.md`, "Identity comes from the signed-in session, never from the model"): the table of what each SDK hands a tool beside its arguments, and the rule that a server builds a tool, or the object it closes over, per request from that request's authenticated session.
- [Agent plan §3.2](../../plans/build-agent.md#32-trusted-run-context-helpdesk-and-tool-contracts) and [harness plan §3.2](../../plans/build-harness.md#32-session-log-api): the agent's `TrustedContext` and the harness's per-turn `hostContext`, which today reach `execute` only through a wrapper the registry builds for each turn.
- [T52](T52-chapter-tools-on-our-sdk.md): Chapter 3's tabs on our SDK, whose identity tab should read the user from this field.

## Scope

**In scope**

- An app-data field on `ToolContext`, typed by a generic that `RunOptions` and `ToolDefinition` share, so `defineTool()` can declare the type it expects and a mismatch fails to compile
- A matching option on `run()` and `continueRun()`: the caller passes the value on every call, because a `Context` is plain JSON that a caller stores and the app data must never be in it
- A nested run that a tool starts gets no app data unless the tool passes it, and the README shows how
- The value never reaches a model request, a run event, a telemetry span or a saved `Context`, and tests prove each one
- TSDoc on the field and the option, and a README section with a tested example that reads the signed-in customer from `ctx.app`
- A changeset, a `minor` bump under 0.x, because the new generic parameter changes exported types

**Out of scope** (and which todo covers it)

- Chapter 3's tab on our SDK: [T52](T52-chapter-tools-on-our-sdk.md)
- Mapping the harness's per-turn `hostContext` onto this field instead of the registry's per-turn wrapper: the harness todos that build the runner and the registry, N6 and N11, once this todo is done
- Authorization itself: the field carries the caller's facts, and the tool or the downstream system still checks them

## Tasks

- [ ] Choose the field's name with the type in place. `app` is the working name; record the choice and the rejected names, such as `context` (which `Context` already means) and `state`, in the pull request.
- [ ] Add the generic to `ToolContext`, `ToolDefinition`, `defineTool()` and `RunOptions`, defaulting to `unknown`, so existing code compiles unchanged.
- [ ] Thread the value from `run()` and `continueRun()` through the loop's setup to the context each `execute` receives, without copying it into `Context`, events or observers.
- [ ] Write the tests and the type tests below.
- [ ] Document the field: TSDoc, and a README section that builds the value per request from the authenticated session and never from a module-level variable, the rule Chapter 3 states.
- [ ] Move our own capstone off the hole Chapter 3 opens with. `packages/sdk/examples/triage-agent.ts` offers `lookup_customer` with an `email` the model fills in ("Look up a customer's plan and open tickets by email."); make it read the customer from the field instead, and run the conformance suite and B19's triage suite. If the shared suite needs the email argument, keep it there and say why in the pull request.

## Acceptance criteria

- [ ] A tool declared with `defineTool<..., { customerId: string }>` reads `ctx.app.customerId`, and a run that passes no app data or the wrong type fails to compile (type tests with `@ts-expect-error`)
- [ ] A test scripts the model to send `{ customerId: "cust-999" }` to a lookup whose schema declares no identity field, and the lookup answers for the customer the caller set; the recorded requests hold no app data
- [ ] A test serialises the run's events and its saved `Context` and finds no app data in either; `continueRun()` without the option gives tools `undefined`
- [ ] A test shows that two overlapping runs with different app data each see their own, so no state is shared between runs
- [ ] A tool that starts a nested run passes its app data on explicitly, and a test checks that the child sees nothing otherwise
- [ ] A changeset is in the pull request, and CI's `changesets` job passes
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

New unit and type tests in `packages/sdk/test/`, such as `tool-app-data.test.ts`; the README example under the package's docs-example check; the conformance suite and the triage capstone.

## Docs to update

- `packages/sdk/README.md`: a section on app data for tools, in the tools part
- [SDK plan §4.6](../../plans/build-sdk.md#46-trusted-app-data-for-tools-from-the-books-chapter-3-added-2026-11-19): this todo's row
- [T52](T52-chapter-tools-on-our-sdk.md): once this lands, its identity tab reads the field instead of closing over the customer
- The compiled API docs and `llms.txt` that B20's checks regenerate

## Risks and open questions

- A per-run value invites the mistake Chapter 3 warns about: a server that builds it once at module level, or keeps it in one shared variable, hands one user's identity to every request. The README must show the value built per request, and the overlapping-runs test pins that the SDK itself shares nothing.
- A second generic on `ToolDefinition` makes a list of mixed tools harder to type. If the type tests show that, the pull request may type the field per run instead and let `execute` narrow it; the owner reviews that trade-off.
- The harness already plans a per-turn `hostContext` that a wrapper binds (agent plan AH2). The two must not diverge: N6 and N11 should pass `hostContext` through this field once it exists, and this todo records the follow-up in the harness plan.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
