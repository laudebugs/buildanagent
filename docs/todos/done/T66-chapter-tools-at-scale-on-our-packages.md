# T66: Add our own packages to Chapter 13's listings as tabs

| Field | Value |
| --- | --- |
| ID | `T66` |
| Status | `done` |
| Plan | [Book plan BK8](../../plans/build-book.md#bk8-code-from-verify-now-our-own-sdk-as-its-todos-land-accepted) |
| Round / milestone | Round T (textbook), MT |
| Depends on | [T21](T21-chapter-tools-at-scale.md), [N11](N11-tool-registry.md), [N21](N21-builtin-tools.md), [N22](N22-in-process-extensions.md), [N23](N23-skills-context-files.md), [N24](N24-mcp-stdio.md) |
| Size | M |

## Goal

Chapter 13 ("Tools at scale") shows third-party listings only. This todo adds our own packages as the first tab of every listing they can show (ADR 0057, BK8) and keeps the third-party tabs unchanged.

## Scope

Chapter 13 has eleven listings. Our harness, `@buildanagent/harness`, can show nine of them, which makes seven tabs blocks because the three MCP listings are one block, and the two A2A listings stay single. The harness is already a book harness (T59), so no wiring changes. The new files are four examples, two `lib/` helpers, four transcripts and their registration by the existing book-example runner. No package source changes.

| Listing | Decision | Our tab, first |
| --- | --- | --- |
| `#pi-active-tools` | Tabs | `04-tool-selection.ts`, region `active-tools`: a turn's `tools` list as an allowlist, as a list built from the registry that leaves two tools out, and as the empty list |
| `#pi-inactive-call` | Tabs | The same file, region `inactive-call`: a call to a registered tool the turn does not offer comes back as an error result, and the loop sends a second request |
| `#deferred-server` | Tabs | `05-deferred-tools.ts`, region `deferred-server`: two in-process copies of one MCP server, one deferred by default and one with `exposure: "direct"` |
| `#deferred-checks` | Tabs, with replay | Region `deferred-checks`: the first request holds no deferred definition and does not name one, `tool_search` activates one tool, and the next request holds it |
| `#mcp-ai`, `#mcp-cloudflare`, `#mcp-copilot` | One tab block, our tab added | `06-mcp-client.ts`, region `mcp-client`: `createMcpManager()` connects an in-process server in the 2026-07-28 era and registers `mcp__orders__order_status`, and a scripted loop calls it |
| `#skills-run` | Tabs | `07-skills.ts`, region `skills-run`: the harness lists the skills the host passes |
| `#skills-checks` | Tabs, with replay | Region `skills-checks`: the first request lists the skill and withholds its body, a `read` of its `SKILL.md` brings the body, and the log gets a `skill_loaded` entry |
| `#a2a-serve`, `#a2a-delegate` | Single | Our harness has no A2A client or server. It has only the `remoteAgent` flag on a registered tool |

**Why each tab is more than glue.** Each runs the package's own mechanism: the turn's tool list, the registry's exposure, `toolSearchTool()` and its interceptor, the MCP manager's probe and registration, `withSkills()` and the runner's `skill_loaded` entry. The server is the real `@modelcontextprotocol/server` library over its in-memory pair, and the files are in `fakeSandbox()`, so no example starts a process or reads a host file ([examples guideline](../../guidelines/examples.md#a-book-example-may-carry-the-plumbing-that-keeps-its-listing-true)). A skill is parsed with `parseSkill()` from text, because `discoverSkills()` reads the host's folders; the chapter says so.

**N25.** No tab shows an HTTP transport, so this todo drops N25 from the chapter's `switchTo`. The chapter's prose about N25 stays as intent.

**Prose the tabs made false.** The chapter called `@buildanagent/harness` private, called the built-in tools and the `read` tool unbuilt and said no listing shows the tool search. Rows 160, 161 and 172 correct them and keep the earlier rows.

## Tasks

- [x] Read the chapter, its log and the packages; write Scope and Tasks.
- [x] Write the examples our tabs need, with regions, notes and transcripts.
- [x] Turn each supported listing into a tabs block with our tab first, and pin the harness's version in the caption.
- [x] Fact-check every changed claim into `apps/manual/fact-checks/tools-at-scale.md` as new rows, and update the tally.
- [x] Update the plan row and move this todo to `done/`.

## Acceptance criteria

- [x] Each supported listing is a tabs block whose first tab comes from `packages/` and whose other tabs are unchanged
- [x] `check:book`, the manual's `test`, `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline

## Outcome

- **The examples.** `packages/harness/examples/04-tool-selection.ts` (regions `active-tools` and `inactive-call`), `05-deferred-tools.ts` (`deferred-server`, `deferred-checks`), `06-mcp-client.ts` (`mcp-client`) and `07-skills.ts` (`skills-run`, `skills-checks`) run offline in the harness's book-example test, which records their transcripts in `packages/harness/results/transcripts/`. `examples/lib/workspace.ts` builds the built-in tools over an in-memory sandbox, and `examples/lib/mcp-servers.ts` serves a weather server and an orders server in this process.
- **The chapter.** Seven tabs blocks carry our tab first, with ids ending in `-ours`. The other tabs' code and notes are unchanged, and their captions became tab names. The prose says where our harness differs: no exclusion option, no deferred tool named in a request, and no option that enables a skill.
- **N25.** No tab shows HTTP, so the chapter's `switchTo` no longer lists N25, and its prose about N25 stays as intent. The report now lists Chapter 13 as ready for tabs.
- **Corrections.** `@buildanagent/harness` is a public alpha, not private (row 160). The built-in tools and the `read` tool are built (rows 161 and 172).
- **Fact-check.** Rows 160 to 176 in `apps/manual/fact-checks/tools-at-scale.md`, tallied at 176 rows. Rows 160, 161 and 172 are ✏️ corrections. All others are ✅.
