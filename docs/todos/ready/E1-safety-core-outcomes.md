# E1: Safety core: the five outcomes and how the model reads them

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E1` |
| Status | `ready` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [B1](../done/B1-sdk-workspace-scaffold.md) |
| Size | M |

## Goal

Create `packages/agent-safety`, its export boundary and its first exports: a typed write outcome that the harness can act on and the model can read, and the canonical input hash that E2, E3, B10 and B14 build on. Today a failed write reaches the model as a bare error at best, so "the email may have gone out" looks the same as "nothing happened" (gap 1).

## Context

- [Server rollback report, the four outcomes](../../research/reversible-actions/server-rollback.md#after-a-rollback-tell-the-model-one-of-four-outcomes-in-the-result-body): the table of meanings and retry rules, the two-channel result, and the proposed JSON shape.
- [Rewind report, the linked entry](../../research/reversible-actions/rewind-vs-rollback.md#a-rollback-is-a-new-linked-entry-and-the-model-must-read-it): adds `applied`, the `WriteReceipt`, the prior value and `undoUntil`.
- [Sagas report, five outcomes](../../research/reversible-actions/sagas.md#the-agent-needs-five-outcomes-and-only-masstransit-tells-compensated-from-compensation-failed): the `SagaOutcome` union that E4b maps onto these kinds.
- [SG3](../../plans/close-sdk-gaps.md#sg3-a-write-reports-one-of-five-outcomes-and-unknown-is-never-retried-with-a-fresh-key-accepted): the decision this todo implements.
- [Vercel AI SDK skill](../../../.agents/skills/vercel-ai-sdk/SKILL.md) and [Cloudflare reference §9](../../reference/cloudflare-agents/guide.md#9-tool-approval-reuses-the-ai-sdks-needsapproval-and-the-client-answers-over-the-chat-protocol): how a tool result reaches the model in each SDK.

## Scope

**In scope**

- The package scaffold, pinned to exact versions, ESM, extending `tsconfig.base.json`
- The export boundary: a root export `.` for the core, a `./ai` subpath for `ai` adapters and an `./agents` subpath for Cloudflare `agents` adapters
- The `WriteOutcome` union and its helpers
- `renderOutcome()`: the model-facing text plus the structured payload, and the provider error flag where one exists
- `canonicalInputHash()`: canonical JSON hashed with Web Crypto SHA-256, the hash D5 signs and E2 stores (moved here from E3 in plan review 2, 2026-11-19)
- `toAiToolResult()`, in `./ai`: turns a `WriteOutcome` into an `ai` 7.0.162 tool result through the tool's `toModelOutput`

**Out of scope** (and which todo covers it)

- Effect keys and the crash rule (E2)
- Compensation functions for specific tools (each agent)
- Our own SDK's `ToolResult` change (the revision to B10)
- The signers and the pending record (E3), and effect identity (E2), which join the root export later

## Design notes

```ts
type OutcomeKind = "applied" | "not_applied" | "compensated" | "partial" | "unknown";
type Retry = "same_key" | "new_operation_only" | "reconcile_first" | "never";

interface WriteOutcome {
  kind: OutcomeKind;
  operation: string;            // tool or business operation name, e.g. "send_email"
  effectKey?: string;           // set by E2
  applied: string[];            // effects that hold now
  reverted: string[];           // effects undone
  notReversible: string[];      // e.g. "email delivered 14:02"
  currentState?: string;        // one line the model can trust
  retry: Retry;                 // derived from kind unless the tool overrides it
  next: string;                 // what the model should do next
  avoid?: string;               // what the model must not do
  reason?: string;              // UPPER_SNAKE code, at most 63 characters
}
```

The default retry rule follows the server rollback table: `not_applied` → `same_key`, `compensated` → `new_operation_only`, `partial` → `never` (escalate), `unknown` → `reconcile_first`. `renderOutcome()` writes one sentence for the model, such as "The refund was not issued; tell the requester it did not go through and do not say it was issued", and returns the payload in the result body. It also sets the provider flag for every kind except `applied`. In `ai` 7.0.162 the flag comes from the tool's `toModelOutput` returning `{ type: "error-json", value }`, one of the `ToolResultOutput` variants in `@ai-sdk/provider-utils` 5.0.74; `toAiToolResult()` puts the sentence and the payload in that one `value`, and returns `{ type: "json" }` for `applied`. The sketch above shows the fields only: to make the type tests below compile, `WriteOutcome` is a union discriminated on `kind`, so each kind lists the `retry` values it allows. The structured payload must stay model-readable, because some SDKs hide text blocks when structured content is set ([server rollback report](../../research/reversible-actions/server-rollback.md#after-a-rollback-tell-the-model-one-of-four-outcomes-in-the-result-body)).

**The export boundary.** Our SDK imports this package, so its root export must not pull in `ai` or `agents`. The root export `.` holds the core: the outcomes and `canonicalInputHash()` from this todo, effect identity from E2, and the signers and pending record from E3. It imports only `@buildanagent/gateway` and Web APIs. The `./ai` subpath holds the `ai` adapters (`toAiToolResult()` here, `signedToolApproval` in E3), and the `./agents` subpath holds the Cloudflare `agents` adapters. `ai`, `@ai-sdk/provider-utils` and `agents` are optional peer dependencies that only those subpaths import. A boundary test, modelled on `packages/gateway/test/boundaries.test.ts`, fails if any file reachable from the root export imports a third-party SDK.

## Tasks

- [ ] Scaffold `packages/agent-safety` (package.json with `"license": "Apache-2.0 OR MIT"` and `private: true`, exact pins, `tsconfig.json`, `src/index.ts`, `src/ai/index.ts`, `src/agents/index.ts`), with `exports` for `.`, `./ai` and `./agents`, and `ai`, `@ai-sdk/provider-utils` and `agents` as optional peer dependencies.
- [ ] Add the boundary test: nothing reachable from `src/index.ts` imports `ai`, `@ai-sdk/*` or `agents`.
- [ ] Define `OutcomeKind`, `Retry` and `WriteOutcome`, with the default retry table.
- [ ] Write `canonicalInputHash()` with Web Crypto SHA-256 over canonical JSON.
- [ ] Write `renderOutcome()`, and the `ai` adapter `toAiToolResult()` in `./ai`, used as the tool's `toModelOutput`.
- [ ] Add type tests: a `WriteOutcome` without `next` fails to compile; `kind: "applied"` cannot set `retry: "reconcile_first"`.

## Acceptance criteria

- [ ] Each of the five kinds renders a sentence that names what happened and what not to do, checked by snapshot tests.
- [ ] An `ai` 7.0.162 tool that returns `toAiToolResult(outcome)` delivers both the sentence and the payload to `MockLanguageModelV4` in the next request as an `error-json` tool result for every kind except `applied`, checked by inspecting the recorded prompt.
- [ ] A `reason` longer than 63 characters or not in upper snake case is rejected at construction.
- [ ] `canonicalInputHash()` gives the same hash for objects whose keys differ only in order, and a different hash when any value changes.
- [ ] The boundary test passes, and `import "@buildanagent/agent-safety"` succeeds in a package that has none of the optional peers installed.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

Unit and snapshot tests in `packages/agent-safety/test/outcomes.test.ts` and `test/hash.test.ts`; the boundary test in `test/boundaries.test.ts`; one `ai` mock-model test in `test/ai-adapter.test.ts`.

## Docs to update

The package README (the outcome table), and the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md) todo table.

## Risks and open questions

- No published study measures how models respond to outcome fields, so the wording is a first guess; record it as a fixture so later evals can change it.
- The owner accepted SG3's five kinds on 2026-11-18; a later change to them would start here.
- The export boundary interprets ADR 0043's "depends only on `@buildanagent/gateway`" as applying to the root export, with the third-party adapters in subpaths; owner to confirm.

History: plan review 2 (2026-11-19) moved `canonicalInputHash()` here from E3 and added the export boundary.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
