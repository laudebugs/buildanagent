# Todo board

Each todo is one batch of commits pushed to `main`, and its folder is its state:

| Folder | Meaning |
| --- | --- |
| [`ready/`](ready/) | Specified and waiting. Start one only when every todo in its **Depends on** is in `done/`. |
| [`ongoing/`](ongoing/) | Claimed. The first commit of the work moves the file here. |
| [`done/`](done/) | Finished. The last commit of the work moves the file here, with its plan's to-dos updated. |

New todos start from [`TEMPLATE.md`](TEMPLATE.md), and each plan lists its todos. **Depends on** is the only record of the order; the [roadmap](../plans/roadmap.md) draws it as a graph.

## IDs

`S` [SDK references](../plans/sdk-references.md), `C` [SDK comparison](../plans/sdk-comparison.md), `K` [agent skills](../plans/agent-skills.md), `G` [build guides](../plans/build-guides.md), `P` [implementation plans](../plans/implementation-plans.md), `H` and `R` [build guides](../plans/build-guides.md) (Hacker News research and re-verification), `X` [CI](../plans/ci.md), `B` [build our SDK](../plans/build-sdk.md), `N` [build our harness](../plans/build-harness.md), `A` [build our agent](../plans/build-agent.md) (the triage agent, deferred by [ADR 0032](../decisions/0032-personal-coding-agent-first.md)), `W` [build the coding agent](../plans/build-coding-agent.md), `U` [agent UI research](../plans/build-guides.md#4d-research-how-agent-uis-are-built-u1-added-2026-11-18). A letter suffix (`S3a`, `S3b`) splits a round into todos.
