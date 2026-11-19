# Roadmap: from eight verified SDK references to reviewed plans for our own agent stack

- **Status:** Phase complete (2026-11-18); M5–M7 are the next phase. On 2026-11-18 the owner made a personal cloud coding agent M7 and deferred the triage agent ([ADR 0032](../decisions/0032-personal-coding-agent-first.md)), and added a multi-user agent platform as M8 and M9 ([ADR 0037](../decisions/0037-multi-user-agent-platform.md)). **The SDK, the harness and Round E are being built:** on 2026-11-18 the owner said "let's not build anything first". On 2026-11-19 the owner lifted that hold for the SDK and harness ("SDK and harness only") and then for all of Round E ("Lift hold on all of E"). Each todo gets one pull request, merged when CI passes. Round B (M5) is under way, Round N (M6) interleaves with it from B1 and B2, and Round E (M5e) runs beside both ([close-sdk-gaps.md](close-sdk-gaps.md)). Rounds W, F and A stay on hold, and no todo in them starts until the owner says go; each W and F todo carries a hold banner.
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18)
- **Plans:** [SDK references](sdk-references.md) · [SDK comparison](sdk-comparison.md) · [agent skills](agent-skills.md) · [build guides](build-guides.md) · [implementation plans](implementation-plans.md) · [CI](ci.md)
- **Done so far (2026-11-18):** this phase is complete. Milestones M1–M4 and X below: eight [SDK references](../reference/), the [comparison](../comparison/), eight [skills](../../.agents/skills/), the research rounds, the three [build guides](../guides/), and the three reviewed plans ([SDK](build-sdk.md), [harness](build-harness.md), [agent](build-agent.md)). The next phase builds M5, M5e and M6 now; M7 and M8 wait for the owner's go.

## What we are building

buildanagent ends this phase with four things:
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

The next phase (from 2026-11-18) interleaves Round B and Round N, adds Round N's portability stage, then runs Round W once the owner says go. Round N branches from B1 and B2 (N1 depends on B1, N2 on N1 and B2):

```
 B1 ─► B2 ─► B3 … B20            (Round B; later N todos also wait on the B todos they import)
 B1 ─► N1 ─┐
 B2 ───────┴─► N2 … N40 ─► N41–N45 ─► N46a/b (Cloudflare) ─► W1 … W8 ─► W9 (AWS), W10 (Vercel), W11
                                   ├─► N47a/b (AWS) ──────────────────────┘
                                   └─► N48a/b (Vercel) ───────────────────┘
```

Round F (the agent platform, added 2026-11-18) starts its engine-free stage once the owner says go, and joins the coding agent's engine at F12:

```
 B1 ─► F1, F3 ─► F2, F4, F13, F14 ─► F7, F8 ─► F9
 E7 ─► F5 ─► F6 (with F3)   (F5's scope moved to Round E on 2026-11-18)
 W3 ─► F10;  N43, N46b, N47b ─► F11
 W4, W5, F6, F10, F11 ─► F12 ─► F15 ─► F16 (M8) ─► F17 (AWS), F18 (our SDK, after B20 and N45) (M9)
```

Round E (close the SDK gaps, added 2026-11-18) builds the safety package on the verified third-party SDKs before our own SDK exists. **Approved by the owner on 2026-11-19, with the hold lifted the same day** ("Lift hold on all of E"; [close-sdk-gaps.md](close-sdk-gaps.md)):

```
 B1 ─► E1 ─┬─► E2 ─┬─► E4a ─► E4b ─┐
           ├─► E3 ─┘               ├─► E7
           ├─► E6 ─────────────────┤
           └─► E5 (after B5) ──────┘
```

Round E also feeds later todos, which list it in **Depends on**: E1 ─► B10 and B14, E3 ─► B15, E2 ─► N7, N40 and W6, and E7 ─► N45. Plan review 2 also added two edges outside Round E: N50 ─► N46b (Cloudflare egress, which also waits for the owner's decision) and W12 ─► W8 (the ten coding-agent eval tasks).

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
| M5e The SDK gaps as a safety package (added 2026-11-18; approved, hold lifted 2026-11-19) | E1–E7 | `@buildanagent/agent-safety` on `agents` 0.33.0 and `ai` 7.0.162: typed write outcomes, effect identity, signed approvals, plan approvals, a pre-call cost cap, a BYOK guard and stores on four targets, built from [close-sdk-gaps.md](close-sdk-gaps.md) |
| Q Code quality checks (added 2026-11-19) | Q1, Q2 | The strict compiler flags, Biome caps and a portability test (Q1), then unused-code, boundary, duplication and todo-id checks (Q2), as [`docs/guidelines/`](../guidelines/README.md) requires; Q1 can start now |
| L Publish and docs (added 2026-11-19) | L1–L3, L4a, L4b, L5–L8 | Built `dist/` packages, Changesets and trusted publishing, then 0.1.0 of the gateway and SDK once B4 and B8 are done; the docs at `docs.buildanagent.fyi` on Starlight and the website at `buildanagent.fyi`, both on Cloudflare ([publish-and-docs.md](publish-and-docs.md)); L5 and L7 can start now, and L1 starts after Q1 |
| M5 Our agent SDK (next phase) | B1–B20, B15b, B19b | `@buildanagent/gateway` and `@buildanagent/sdk` in `packages/`, built from [build-sdk.md](build-sdk.md) |
| M6 Our agent harness (next phase) | N1–N40, N41–N49 (portability, added 2026-11-18), N50 (Cloudflare egress verification, added 2026-11-19) | `@buildanagent/protocol`, `harness`, `cli` and `evals`, built from [build-harness.md](build-harness.md); it starts after B1–B2 and interleaves with Round B (§6 of the plan); N38b is deferred with M7b |
| M7 Our coding agent (next phase, added 2026-11-18) | W1–W12 (W12 added 2026-11-19) | `@buildanagent/coding-agent`, a personal cloud coding agent built from [build-coding-agent.md](build-coding-agent.md): on Cloudflare first (W4–W8), then AWS (W9) and Vercel (W10); W4 needs the portability todos N46a and N46b |
| M7b The triage agent (deferred 2026-11-18) | A1–A24, N38b | `@buildanagent/triage-agent`, built from [build-agent.md](build-agent.md) when its round resumes ([ADR 0032](../decisions/0032-personal-coding-agent-first.md)) |
| M8 Our agent platform (next phase, added 2026-11-18) | F1–F16 | `@buildanagent/platform`, built from [build-agent-platform.md](build-agent-platform.md): a multi-user platform that generates agents on Cloudflare `agents` 0.33.0 or `ai` 7.0.162, gates them, and deploys them into the user's own Cloudflare or Vercel account |
| M9 Agent platform on AWS and our SDK (added 2026-11-18) | F17, F18 | The AWS deploy target and our SDK and harness as the default generation target, after M5 and M6 |

## How each todo is worked

- **One todo is one pull request, squash-merged into `main`** (from 2026-11-18; before that, todos were pushed to `main` directly). Move the todo `ready/` → `ongoing/` in the first commit and `ongoing/` → `done/` in the last work commit before the pull request opens, and push the branch after each meaningful step. Merge once CI passes and every finding is fixed or explained: the two code-review rounds', the writing review's and, for documents, the fact-check's ([AGENTS.md, Git](../../AGENTS.md#git); [code review](../../AGENTS.md#every-pull-request-gets-two-rounds-of-code-review)).
- **Prose goes through the writing skills.** Draft with `/anthropic-skills:writing`. After the code-review rounds, review the copy with `/anthropic-skills:writing-review`, apply the fixes, then re-check every changed claim against its source ([AGENTS.md, copy](../../AGENTS.md#every-piece-of-copy-is-drafted-with-the-writing-skill-and-reviewed-once-the-code-is-done)).
- **Code goes through the local checks.** `pnpm check`, `pnpm typecheck` and `pnpm test` pass before every push ([AGENTS.md coding standards](../../AGENTS.md#coding-standards)).
