# S10: Voice and realtime sections in the OpenAI, Cloudflare and ADK references

| Field | Value |
| --- | --- |
| ID | `S10` |
| Status | `ready` |
| Plan | [SDK references §5](../../plans/sdk-references.md#5-todos) |
| Round / milestone | Round S (SDK references), M2e (added 2026-11-19) |
| Depends on | [U20](../done/U20-research-voice-and-realtime.md) |
| Size | M |

## Goal

Add a voice and realtime section to three SDK references: the [OpenAI Agents SDK](../../reference/openai-agents-sdk/guide.md), [Cloudflare Agents](../../reference/cloudflare-agents/guide.md) and [Google ADK](../../reference/google-adk/guide.md) guides, each with rows in its fact-check. When the references were planned, the realtime and voice agents were out of scope, so none of the three guides covers them. U20's research then found that OpenAI and Cloudflare ship a voice agent and ADK ships an experimental live layer, each with traps a builder meets ([U20 report, SDKs](../../research/voice/voice-and-realtime.md#two-sdks-ship-a-voice-agent-two-ship-experimental-live-layers-and-four-leave-voice-to-the-builder)). The owner approved this change, U20's change 6, on 2026-11-19, and lifted voice out of the [SDK references plan's](../../plans/sdk-references.md#s3-openai-agents-sdk-done) out-of-scope list the same day.

## Context

- [U20 report, SDKs](../../research/voice/voice-and-realtime.md#two-sdks-ship-a-voice-agent-two-ship-experimental-live-layers-and-four-leave-voice-to-the-builder): the SDK table and the two paragraphs on OpenAI, Cloudflare and ADK
- U20's SDK notes: [OpenAI and Cloudflare](../../research/voice/notes/sdks-openai-cloudflare.md) and [ADK and the other five](../../research/voice/notes/sdks-adk-vercel-langchain-claude-copilot-pi.md), with file paths and line numbers
- [U20's fact-check](../../research/voice/fact-check-voice-and-realtime.md): the rows behind each SDK claim
- [T46](../done/T46-example-realtime-session.md) and [T47](T47-example-voice-pipeline.md): the two book examples. Where one has landed, its section marks the claims it asserts **[verified]**; otherwise the section cites the pinned `.d.ts` or the mirrored doc
- [TypeScript gaps, Google ADK](../../comparison/typescript-gaps.md#google-adk-the-port-trails-python-by-14-features-but-the-docs-undersell-it-by-15): ADK's Python-only live parts
- [AGENTS.md, process for documenting an SDK](../../../AGENTS.md#process-for-documenting-an-sdk), steps 6 and 8

## Scope

**In scope**

- One new section in each of the three guides, numbered after the guide's last numbered section and before its conclusion, with a heading that states its conclusion
- Rows in each reference's `fact-check.md` for every new claim, in a dated section like the U18 memory findings
- Updates to each guide's examples section when T46 or T47 has added an example

**Out of scope** (and which todo covers it)

- New `verify/` examples: [T46](../done/T46-example-realtime-session.md) and [T47](T47-example-voice-pipeline.md); an ADK `runLive` example is one of U20's three optional examples and has no todo
- The other five references, whose SDKs ship no voice agent as of November 2026
- The book's section: [T38](T38-section-voice-and-realtime.md)

## Tasks

- [ ] OpenAI guide: `RealtimeSession` around a `RealtimeAgent`, what the realtime agent drops from the text agent's configuration, the transports, `needsApproval` in a session, `interrupt()` and truncation to the heard audio on WebSocket, and `ScriptedRealtimeTransport` for offline tests.
- [ ] Cloudflare guide: `withVoice(Agent)` and its `onTurn`, the `Transcriber` and `TTSProvider` interfaces, barge-in through `context.signal`, the experimental warning, and the text-only history.
- [ ] ADK guide: `Runner.runLive()` with a `LiveRequestQueue`, its experimental status, the five reconnection attempts, and the Python-only parts the TypeScript gap report records.
- [ ] Re-read each claim against the pinned `.d.ts` or mirrored doc, and log it in that reference's fact-check before drafting the next section.
- [ ] Draft each section with `/anthropic-skills:writing`, then review each whole guide with `/anthropic-skills:writing-review`, fix every finding, and re-check every claim a fix touched.

## Acceptance criteria

- [ ] Each of the three guides has a voice and realtime section, and each claim either carries **[verified]** with its example or cites its source
- [ ] Each of the three fact-checks has a dated section with the new rows and an updated tally
- [ ] Every relative link and anchor in the changed files resolves
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

None beyond the link check and the root checks; the claims come from T46, T47 and the pinned packages.

## Docs to update

- The three guides and their fact-checks, the [feature table](../../comparison/feature-table.md)'s voice row if a section changes a cell, and the SDK references plan's §5 row

## Risks and open questions

- Cloudflare's voice API "will break between releases", and ADK's `runLive` "is **experimental**". Each section states the pinned version and "as of" date, and the weekly SDK-update job's pull request flags a change.
- If T46 or T47 has not landed, or records a limit instead of a passing check, the matching section cites the source instead of marking the claim verified.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
