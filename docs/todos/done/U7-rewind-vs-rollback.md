# U7: Research agent rewind versus data rollback, and recommend rollback for the triage agent

| Field | Value |
| --- | --- |
| ID | `U7` |
| Status | `done` |
| Plan | [Build guides §4d, U7](../../plans/build-guides.md#u7-agent-rewind-versus-data-rollback-added-2026-11-18) |
| Round / milestone | Research (added 2026-11-18) |
| Depends on | [U6](U6-agent-sagas.md) |
| Size | M |

## Goal

Research agent rewind versus data rollback, and recommend rollback for the triage agent, as the owner asked on 2026-11-18.

## Deliverables

- Two notes in [`docs/research/reversible-actions/notes/`](../../research/reversible-actions/notes/): `agent-rewind-mechanisms.md` and `rollback-in-our-sdks-and-plans.md`
- The report, [`rewind-vs-rollback.md`](../../research/reversible-actions/rewind-vs-rollback.md)
- Its [fact-check](../../research/reversible-actions/fact-check-rewind.md)

## Definition of done

- [x] Researched in parallel parts, with versions pinned as of November 2026 and primary sources first
- [x] Fact-checked against primary sources, corrections logged
- [x] Rewritten with `/anthropic-skills:writing` and reviewed whole with `/anthropic-skills:writing-review`
- [x] Delivered through its own pull request, squash-merged after CI passes
