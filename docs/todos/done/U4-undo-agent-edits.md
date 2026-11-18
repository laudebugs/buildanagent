# U4: Research how a UI makes an agent's edits undoable

| Field | Value |
| --- | --- |
| ID | `U4` |
| Status | `done` |
| Plan | [Build guides §4d, U4](../../plans/build-guides.md#u4-undo-for-agent-edits-in-uis-added-2026-11-18) |
| Round / milestone | Research (added 2026-11-18) |
| Depends on | [U2](U2-vercel-ui-sdk.md) |
| Size | M |

## Goal

Find how a UI can make an agent's edits undoable: what UI SDK's change callbacks and history support, how client state libraries implement undo, and which agent products use draft-then-commit or undo-toast patterns.

## Deliverables

- Three notes in [`docs/research/agent-ui/notes/`](../../research/agent-ui/notes/): `ui-sdk-change-and-history.md`, `state-library-undo.md` and `agent-product-undo-patterns.md`
- The report, [`undo-agent-edits.md`](../../research/agent-ui/undo-agent-edits.md)
- Its fact-check, in the round's [fact-check log](../../research/agent-ui/fact-check.md)

## Definition of done

- [x] Researched in three parallel parts, with versions pinned as of November 2026 and primary sources first
- [x] Fact-checked against primary sources, corrections logged
- [x] Rewritten with `/anthropic-skills:writing` and reviewed whole with `/anthropic-skills:writing-review`
- [x] Delivered through its own pull request, squash-merged after CI passes
