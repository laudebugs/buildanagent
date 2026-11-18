# Roadmap: from eight verified SDK references to reviewed plans for our own agent stack

- **Status:** Phase complete (2026-11-18); M5–M7 are the next phase
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18)
- **Plans:** [SDK references](sdk-references.md) · [SDK comparison](sdk-comparison.md) · [agent skills](agent-skills.md) · [build guides](build-guides.md) · [implementation plans](implementation-plans.md) · [CI](ci.md)
- **Done so far (2026-11-18):** this phase is complete. Milestones M1–M4 and X below: eight [SDK references](../reference/), the [comparison](../comparison/), eight [skills](../../.agents/skills/), the research rounds, the three [build guides](../guides/), and the three reviewed plans ([SDK](build-sdk.md), [harness](build-harness.md), [agent](build-agent.md)). The next phase builds M5–M7, starting at B1.

## What we are building

agent-speak ends this phase with four things:
1. **A verified reference for each of eight agent SDKs:** the Claude Agent SDK, Pi, the OpenAI Agents SDK, the Vercel AI SDK, LangChain.js, Cloudflare Agents, Google ADK and the GitHub Copilot SDK. Each reference type-checks every doc example and runs the complete ones offline.
2. **A comparison** of those SDKs: one feature table, one deep comparison built on the same support-triage agent in all eight, and a TypeScript gap report.
3. **One agent skill per SDK,** so coding agents working in this repo know how to use each SDK correctly.
4. **Three build guides and three reviewed implementation plans,** for building our own agent SDK, harness and agent. The phase stops when the plans are reviewed; building starts in the next phase.

## Sequence and dependencies

```
 S1 Claude ✅ ─┐
 S2 Pi ✅ ─────┤
 S3a ─► S3b ───┼─► C1 ─► C2 ─► K1 ─► K2 ─┐
 S4a ─► S4b ───┘                          │
 S5a ─► S5b ─► C3 ─► K3 (LangChain, added 2026-11-18, done)
 S6a ─► S6b ─► S7a ─► S7b ─► S8a ─► S8b ─► C5 ─► C4 ─► K4
   (Cloudflare, Google ADK, GitHub Copilot and the TypeScript gap report, added 2026-11-18) ─► before G1b
                                          ├─► G1a ─► G1b ─► P1 ─┐
                                          ├─► G2a ─► G2b ─► P2 ─┼─► P4 (review) ─► stop
                                          └─► G3a ─► G3b ─► P3 ─┘

 H1 ─► H2 ─► H3 (Hacker News practitioner research, added 2026-11-18) ─► before G1b, G2b, G3b

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
| M2 Comparison and skills (done 2026-11-18) | C1–C2, K1–K2 | The feature table, the deep comparison, the refreshed research report, and four agent skills |
| M2b LangChain (done 2026-11-18) | S5a, S5b, C3, K3 | A fifth verified reference, folded into the comparison and the skills before the build guides |
| M2c Cloudflare, Google ADK and Copilot (done 2026-11-18) | S6a–S8b, C5, C4, K4 | Sixth to eighth references, the TypeScript gap report, and a TS-parity row for all eight SDKs |
| M2d Strands Agents (added 2026-11-18) | S9a, S9b, C6, K5 | A ninth verified reference, folded into the comparison, the gap report and the skills; starts 2026-11-20 |
| M3 Build guides (done 2026-11-18) | G1–G3, H1–H3, R1 | Researched guides to building an agent SDK, a harness and an agent, informed by the Hacker News practitioner research and with secondary claims re-checked against primary sources |
| X CI and dependency security (done 2026-11-18) | X1, X2 | Checks on every push, a nightly verify with drift and audit gates, and Dependabot scoped to our manifests |
| M4 Reviewed plans (done 2026-11-18) | P1–P4 | Detailed implementation plans, reviewed together, ready for the build phase |
| M5 Our agent SDK (next phase) | B1–B20, B15b, B19b | `@agent-speak/gateway` and `@agent-speak/sdk` in `packages/`, built from [build-sdk.md](build-sdk.md) once P4 accepts it |
| M6 Our agent harness (next phase) | N1–N40, N38b | `@agent-speak/protocol`, `harness`, `cli` and `evals`, built from [build-harness.md](build-harness.md); it starts after B1–B2 and interleaves with Round B (§6 of the plan), and N38b waits for A17 and A19 |
| M7 Our agent (next phase) | A1–A24 | `@agent-speak/triage-agent`, built from [build-agent.md](build-agent.md); it starts after N1 and needs N35 for its capstone, with shadow, canary and release as later-phase items |

## How each todo is worked

- **One todo is one pull request, squash-merged into `main`** (from 2026-11-18; before that, todos were pushed to `main` directly). Move the todo `ready/` → `ongoing/` in the first commit and `ongoing/` → `done/` in the last, push the branch after each meaningful step, and merge once CI passes ([AGENTS.md, Git](../../AGENTS.md#git)).
- **Prose goes through the writing skills.** Draft with `/anthropic-skills:writing`, review with `/anthropic-skills:writing-review`, apply the fixes, then re-check every changed claim against its source.
- **Code goes through the local checks.** `pnpm check`, `pnpm typecheck` and `pnpm test` pass before every push ([AGENTS.md coding standards](../../AGENTS.md#coding-standards)).
