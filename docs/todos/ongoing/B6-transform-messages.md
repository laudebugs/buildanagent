# B6: The cross-provider `transformMessages` pass

| Field | Value |
| --- | --- |
| ID | `B6` |
| Status | `ongoing` |
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

- [ ] Implement `transformMessages(messages, target, caps)` as a pure function that never mutates its input.
- [ ] Write one test per rule with a hand-built transcript.
- [ ] Add a property-style test: for any transcript, the output passes a structural validator (every tool call has a result, ids are unique and match the target charset).

## Acceptance criteria

- [ ] Each of the five rules has a passing test
- [ ] A transcript replayed to another Anthropic model keeps every thinking block and signature unchanged; a replay to an OpenAI-compatible target still strips them
- [ ] A same-provider replay keeps a thinking block whose text is empty, byte for byte (HD3 rule 1)
- [ ] When the pass drops thinking blocks, the kept blocks form one unbroken run that starts at the oldest or ends at the newest
- [ ] The input array is deep-equal before and after the call
- [ ] A transcript with a tool call and no result gains a synthetic `isError` result
- [ ] Running the pass twice gives the same output as running it once
- [ ] A trailing assistant message with `stopReason: "error"` is dropped, so a resumed call re-issues it (harness need 4)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/gateway/test/transform-messages.test.ts`.

## Docs to update

`packages/gateway/README.md`: what the pass changes and why. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

The id charset per provider comes from B7's table; until then, use the canonical rule.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
