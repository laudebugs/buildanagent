# Todo board

Each todo is one pull request, squash-merged into `main` ([AGENTS.md, Git](../../AGENTS.md#git)), and its folder is its state:

| Folder | Meaning |
| --- | --- |
| [`ready/`](ready/) | Specified and waiting. Start one only when every todo in its **Depends on** is in `done/`. |
| [`ongoing/`](ongoing/) | Claimed. The first commit of the work moves the file here. |
| [`done/`](done/) | Finished. The last work commit before the pull request opens moves the file here and updates its plan's to-dos. Review-fix commits may then tick its review checkboxes. |

New todos start from [`TEMPLATE.md`](TEMPLATE.md), and each plan lists its todos. **Depends on** is the only record of the order; the [roadmap](../plans/roadmap.md) draws it as a graph. An **On hold** or **Deferred** banner at the top of a todo overrides its **Depends on**: leave the todo alone until the owner lifts the hold, even when every dependency is done.

## IDs

`S` [SDK references](../plans/sdk-references.md), `C` [SDK comparison](../plans/sdk-comparison.md), `K` [agent skills](../plans/agent-skills.md), `G` [build guides](../plans/build-guides.md), `P` [implementation plans](../plans/implementation-plans.md), `H` and `R` [build guides](../plans/build-guides.md) (Hacker News research and re-verification), `X` [CI](../plans/ci.md), `B` [build our SDK](../plans/build-sdk.md), `N` [build our harness](../plans/build-harness.md), `A` [build our agent](../plans/build-agent.md) (the triage agent, deferred by [ADR 0032](../decisions/0032-personal-coding-agent-first.md)), `W` [build the coding agent](../plans/build-coding-agent.md), `F` [build the agent platform](../plans/build-agent-platform.md), `E` [close the SDK gaps](../plans/close-sdk-gaps.md), `U` [agent UI research](../plans/build-guides.md#4d-research-how-agent-uis-are-built-u1-added-2026-11-18). A letter suffix (`S3a`, `S3b`) splits a round into todos.
