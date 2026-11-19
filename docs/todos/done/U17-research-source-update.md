# U17: Read fourteen owner-chosen sources, most of them unfetched seeds, against the main report

| Field | Value |
| --- | --- |
| ID | `U17` |
| Status | `done` |
| Plan | [Build guides §4d, U17](../../plans/build-guides.md#u17-source-update-for-the-main-report-added-2026-11-19) |
| Round / milestone | Research (added 2026-11-19) |
| Depends on | [R1](R1-reverify-secondary.md) |
| Size | S |

## Goal

The first research round could not fetch many of its seed sources because the network policy blocked their hosts, so the main report relied on search summaries for agent architecture, MCP and memory. R1 later re-checked the report's secondary figures, and U17 builds on its corrections. U17 reads fourteen URLs the owner chose: ten seeds the custom-harness notes list as unfetched, Anthropic's MCP launch post, pages from Mastra and Langfuse on two blocked frameworks seed hosts, and the SWE-bench docs. It reads each against the main report and its fact-check, and says what changes in our research and plans. It matters now because the MCP client todos (N24, N25) have not started, and any spec change they miss is cheapest to fix before code.

## Context

- [Main report](../../research/agent-sdks-and-harness-design.md): the conclusions and the MCP paragraph each source is read against
- [Main fact-check](../../research/fact-check-2026-11-18.md): R1's corrections and the later-closures table this round adds to
- [Custom-harness notes](../../research/notes/custom-harness-architecture.md) and [frameworks notes](../../research/notes/oss-frameworks.md): the lists of unfetched seeds; left unchanged as historical notes
- [R1 in the main fact-check](../../research/fact-check-2026-11-18.md#re-verification-against-primary-sources-r1): the corrections this round builds on
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog): the primary source for every protocol claim
- [N24](../ready/N24-mcp-stdio.md) and [N25](../ready/N25-mcp-http-background.md): the MCP client todos the findings bear on

## Scope

**In scope**

- Fetching the fourteen URLs the owner chose, logging any that fail as ⚠️ unfetched
- Per-source notes with quotes, quality and a verdict against a main-report section
- Following secondary claims to their primary sources where a claim bears on our design
- A short report with proposed plan changes, and its fact-check log
- Index entries in `AGENTS.md`, `README.md` and the build-guides plan, and a later-closures row in the main fact-check

**Out of scope** (and which todo covers it)

- Editing the main report's text, N24, N25, N31 or the AGENTS.md research rules: each is a proposed change for the owner
- Rewriting the historical custom-harness and frameworks notes: they stay as written
- The seeds the owner did not choose: aiagent.org, six planning blogs and gotburnout.io (custom-harness notes), and six frameworks seed hosts. No todo covers them yet

## Tasks

- [x] Fetch all fourteen sources and record the URL, date and HTTP status of each in the notes' [fetch log](../../research/notes/source-update-2026-11-19.md#fetch-log)
- [x] Write [the notes](../../research/notes/source-update-2026-11-19.md), one entry per source
- [x] Check claims that bear on our design against primary sources: the MCP changelog and security page, the AAIF post, Kapoor et al., MAP, CLEAR, TheAgentCompany and the CrewAI README
- [x] Draft [the report](../../research/source-update-2026-11-19.md) with `/anthropic-skills:writing`
- [x] Fact-check every claim in [the fact-check log](../../research/fact-check-source-update-2026-11-19.md)
- [x] Review the whole report with `/anthropic-skills:writing-review`, fix the findings and re-check changed claims
- [x] Add the index entries and the later-closures row
- [x] Fix the first code-review round's findings and log each correction in the fact-check

## Acceptance criteria

- [x] All three documents exist under `docs/research/`, and every source is marked fetched or ⚠️ unfetched
- [x] Every claim in the report has a row in its fact-check log
- [x] `pnpm -s check` passes, and every relative link and anchor in the changed files resolves

## Tests

None: documentation only. `pnpm -s check` and a relative-link check over the changed files.

## Docs to update

`AGENTS.md` (research layout), `README.md` (docs table), [`build-guides.md`](../../plans/build-guides.md) (§4d paragraph and §5 row), and the later-closures table in [`fact-check-2026-11-18.md`](../../research/fact-check-2026-11-18.md#later-closures).

## Risks and open questions

- The owner decides four of the report's proposed changes: whether an MCP server's input request may pause a turn, whether to mint span ids at call time, whether to edit the main report's text, and whether to require arXiv versions on every figure.
- Whether the pinned `@modelcontextprotocol/client` 2.4.0 handles `input_required` results is unchecked; N24 should check it first.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`). Not done: the work was drafted in one sitting on `docs/research-source-update`, and its first commit (`12b3a54`, pull request #36) added this file straight to `done/`
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step. Partly done: `pnpm -s check` passes; `typecheck` and `test` were not run because no code changed. The branch is pushed to pull request #36
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated. Partly done: the file was created in `done/` rather than moved (see the first item), and the plan's table row is added
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message. In progress: the first round (high) counted more than 6 findings, so the second round is medium then low. The high and medium findings are fixed; the low review is still to run on pull request #36
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description. Rerun on the copy that each code-review round's fixes changed
