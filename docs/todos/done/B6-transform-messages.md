# B6: The cross-provider `transformMessages` pass

| Field | Value |
| --- | --- |
| ID | `B6` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 2](../../plans/build-sdk.md#42-stage-2-adds-the-two-wire-adapters-and-the-replay-pass-between-them) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B3](../done/B3-scripted-model.md) |
| Size | M |

## Goal

Make a transcript recorded on one provider replay safely on another, through one explicit, tested pass run before every request.

## Context

- [agent-SDK guide §2](../../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns): cross-provider replay needs one explicit, tested transform pass
- [gateway API §3.2](../../plans/build-sdk.md#32-gateway-api)

## Scope

**In scope**

- Drop reasoning from a different provider and strip foreign signatures. For a same-provider Anthropic target, pass thinking blocks through unchanged: Anthropic drops, without billing, the ones it cannot read ([Anthropic, thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), as of November 2026). When the pass must drop thinking blocks, it drops only a leading or trailing run of them, never a block from the middle (plan review 2, 2026-11-19)
- Remap tool-call ids to the target's charset
- Replace images for text-only models
- Skip errored turns
- Give orphaned tool calls a synthetic error result

**Out of scope** (and which todo covers it)

- Wire encoding (B8, B9)

## Tasks

- [x] Implement `transformMessages(messages, target, caps)` as a pure function that never mutates its input.
- [x] Write one test per rule with a hand-built transcript.
- [x] Add a property-style test: for any transcript, the output passes a structural validator (every tool call has a result, ids are unique and match the target charset).

## Acceptance criteria

- [x] Each of the five rules has a passing test
- [x] A transcript replayed to another Anthropic model keeps every thinking block and signature unchanged; a replay to an OpenAI-compatible target still strips them
- [x] A same-provider replay keeps a thinking block whose text is empty, byte for byte (HD3 rule 1)
- [x] When the pass drops thinking blocks, the kept blocks form one unbroken run that starts at the oldest or ends at the newest
- [x] The input array is deep-equal before and after the call
- [x] A transcript with a tool call and no result gains a synthetic `isError` result
- [x] Running the pass twice gives the same output as running it once
- [x] A trailing assistant message with `stopReason: "error"` is dropped, so a resumed call re-issues it (harness need 4)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/transform-messages.test.ts`.

## Docs to update

`packages/gateway/README.md`: what the pass changes and why. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The id charset per provider comes from B7's table; until then, use the canonical rule.

## Outcome

`packages/gateway/src/transform-messages.ts` exports `transformMessages()`; `packages/gateway/test/transform-messages.test.ts` holds one test per rule and a seeded property-style run over 500 generated transcripts.

Judgement calls:

- When thinking must be dropped for an Anthropic target, the pass keeps the newest unbroken run: it drops every reasoning block at or before the newest dropped one. A later drop then only ever removes older blocks. As the transcript grows, older thinking leaves the request only as a leading run, which Anthropic allows: "outside tool use, omit prior turns' thinking, but not a block between two that you keep" ([Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking), as of November 2026). Other targets check no such order, so they lose only the blocks judged unsendable. The medium review round chose this rule.
- When `caps.reasoning` is `false`, every reasoning block is dropped; that is not a drop under the newest-run rule, since none is kept.
- A failed turn is one that stopped with `"error"` or `"aborted"`; Pi skips both. Failed turns are skipped before the reasoning rule runs, so a failed turn's thinking does not count as a drop. The results that answer a failed turn's calls are dropped with it, but a result goes to a failed turn's call only when no completed turn's call with its id is waiting. The medium review round set this order, reversing the first round's rule that the newest turn always won.
- Same provider means the same `api` and `provider`. An Anthropic target keeps any Anthropic signature and drops every block it cannot send signed, recorded unsigned or stripped, so the newest-run rule covers those drops too. Any other target keeps a signature only from the same model id, and keeps the reasoning text unsigned otherwise. An unsigned block with empty text is dropped for every target.
- Tool-call ids use B7's canonical rule `^[A-Za-z0-9_-]{1,64}$` (`isCanonicalName` in `names.ts`) for every target; repeats get a `_2`, `_3` suffix.
- Beyond the five rules, the pass moves each result next to its call, drops results that answer no call, strips reasoning and tool calls from user messages (without counting them for the newest-run rule), drops empty text blocks and any message left with no content, and merges adjacent user messages and adjacent assistant messages, because both providers reject those shapes.
- Results are paired across the whole transcript: a result recorded after a later turn still moves next to its call and replaces the synthetic error. Among the waiting calls with its id from completed turns, a result goes to the newest one made before it.
- Merging assistant messages keeps the later message's stop reason, usage and cost. When the earlier message has text or tool calls, the later message's reasoning is dropped, so reasoning never follows a block it did not follow before; for an Anthropic target that counts as a drop under the newest-run rule.
- If the input has a user message, the output starts with one; a `(continued)` text block stands in when the pass empties the opening user message. An input left with nothing to send returns `[]`.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
