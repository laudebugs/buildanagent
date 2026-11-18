# U8: Research whether Copilot holds a copy of a change for confirm or reject

| Field | Value |
| --- | --- |
| ID | `U8` |
| Status | `done` |
| Plan | [Build guides §4d, U8](../../plans/build-guides.md#u8-copilot-diff-review-and-confirm-added-2026-11-18) |
| Round / milestone | Research (added 2026-11-18) |
| Depends on | [U4](U4-undo-agent-edits.md) |
| Size | S |

## Goal

Research whether Copilot holds a copy of a change for confirm or reject, as the owner asked on 2026-11-18.

## Deliverables

- Two notes in [`docs/research/agent-ui/notes/`](../../research/agent-ui/notes/): `vscode-chat-editing.md` and `copilot-surfaces-and-comparison.md`
- The report, [`copilot-diff-review.md`](../../research/agent-ui/copilot-diff-review.md)
- Its fact-check, in the round's [fact-check log](../../research/agent-ui/fact-check.md)

## Definition of done

- [x] Researched in parallel parts, with versions pinned as of November 2026 and primary sources first
- [x] Fact-checked against primary sources, corrections logged
- [x] Rewritten with `/anthropic-skills:writing` and reviewed whole with `/anthropic-skills:writing-review`
- [x] Delivered through its own pull request, squash-merged after CI passes
