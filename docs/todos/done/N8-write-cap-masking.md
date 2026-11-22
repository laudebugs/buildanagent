# N8: Layers 1 and 2: write cap with spill, and stepped masking

| Field | Value |
| --- | --- |
| ID | `N8` |
| Status | `done` |
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

- [x] Never alter stored entries when masking; operate on the request view only.
- [x] Test that the masked view's prefix is identical across the 7 steps between cutoff moves.
- [x] Apply [HD3](../../plans/build-harness.md#hd3-layers-1-2-3-and-5-on-by-default-and-a-budget-capped-at-200k-tokens-provisional)'s append-only rule for signed thinking (plan review 2, 2026-11-19): when the mask cutoff moves, the request view drops every thinking block after the first masked message, so no block that follows an edit is sent with its old signature.

## Acceptance criteria

- [x] A 200 KiB tool result reaches the model as at most 64 KiB plus a spill path, and the spill file holds the full text
- [x] No stored entry changes when masking applies
- [x] The request prefix stays byte-identical between cutoff moves
- [x] When the cutoff moves on an Anthropic model with preserved thinking, the replayed request carries no thinking block after the first masked message (a scripted test inspects the request)
- [x] Switching either layer off in options removes its effect and leaves the run passing
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/context/write-cap.test.ts`, `mask.test.ts`.

## Docs to update

`packages/harness/README.md`: the five layers and their defaults. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

Character-based token estimates are coarse; use the previous call's `usage` when need 2 provides it.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`createContextPolicy()` is in `@buildanagent/harness/context`, with the write cap (`afterToolCall`) and stepped masking (`transformContext`), and `createHarness({ context })` applies it to every turn. 14 tests in `packages/harness/test/context/` and one in the dispatcher test cover the acceptance criteria.

- **The cap counts the log's bytes.** HD3's 64 KiB cap collided with the stores' 64 KiB entry bound: a result capped at exactly 64 KiB, plus its notice and the entry's fields, was refused as `entry_too_large`, and so was a result of newlines whose escaped form is twice its length. The cap now counts the JSON-escaped size and reserves 1 KiB for the entry's fields, so the model reads a little under 64 KiB of plain text and a capped entry always fits.
- **Spill store.** `SpillStore` is an interface; `fileSpillStore()` has its own Node-only entry (`@buildanagent/harness/context/file`), and `memorySpillStore()` serves tests. Paths are named by the call id.
- **Masking and signed thinking.** The cutoff is `floor((messages − 8) / 8) × 8`. The view drops every signed reasoning block after the first masked result, so a block that follows an edit is never sent with its old signature.
- **`context_fill`.** The policy reports `{ tokens, budget, window }` through `TurnOptions.onContextFill`; the dispatcher forwards it as a `context_fill` event.
- **Not done, left to later todos:** the context layers are opt-in (`createHarness({ context })`), because HD3's default-on needs the spill store the host chooses; N9 and N10 add the summary and mid-turn layers; N21 adds the `read` tool that re-reads a spill. An image block in a result is kept whole and still counts toward the entry bound.
