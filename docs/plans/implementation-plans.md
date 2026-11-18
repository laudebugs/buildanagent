# Plan: turn the build guides into detailed, reviewed plans for our SDK, harness and agent (Round P)

- **Status:** Draft
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18): break the research into very detailed plans, and review every plan
- **Builds on:** the three [build guides](build-guides.md) (Round G)
- **Todos:** Round P on the [todo board](../todos/README.md); §4 lists them.

## 1. Goal

When this phase ends, our own agent SDK, harness and agent each have a plan detailed enough to build from without rediscovering anything. The phase stops after the plans are reviewed; building starts in the next phase, from these plans.

## 2. What each plan contains

Each plan (`docs/plans/build-sdk.md`, `build-harness.md`, `build-agent.md`) follows the same outline:
1. **Goal and non-goals,** taken from the guide's reference architecture.
2. **Decisions,** one per open question in the guide, each with options, the choice and its evidence. Lasting decisions also become ADRs in `docs/decisions/`.
3. **Package and module layout** in the pnpm workspace, with public APIs sketched as TypeScript signatures.
4. **Rounds and todos,** each todo sized as one reviewable batch of commits, with tasks, acceptance criteria and tests, written from [the todo template](../todos/TEMPLATE.md).
5. **Test strategy:** the offline test model, the eval suite, and how each layer is verified against the references' capstone agent.
6. **Risks, open questions and a sequence** that slots into the [roadmap](roadmap.md).

## 3. The review (P4)

P4 reviews the three plans together, because their interfaces depend on each other:
- **Consistency:** the harness plan uses the SDK plan's APIs as written, and the agent plan uses the harness plan's.
- **Coverage:** every guide recommendation is planned, deferred with a reason, or rejected with evidence.
- **Buildability:** every todo has acceptance criteria someone could check, and no todo is larger than one reviewable batch.
- **Prose:** each plan passes `/anthropic-skills:writing-review`, with the fixes applied.

The findings and fixes go into `docs/plans/reviews/plan-review.md`. The phase ends when every finding is fixed or explicitly accepted by the owner.

## 4. Todos

| ID | Title | Depends on |
| --- | --- | --- |
| P1 | Plan: our agent SDK | G1b |
| P2 | Plan: our agent harness | G2b, P1 |
| P3 | Plan: our agent | G3b, P2 |
| P4 | Review all three plans together, and fix the findings | P1, P2, P3 |

## 5. Risks

- **Plans that are too vague to build from.** Mitigation: P4's buildability check, and the todo template's acceptance-criteria section, which every todo must fill.

## 6. Open questions

- None yet; Round G will raise them.
