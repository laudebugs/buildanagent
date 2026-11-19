# Plan: turn the build guides into detailed, reviewed plans for our SDK, harness and agent (Round P)

- **Status:** Done (2026-11-18). P1 done: [build-sdk.md](build-sdk.md); P2 done: [build-harness.md](build-harness.md); P3 done: [build-agent.md](build-agent.md); P4 done: [plan review](reviews/plan-review.md), 39 findings, 38 fixed and 1 fixed in part). The phase is complete. The build phase works from six plans: the [SDK](build-sdk.md), the [harness](build-harness.md), the [SDK gaps](close-sdk-gaps.md), the [coding agent](build-coding-agent.md), the [agent platform](build-agent-platform.md) and the deferred triage [agent](build-agent.md). **Revision (plan review 2, 2026-11-19):** the todo ranges in §4 now include the todos added after P4. The later plans carry their own ranges: Round E is E1–E7 with E4a and E4b ([close-sdk-gaps.md](close-sdk-gaps.md)), Round W is W1–W12 and Round F is F1–F18.
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
| P1 | Plan: our agent SDK (done: [build-sdk.md](build-sdk.md), [ADRs](../decisions/README.md), todos B1–B20 with B15b and B19b) | G1b |
| P2 | Plan: our agent harness (done: [build-harness.md](build-harness.md), ADRs 0012–0021, todos N1–N50 with N38b, N46a/b, N47a/b and N48a/b, and N52 from U18) | G2b, P1 |
| P3 | Plan: our agent (done: [build-agent.md](build-agent.md), ADRs 0022–0031, todos A1–A24) | G3b, P2 |
| P4 | Review all three plans together, and fix the findings (done: [plan-review.md](reviews/plan-review.md)) | P1, P2, P3 |

## 5. Risks

- **Plans that are too vague to build from.** Mitigation: P4's buildability check, and the todo template's acceptance-criteria section, which every todo must fill.

## 6. Open questions

- **Answered by the owner on 2026-11-18:** SDK D2 (Anthropic Messages and OpenAI-compatible Chat Completions first), D5 with harness HD5 (a persistent host-only key ring), D8 (0.x, `private: true`, CI export check; publishing timing revised 2026-11-19 by [ADR 0047](../decisions/0047-first-release-and-trusted-publishing.md)), and harness HD4 (`srt` interactive, Docker headless, confirmed after N19), HD8 (30 tasks, k = 5, $3 cap) and HD11 (no automatic deletion). Each accepted the plan's proposal; the ADRs say Accepted.
- **Answered by the owner on 2026-11-18, from P3:** AD2 (T4 denied until caps are set from refund history), AD3 (the proposed role table), AD6 (people named at A19), AD8 (only synthetic and de-identified tickets in the repo), AD9 ($3 in shadow, production at the shadow p99) and AD14 (helpdesk chosen at A24). The plans now hold no open owner decision; the remaining owner inputs are scheduled in todos A19, A20 and A24.
- **Answered by P4, from P3:** the fifteen agent needs ([build-agent.md §3.7](build-agent.md#37-needs-from-the-sdk-and-harness-plans), relabelled AS1–AS2 and AH1–AH13) went upstream except two dropped and one already covered. `Harness.invokeTool()` became the new harness todo N40, and product entries joined N2. N38 does not depend on A19; the new N38b carries the shared triage tasks ([plan review §4](reviews/plan-review.md#4-needs-reconciliation-24-change-upstream-3-drop-1-is-already-covered)).
- **Answered by P4, from P2:** twelve of the thirteen harness needs moved into the SDK plan, and the client-tool pause kind was dropped for Rounds B and N. `continueRun` does not re-run the gate for a verified `allow`, and ADR 0009 takes HD9's session cap ([plan review §3](reviews/plan-review.md#3-the-p4-questions-the-plans-raised-all-have-an-answer)).
- **Answered for P2, from P1:** use the seam names in [build-sdk.md §3.4](build-sdk.md) as written; `Cost.total` is `number | null`; check whether the `context_transformed` event carries enough for a compaction log entry.
