# T66: Add our own packages to Chapter 13's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T66` |
| Status | `ongoing` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T21](../done/T21-chapter-tools-at-scale.md), [N11](../done/N11-tool-registry.md), [N21](../done/N21-builtin-tools.md), [N22](../done/N22-in-process-extensions.md), [N23](../done/N23-skills-context-files.md), [N24](../done/N24-mcp-stdio.md) |
| Size | M |

## Goal

Chapter 13 ("Tools at scale") shows third-party listings only. This todo adds our own packages as the first tab of every listing they can show (ADR 0057, BK8) and keeps the third-party tabs unchanged.

## Scope

To be written in the first work commit: read the chapter, its log and `packages/harness` (README, `src/tools`, `src/mcp`, `src/extensions`, `examples/`), then list each of the chapter's listings (`#pi-active-tools`, `#pi-inactive-call`, `#deferred-server`, `#deferred-checks`, the MCP tabs, `#skills-run`, `#skills-checks`) as in scope or staying single, with the reason.

N25 (MCP over HTTP and legacy SSE) is not built. The manager's note of 2026-11-22: the tabs do not need it unless a listing shows HTTP. The chapter's `switchTo` lists N25, so the report holds Chapter 13 back; this todo drops N25 from `switchTo` only if no tab shows an HTTP transport, and says so in its Outcome. The chapter's prose about N25 stays as intent.

## Tasks

- [ ] Read the chapter, its log and the packages; write Scope and Tasks.
- [ ] Write the examples our tabs need, with regions, notes and transcripts.
- [ ] Turn each supported listing into a tabs block with our tab first, and pin the harness's version in the caption.
- [ ] Fact-check every changed claim into `apps/manual/fact-checks/tools-at-scale.md` as new rows, and update the tally.
- [ ] Update the plan row and move this todo to `done/`.

## Acceptance criteria

- [ ] Each supported listing is a tabs block whose first tab comes from `packages/` and whose other tabs are unchanged
- [ ] `check:book`, the manual's `test`, `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline

## Outcome

To be written when the todo is done.
