# U5: Research server-side rollback for agent tool calls

| Field | Value |
| --- | --- |
| ID | `U5` |
| Status | `done` |
| Plan | [Build guides §4d, U5](../../plans/build-guides.md#u5-server-side-rollback-for-agent-tool-calls-added-2026-11-18) |
| Round / milestone | Research (added 2026-11-18) |
| Depends on | None |
| Size | M |

## Goal

Research server-side rollback for agent tool calls, as the owner asked on 2026-11-18.

## Deliverables

- Three notes in [`docs/research/reversible-actions/notes/`](../../research/reversible-actions/notes/): `transactions-and-idempotency.md`, `temporal-tables-and-event-sourcing.md` and `tool-results-after-rollback.md`
- The report, [`server-rollback.md`](../../research/reversible-actions/server-rollback.md)
- Its [fact-check](../../research/reversible-actions/fact-check-server-rollback.md)

## Definition of done

- [x] Researched in parallel parts, with versions pinned as of November 2026 and primary sources first
- [x] Fact-checked against primary sources, corrections logged
- [x] Rewritten with `/anthropic-skills:writing` and reviewed whole with `/anthropic-skills:writing-review`
- [x] Delivered through its own pull request, squash-merged after CI passes
