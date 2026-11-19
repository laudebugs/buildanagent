# U15: Research browser use for our agents

| Field | Value |
| --- | --- |
| ID | `U15` |
| Status | `done` |
| Plan | [Build guides §4d, U15](../../plans/build-guides.md#u15-browser-use-added-2026-11-18) |
| Round / milestone | Research (added 2026-11-18) |
| Depends on | [U12](U12-map-the-agent-building-platform-market.md) |
| Size | L |

## Goal

The owner asked on 2026-11-18 how our agents will handle tasks that need a web browser. U15 researches browser use as of November 2026, primary sources first, and says what it means for the coding agent plan, the agent platform plan and their ADRs.

## Deliverables

- [`docs/research/browser-use/browser-use.md`](../../research/browser-use/browser-use.md) and its [fact-check](../../research/browser-use/fact-check-browser-use.md)
- Research notes in [`docs/research/browser-use/notes/`](../../research/browser-use/notes/)
- Index entries in `README.md`, `AGENTS.md` and the build-guides plan

## Definition of done

- [x] Researched in parallel parts, with versions pinned as of November 2026 and primary sources first
- [x] Fact-checked against primary sources, corrections logged
- [x] Drafted with `/anthropic-skills:writing` and reviewed whole with `/anthropic-skills:writing-review`, fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass
- [x] Delivered through its own pull request, squash-merged after CI passes
