# A5: The reply, refund and credit tools, with outbound checks and eligibility in code

| Field | Value |
| --- | --- |
| ID | `A5` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 1](../../plans/build-agent.md#41-stage-1-the-trusted-context-and-the-tools) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A4](A4-read-internal-tools.md) |
| Size | M |

## Goal

Write the three code-initiated tools (T3 reply, T4 refund and credit) with every rule that must hold in code: a fixed recipient, a link allowlist, image stripping, a foreign-identifier scan, the AI label, and refund eligibility.

## Context

- [AD2](../../plans/build-agent.md#ad2-the-tier-table-is-code-t5-is-never-registered-and-t4-stays-denied-until-the-owner-sets-the-caps-owner-to-confirm) and [AD8](../../plans/build-agent.md#ad8-code-appends-the-ai-label-spans-hash-identifiers-and-later-stages-need-a-retention-period-owner-to-confirm-with-hd11): T4 denied until caps; the AI label
- [build-agent.md §3.4](../../plans/build-agent.md#34-contexts-gates-and-the-workflow): `checkReply()`
- [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg): outbound channels and egress per argument

## Scope

**In scope**

- `support_send_reply` (`initiator: "code"`): `checkReply()` then `sendReply`; the AI label appended after approval
- `billing_issue_refund` and `billing_issue_credit` (`initiator: "code"`): the order must be in `ctx.orderIds`, its state must allow a refund, no duplicate refund, the amount at most the order total
- Flags: `foreign_identifier`, `link_not_allowed`, `image_stripped`, `label_appended`

**Out of scope** (and which todo covers it)

- The gate decisions on these tools (A6, A8)
- Template-only replies (AD11, deferred)

## Tasks

- [ ] Scan drafts for emails, order ids and account ids that are not the requester's.
- [ ] Strip Markdown and HTML images; drop links outside the allowlist and flag them.

## Acceptance criteria

- [ ] A draft naming another requester's email is flagged `foreign_identifier`
- [ ] A refund for an order outside `ctx.orderIds` returns `isError` and writes nothing
- [ ] Every sent reply in the fake ends with the AI label
- [ ] Model-facing tool lists never contain these three tools
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/tools/send-reply.test.ts`, `refund.test.ts`, `test/gates/outbound.test.ts`.

## Docs to update

The package README's "Outbound checks" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

The identifier patterns are a heuristic; A21's corpus tests them.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
