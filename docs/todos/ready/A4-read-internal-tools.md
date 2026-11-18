# A4: The seven T0–T2 tools, with contract tests

| Field | Value |
| --- | --- |
| ID | `A4` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 1](../../plans/build-agent.md#41-stage-1-the-trusted-context-and-the-tools) |
| Round / milestone | Round A (build agent), M7 |
| Depends on | [A3](A3-tool-contract-lint.md) |
| Size | M |

## Goal

Write the planner's seven tools (four T0 reads, two T1 internal writes, one T2 escalation) over the `Helpdesk` interface, each with a full contract and offline contract tests, so the planner has a safe, identity-free tool set.

## Context

- [agent guide §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next): few workflow-shaped tools, high-signal outputs, errors
- [agent guide §5](../../guides/agent.md#5-safety-is-a-policy-table-and-a-context-split-tier-every-tool-by-worst-case-effect-bind-identity-and-cut-the-outbound-leg): the tier table and each tool's identity source
- [build-agent.md §3.2](../../plans/build-agent.md#32-trusted-context-helpdesk-and-tool-contracts): `TRIAGE_TOOLS`

## Scope

**In scope**

- T0: `support_get_ticket` (metadata only: subject, queue, attachment names; no body), `support_get_requester`, `support_list_requester_orders`, `help_search_articles` (our domains only)
- T1: `support_set_triage`, `support_add_internal_note` (tagged `derivedFromUntrusted`)
- T2: `support_escalate`
- No tool takes an identity argument; each reads the requester from the trusted context
- Output budgets and `outputTrust` per tool

**Out of scope** (and which todo covers it)

- Reply, refund and credit tools (A5)
- Tier gates (A6)

## Tasks

- [ ] Write the no-match error from the guide: "No order 4417 belongs to this requester. Set `needs_human` or ask the requester for the order number; do not guess an order."
- [ ] Give each tool one to five input examples where the schema leaves usage unclear.

## Acceptance criteria

- [ ] `lintTools(TRIAGE_TOOLS)` returns no issue
- [ ] Each tool's contract test covers schema rejection with a path-level message, its `isError` text and its output budget
- [ ] A scripted call with a smuggled `customerId` field reaches `execute` without it
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/tools/<tool>.test.ts`, one file per tool.

## Docs to update

The package README's tool table. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

Real helpdesks may lack an article search; A24 maps or stubs it.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
