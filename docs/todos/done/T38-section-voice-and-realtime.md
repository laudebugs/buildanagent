# T38: Section: voice and realtime agents in Chapter T35

> **History:** the book plan held its todos on 2026-11-19 until the owner approved it, and the owner approved it the same day ("If green merge", then "Then continue work"), so this todo starts once its **Depends on** are done ([book plan §7](../../plans/build-book.md#7-round-t-can-start-the-owner-approved-the-plan-on-2026-11-19)).

| Field | Value |
| --- | --- |
| ID | `T38` |
| Status | `done` |
| Plan | [Book plan §4.3, BK19](../../plans/build-book.md#43-four-topics-need-research-before-they-are-written) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [U20](../done/U20-research-voice-and-realtime.md), [T35](../done/T35-chapter-agents-people-can-watch.md), [T46](../done/T46-example-realtime-session.md), [T47](../done/T47-example-voice-pipeline.md) |
| Size | S |

## Goal

Add one section to Chapter T35 ("Agents people can watch: UIs, browsers and taking over") from research todo [U20](../done/U20-research-voice-and-realtime.md)'s report. It is a section, not a chapter: voice and realtime change how a person interacts with a running agent, which is Chapter T35's subject.

U20's report settled the scope, and the owner approved its proposed changes on 2026-11-19 (owner decision 2026-11-19). The topic stays one section, opened by the phone-call analogy. It teaches four ways a voice agent differs from the text loop, and its listings come from T46's scripted OpenAI session and T47's Cloudflare pipeline ([U20 report, Teach](../../research/voice/voice-and-realtime.md#t38-should-teach-four-differences-from-the-text-loop-in-one-section-opened-by-the-phone-call-analogy)).

## Context

- [U20](../done/U20-research-voice-and-realtime.md)'s [report](../../research/voice/voice-and-realtime.md) and [fact-check](../../research/voice/fact-check-voice-and-realtime.md)
- [T46](../done/T46-example-realtime-session.md) and [T47](../done/T47-example-voice-pipeline.md): the two listings, both offline
- T46's example, `verify/openai-agents-sdk/examples/14-realtime-session.ts`, has regions `tools`, `session`, `history`, `tool-call`, `approve`, `interrupt` and `interrupted`, with notes `approval`, `scripted-transport`, `history`, `approve`, `interrupt` and `interrupted`. It has no transcript, because it sends no model request, so the section lists it without a replay. Three limits carry into the prose. First, truncation to the heard audio needs the real transport: the scripted transport's `interrupt()` only records the call, while the real WebSocket transport emits `audio_interrupted` itself and sends `conversation.item.truncate`. Second, the example checks the SDK's session, not a real model's choices. Third, check 3 held: the approval raises `tool_approval_requested` and runs only after `session.approve()` ([fact-check](../../plans/reviews/fact-check-openai-realtime-example.md), rows T46-6, T46-7, T46-11 and T46-17).
- Chapter T35's todo, [T35](../done/T35-chapter-agents-people-can-watch.md), and its fact-check file `apps/manual/fact-checks/agents-people-can-watch.md`
- [Book plan BK21 and BK22](../../plans/build-book.md#bk21-every-section-is-fact-checked-before-the-next-is-drafted-accepted)

## Scope

**In scope**

- One section in `apps/manual/src/content/chapters/agents-people-can-watch.md`
- Four differences from the text loop, in this order (owner decision 2026-11-19):
  1. **The loop is a session driven by events.** Name the three shapes (speech-to-speech, chained pipeline, and a speaking front model that delegates) and show that the tool loop survives inside each. The number to remember is the 208 ms gap people leave between turns.
  2. **Turn detection predicts the end of a turn.** Show the trade between a short silence threshold and a late reply, with OpenAI's 500 ms default and the robot study's drop from 2.7 s to 1.5 s, and name push-to-talk as the simple escape.
  3. **Barge-in stops the speech, settles the tools and keeps only the heard words.** Show truncation to `audio_end_ms`, the opposite defaults of Gemini and GPT-Live for tools in flight, and the yield-or-hold trade, with GPT-4o realtime's 0.23 s stop beside its 93% reply rate to background speech.
  4. **Tools must not silence the agent.** Show announcing, background calls and delegation to a text agent, and close on τ-Voice's 85% against 31–51% as the reason for U20's proposed rule to read back consequential arguments.
- A link to the vendor guides for transports and audio formats, which the section does not cover
- The listings from [T46](../done/T46-example-realtime-session.md) and [T47](../done/T47-example-voice-pipeline.md); truncation itself is explained in prose, because it needs the real transport
- Rows for the section in `apps/manual/fact-checks/agents-people-can-watch.md`

**Analogy** (BK22): voice interruption, as a phone call where either side can cut in. Where the analogy breaks: the agent must stop speaking at once, decide for each tool in flight whether it finishes or is undone, and forget the words the caller never heard. The owner approved this break note on 2026-11-19, replacing the earlier "the agent must cancel speech and tool calls already in flight when the person cuts in", because U20 found that cancelling every tool in flight is not the rule. Use the analogy only if it makes the concept clearer than plain explanation. No illustration unless the section needs one.

**Out of scope** (and which todo covers it)

- The research itself (the research todo)
- Rewriting the rest of the chapter

## Tasks

- [ ] Draft the section with `/anthropic-skills:writing`. If the analogy makes the concept clearer, open with it, then the mechanism and a "Where the analogy breaks" note, and register it in `analogies.json`; otherwise explain the concept plainly.
- [x] Give every model name, price and benchmark score its date and the version tested, as "the version tested in 2025" or "in 2026", never as a property of a vendor.
- [x] Fact-check every claim in the section against its primary source into `apps/manual/fact-checks/agents-people-can-watch.md` before any further edit, and commit the section together with its fact-check rows (BK21).
- [ ] Run `/anthropic-skills:writing-review` on the whole chapter with the voice check, fix every finding with `/anthropic-skills:writing`, and re-check every claim a fix touched.

## Acceptance criteria

- [x] The chapter still builds with every check passing, the analogy check included
- [x] `apps/manual/fact-checks/agents-people-can-watch.md` has the section's rows and the re-check rows, with an updated tally
- [ ] The pull request records the 5C and voice scores, before and after
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

The book's build and `check:book` in the CI `book` job.

## Docs to update

- The book plan's §4.3 row

## Risks and open questions

- U20 judged that the topic fits one section, and the owner agreed on 2026-11-19, so the risk that it needs a chapter is closed.
- T46's approval check and all of T47 were untested when this scope was set. If either records a limit, teach that behaviour from the SDK's docs and say so.
- T47's example is `verify/cloudflare-agents/examples/13-voice-pipeline.ts`, with regions `voice-agent`, `book:note` markers `hold`, `signal` and `stream`, and a transcript. It ran in local workerd with fake speech stages; Workers AI's speech models have no local simulation, and `agents/voice` is experimental at 0.33.0 as of November 2026. In our harness, audio frames reached the client as `Blob`s until it set `binaryType = "arraybuffer"`; this is not checked against workerd's source.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
