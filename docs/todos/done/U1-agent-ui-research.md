# U1: Research how agent UIs are built, and how our eight SDKs expose UI contracts

| Field | Value |
| --- | --- |
| ID | `U1` |
| Status | `done` |
| Plan | [Build guides §4d](../../plans/build-guides.md#4d-research-how-agent-uis-are-built-u1-added-2026-11-18) |
| Round / milestone | Research (added 2026-11-18) |
| Depends on | None |
| Size | M |

## Goal

Deep research into the approaches agent products and libraries take to UI, and how the eight SDKs verified in this repo implement their UI contracts: event streams, message parts, approval UI, resumable streams and state sync.

## Deliverables

- Five notes in [`docs/research/agent-ui/notes/`](../../research/agent-ui/notes/)
- The synthesis, [`agent-ui-research.md`](../../research/agent-ui/agent-ui-research.md)
- Its [fact-check log](../../research/agent-ui/fact-check.md)

## Definition of done

- [x] Research run in five parallel parts, citing primary sources at recorded versions
- [x] Synthesis written and fact-checked against primary sources, corrections logged
- [x] Delivered through one pull request, squash-merged after CI passes
