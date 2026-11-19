# U16: Research watching and taking over the agent's browser

| Field | Value |
| --- | --- |
| ID | `U16` |
| Status | `ongoing` |
| Plan | [Build guides §4d, U16](../../plans/build-guides.md#u16-watch-and-take-over-the-browser-added-2026-11-19) |
| Round / milestone | Research (added 2026-11-19) |
| Depends on | [U15](../done/U15-research-browser-use.md) |
| Size | M |

## Goal

The owner asked on 2026-11-19 whether a user can stream the agent's browser, watch it and take over. U15's report covers the live views of hosted browsers, but its first browser for the coding agent is a headless Chromium inside the sandbox that nobody can watch. U16 researches how to stream and hand over that browser without breaking our rules (loop outside the sandbox, no credentials inside it), and adds a section and a proposed plan change to the browser-use report.

## Deliverables

- A "watch and take over" section and a new proposed change in [`docs/research/browser-use/browser-use.md`](../../research/browser-use/browser-use.md), with rows in its [fact-check](../../research/browser-use/fact-check-browser-use.md)
- Research notes in [`docs/research/browser-use/notes/watch-and-take-over.md`](../../research/browser-use/notes/watch-and-take-over.md)
- The U16 entry in the build-guides plan

## Definition of done

- [ ] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, fact-checked against primary sources, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
