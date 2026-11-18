# Roadmap: from four verified SDK references to reviewed plans for our own agent stack

- **Status:** In progress
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18)
- **Plans:** [SDK references](sdk-references.md) · [SDK comparison](sdk-comparison.md) · [agent skills](agent-skills.md) · [build guides](build-guides.md) · [implementation plans](implementation-plans.md) · [CI](ci.md)
- **Done so far:** the [research report](../research/agent-sdks-and-harness-design.md) and its [fact-check](../research/fact-check-2026-11-18.md), the [harness teardown](../research/harness-architectures.md), and the [Claude Agent SDK](../reference/claude-agent-sdk/) and [Pi](../reference/pi/) references with their verification harnesses.

## What we are building

agent-speak ends this phase with four things:
1. **A verified reference for each of four agent SDKs:** the Claude Agent SDK, Pi, the OpenAI Agents SDK and the Vercel AI SDK. Each reference type-checks and runs every doc example offline.
2. **A comparison** of those SDKs: one feature table and one deep comparison built on the same support-triage agent in all four.
3. **One agent skill per SDK,** so coding agents working in this repo know how to use each SDK correctly.
4. **Three build guides and three reviewed implementation plans,** for building our own agent SDK, harness and agent. The phase stops when the plans are reviewed; building starts in the next phase.

## Sequence and dependencies

```
 S1 Claude ✅ ─┐
 S2 Pi ✅ ─────┤
 S3a ─► S3b ───┼─► C1 ─► C2 ─► K1 ─► K2 ─┐
 S4a ─► S4b ───┘                          │
 S5a ─► S5b ─► C3 ─► K3 (LangChain, added 2026-11-18, done)
 S6a ─► S6b ─► S7a ─► S7b ─► C4 ─► K4 (Cloudflare and Google ADK, added 2026-11-18) ─► before G1b
                                          ├─► G1a ─► G1b ─► P1 ─┐
                                          ├─► G2a ─► G2b ─► P2 ─┼─► P4 (review) ─► stop
                                          └─► G3a ─► G3b ─► P3 ─┘

 X1 (CI) can start at any time; it runs after the SDK rounds by the owner's choice.
```

- **SDK references first.** S3 (OpenAI) and then S4 (Vercel) follow the eight-step process in [AGENTS.md](../../AGENTS.md#process-for-documenting-an-sdk). Each SDK splits into a verification todo (a) and a reference-docs todo (b).
- **Comparison after all four references.** C1 (the feature table) and C2 (the deep comparison) need every reference's verified facts.
- **Skills after the comparison.** K2 writes each skill from its reference and from the comparison's "when to choose" guidance.
- **Build guides after the skills.** G1, G2 and G3 can run in parallel, but G2 (harness) reads G1 (SDK) and G3 (agent) reads both, so they start in that order.
- **Plans last.** P1–P3 turn each guide into a detailed plan, and P4 reviews all three plans together. The phase stops there.

## Milestones

| Milestone | Rounds | What ships |
| --- | --- | --- |
| M1 Four SDK references (done 2026-11-18) | S1–S4 | A guide, a fact-check, a mirror and an offline verification harness for each SDK |
| M2 Comparison and skills (done 2026-11-18) | C1–C2, K1–K2 |
| M2b LangChain (done 2026-11-18) | S5a, S5b, C3, K3 | A fifth verified reference, folded into the comparison and the skills before the build guides |
| M2c Cloudflare and Google ADK | S6a–S7b, C4, K4 | Sixth and seventh references, with a TS-parity row for all seven SDKs | The feature table, the deep comparison, the refreshed research report, and four agent skills |
| M3 Build guides | G1–G3 | Researched guides to building an agent SDK, a harness and an agent |
| M4 Reviewed plans | P1–P4 | Detailed implementation plans, reviewed together, ready for the build phase |

## How each todo is worked

- **One todo is one batch of commits pushed to `main`.** Move the todo `ready/` → `ongoing/` in the first commit and `ongoing/` → `done/` in the last, and push after each meaningful step.
- **Prose goes through the writing skills.** Draft with `/anthropic-skills:writing`, review with `/anthropic-skills:writing-review`, apply the fixes, then re-check every changed claim against its source.
- **Code goes through the local checks.** `pnpm check`, `pnpm typecheck` and `pnpm test` pass before every push ([AGENTS.md coding standards](../../AGENTS.md#coding-standards)).
