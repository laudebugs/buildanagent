# F5: `@agent-speak/agent-safety` with adapters for `agents` 0.33.0 and `ai` 7.0.162

| Field | Value |
| --- | --- |
| ID | `F5` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [E7](E7-safety-portability.md) |
| Size | M |

## Goal

Build the safety package every generated agent imports: signed approvals, idempotency keys and typed outcomes (PF5).

## Context

- [PF5](../../plans/build-agent-platform.md#pf5-one-safety-package-inside-every-generated-agent-proposed).
- [Server rollback report](../../research/reversible-actions/server-rollback.md#after-a-rollback-tell-the-model-one-of-four-outcomes-in-the-result-body): the four outcome kinds.
- [Cloudflare skill](../../../.agents/skills/cloudflare-agents/SKILL.md) and [Vercel AI SDK skill](../../../.agents/skills/vercel-ai-sdk/SKILL.md): each SDK's approval gate.

## Scope

**In scope**

- Signing pauses with the SDK's `hmacSigner()`
- Idempotency keys persisted before each write
- The `not_applied`, `compensated`, `partial` and `unknown` outcomes
- Adapters for `needsApproval` and `toolApproval`

**Out of scope**

- Compensation logic for specific tools (per generated agent)

## Tasks

- [ ] Create `packages/agent-safety` with exact pins of both SDKs as peer dependencies.
- [ ] Wrap each SDK's approval gate so every pause is signed and every resume verifies.
- [ ] Add an idempotency-key store interface and a Durable Object implementation.
- [ ] Add typed outcome helpers that set the provider error flag and state the outcome in text.

## Acceptance criteria

- [ ] An unsigned or tampered resume is refused on both SDKs.
- [ ] A replayed write with the same key does not run twice.

## Tests

Offline tests on each SDK's mock model.

## Docs to update

The package README.

## Risks and open questions

Both SDKs move; the package pins exact versions (ADR 0038).

## Revision (2026-11-18, SDK gaps)

The [close-sdk-gaps plan](../../plans/close-sdk-gaps.md) moves this todo's scope into Round E, so the package can ship before our SDK. E1–E7 now build the outcomes, effect identity, signed approvals, plan approvals, cost guard, BYOK guard and stores. This todo narrows to releasing `@agent-speak/agent-safety` for the generation templates (F6): a versioned README, the exact SDK pins and a changelog. **Depends on** changes from B15 to [E7](E7-safety-portability.md), which closes Round E after E1–E6 and supplies the Durable Object store this todo's tasks name. The acceptance criteria above stay and are met by those todos' tests.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
