# N8: Layers 1 and 2: write cap with spill, and stepped masking

| Field | Value |
| --- | --- |
| ID | `N8` |
| Status | `ongoing` |
| Plan | [Build harness §4, Stage 2](../../plans/build-harness.md#42-stage-2-adds-the-five-context-layers-cheapest-first) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N6](../done/N6-session-runner.md) |
| Size | M |

## Goal

Build the two cheap context layers: cap every tool result at write time and spill the full text to a re-readable file, and mask older tool results in the request view in steps that keep the cached prefix stable.

## Context

- [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional): the decision and its evidence
- [harness guide §3](../../guides/agent-harness.md#3-context-policy-should-run-five-removable-layers-cheapest-first-and-keep-every-compaction-visible-and-reversible): layers 1 and 2, cache rationing
- [build-harness.md §3.6](../../plans/build-harness.md#36-needs-from-the-sdk-plan): needs 1, 2 and 5

## Scope

**In scope**

- `createContextPolicy()` with `write_cap` in `afterToolCall` and `mask` in `transformContext`
- Spill files under the session directory, named by `callId`, referenced from `tool_result.spill`
- Masking to the first 500 characters plus a pointer line, with a cutoff that moves every 8 messages
- `ContextPolicy.fill()` and a `context_fill` harness event

**Out of scope** (and which todo covers it)

- Summary, mid-turn and overflow layers (N9, N10)
- The `read` tool that re-reads spills (N21)

## Tasks

- [ ] Never alter stored entries when masking; operate on the request view only.
- [ ] Test that the masked view's prefix is identical across the 7 steps between cutoff moves.
- [ ] Apply [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional)'s append-only rule for signed thinking (plan review 2, 2026-11-19): when the mask cutoff moves, the request view drops every thinking block after the first masked message, so no block that follows an edit is sent with its old signature.

## Acceptance criteria

- [ ] A 200 KiB tool result reaches the model as at most 64 KiB plus a spill path, and the spill file holds the full text
- [ ] No stored entry changes when masking applies
- [ ] The request prefix stays byte-identical between cutoff moves
- [ ] When the cutoff moves on an Anthropic model with preserved thinking, the replayed request carries no thinking block after the first masked message (a scripted test inspects the request)
- [ ] Switching either layer off in options removes its effect and leaves the run passing
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/context/write-cap.test.ts`, `mask.test.ts`.

## Docs to update

`packages/harness/README.md`: the five layers and their defaults. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Character-based token estimates are coarse; use the previous call's `usage` when need 2 provides it.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
