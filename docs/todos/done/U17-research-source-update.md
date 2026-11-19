# U17: Read the main report's unfetched seed sources and four more against it

| Field | Value |
| --- | --- |
| ID | `U17` |
| Status | `done` |
| Plan | [Build guides §4d, U17](../../plans/build-guides.md#u17-source-update-for-the-main-report-added-2026-11-19) |
| Round / milestone | Round U (added 2026-11-19) |
| Depends on | None |
| Size | S |

## Goal

The first research round seeded ten sources it could not fetch because the network policy blocked their hosts, so the main report relied on search summaries for agent architecture, MCP and memory. U17 fetches those ten and four sources the repo lacked, reads each against the main report and its fact-check, and says what changes in our research and plans. It matters now because the MCP client todos (N24, N25) have not started, and any spec change they miss is cheapest to fix before code.

## Context

- [Main report](../../research/agent-sdks-and-harness-design.md): the conclusions and the MCP paragraph each source is read against
- [Main fact-check](../../research/fact-check-2026-11-18.md): R1's corrections and the later-closures table this round adds to
- [Custom-harness notes](../../research/notes/custom-harness-architecture.md): the scope note that lists the unfetched seeds; left unchanged as a historical note
- [MCP 2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog): the primary source for every protocol claim
- [N24](../ready/N24-mcp-stdio.md) and [N25](../ready/N25-mcp-http-background.md): the MCP client todos the findings bear on

## Scope

**In scope**

- Fetching the ten seeds and four new sources, logging any that fail as ⚠️ unfetched
- Per-source notes with quotes, quality and a verdict against a main-report section
- Following secondary claims to their primary sources where a claim bears on our design
- A short report with proposed plan changes, and its fact-check log
- Index entries in `AGENTS.md`, `README.md` and the build-guides plan, and a later-closures row in the main fact-check

**Out of scope** (and which todo covers it)

- Editing the main report's text, N24, N25, B17 or the AGENTS.md research rules: each is a proposed change for the owner
- Rewriting the historical custom-harness notes: they stay as written

## Tasks

- [x] Fetch all fourteen sources and record the HTTP result of each
- [x] Write [the notes](../../research/notes/source-update-2026-11-19.md), one entry per source
- [x] Check claims that bear on our design against primary sources: the MCP changelog and security page, the AAIF post, Kapoor et al., MAP, CLEAR, TheAgentCompany and the CrewAI README
- [x] Draft [the report](../../research/source-update-2026-11-19.md) with `/anthropic-skills:writing`
- [x] Fact-check every claim in [the fact-check log](../../research/fact-check-source-update-2026-11-19.md)
- [x] Review the whole report with `/anthropic-skills:writing-review`, fix the findings and re-check changed claims
- [x] Add the index entries and the later-closures row

## Acceptance criteria

- [x] All three documents exist under `docs/research/`, and every source is marked fetched or ⚠️ unfetched
- [x] Every claim in the report has a row in its fact-check log
- [x] `pnpm -s check` passes, and every relative link and anchor in the changed files resolves

## Tests

None: documentation only. `pnpm -s check` and a relative-link check over the changed files.

## Docs to update

`AGENTS.md` (research layout), `README.md` (docs table), [`build-guides.md`](../../plans/build-guides.md) (§4d paragraph and §5 row), and the later-closures table in [`fact-check-2026-11-18.md`](../../research/fact-check-2026-11-18.md#later-closures).

## Risks and open questions

- The owner decides three of the report's proposed changes: whether an MCP server's input request may pause a turn, whether to edit the main report's text, and whether to require arXiv versions on every figure.
- Whether the pinned `@modelcontextprotocol/client` 2.4.0 handles `input_required` results is unchecked; N24 should check it first.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`). The work was done in one sitting on `docs/research-source-update`, and the owner commits it, so the file starts in `done/`
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step. `pnpm -s check` passes; the owner pushes
- [x] This file in `done/` (Status `done`), and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
