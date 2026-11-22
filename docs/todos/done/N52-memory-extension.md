# N52: File-based memory extension: the `memory` tool, sourced records, the capped index, expiry and purge marks

| Field | Value |
| --- | --- |
| ID | `N52` |
| Status | `done` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N21](../done/N21-builtin-tools.md), [N23](../done/N23-skills-context-files.md), [N33](../done/N33-retention-schema-docs.md) |
| Size | M |

## Goal

Build long-term memory for our agents as a removable extension, `@buildanagent/harness/memory`, so the coding agent can keep facts between sessions without a memory service. The owner approved this todo on 2026-11-19, with the rest of the [retrieval and memory report](../../research/memory/retrieval-and-memory.md)'s twelve proposed changes. The extension writes one sourced record per fact through a `memory` tool, loads a capped index at session start, expires records that no check has renewed, and makes a delete reach the session log ([HD17](../../plans/build-harness.md#hd17-long-term-memory-is-a-file-based-extension-of-sourced-records-that-expire-unless-a-check-renews-them-accepted); [HD11's amendment](../../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-accepted)).

## Context

- [HD17](../../plans/build-harness.md#hd17-long-term-memory-is-a-file-based-extension-of-sourced-records-that-expire-unless-a-check-renews-them-accepted) and [ADR 0056](../../decisions/0056-file-based-memory-and-log-purge.md): the decision this todo builds, and the HD11 amendment beside it
- [Retrieval and memory report](../../research/memory/retrieval-and-memory.md#long-term-memory-works-best-as-sourced-records-in-files-written-through-a-tool-recalled-through-an-index-and-forgotten-by-expiry): the rules for writing, recall and forgetting, with their sources
- [Claude, memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool): the command set this tool copies, and its path-traversal warning
- [N23](../done/N23-skills-context-files.md): how context files reach the model: as the start of the first user message of every request, built by a `transformContext` hook (not in the system prompt), which the index follows
- [N33](../done/N33-retention-schema-docs.md): the retention purge that must honour the purge marks
- [Plan review 2, owner action 5](../../plans/reviews/plan-review-2.md#6-eleven-owner-actions-are-still-open-and-only-one-a-test-project-for-n50-touches-waves-15): the proposed HD16, whose memory side HD17 carries

## Scope

**In scope**

- `memoryExtension({ root, clock })`, exported from `@buildanagent/harness/memory`, which registers the `memory` tool and loads the index
- The `memory` tool's five commands, `view`, `create`, `str_replace`, `delete` and `rename`, over `.agents/memory/` only, with canonical-path validation
- `MemoryRecord` with subject, fact, source, type, created, validated, expiry and trust fields, stored one record per file
- The index: one line per record, loaded at session start and capped at 200 lines or 25 KB, whichever comes first
- Expiry from the injected clock: project facts 90 days after the last validation, task records at session end, preferences until changed, low-trust records sooner
- Low-trust writes after an `outputTrust: "untrusted"` tool result has entered the session
- Purge marks on the log entries that wrote or returned a deleted record, a targeted purge, and N33's retention purge honouring the marks

**Out of scope** (and which todo covers it)

- A vector index or embeddings over memory: none, until an eval shows keyword search missing ([retrieval and memory report](../../research/memory/retrieval-and-memory.md#start-with-keyword-search-and-add-vectors-only-after-a-measured-miss))
- A background consolidation pass at compaction or session end: a follow-up todo once N52's records exist
- The rest of HD16 (approval tiers, `approvalReuse`, taint and URL checks for untrusted-source tools): the owner's open decision in plan review 2
- A memory service: the platform's per-tenant memory, which its plan notes ([platform plan, PF1](../../plans/build-agent-platform.md#pf1-other-users-from-the-start-one-tenant-per-user-accepted))

## Tasks

- [x] Write `MemoryRecord` and its on-disk form, one Markdown file per record with the fields in front matter, and document both in `packages/harness/README.md`.
- [x] Implement the five commands. Resolve each path to its canonical form, refuse any path outside `.agents/memory/`, URL-encoded traversal included, and refuse a `delete` or `rename` of the directory itself.
- [x] Build the index from the records, one line per record with its subject, type, trust and path, and cut it at 200 lines or 25 KB; say in the index when records were left out.
- [x] Read time only from the injected clock, and drop expired records from `view` and from the index.
- [x] Never renew `validated` on a read. Decide how a successful check against the record's source renews it, and record the choice in HD17.
- [x] Mark every write in a session that has received an `outputTrust: "untrusted"` tool result as low-trust, and set the low-trust expiry below each trusted period; record the periods in HD17.
- [x] On `delete`, remove the record and its index line, and add the ids of the entries that wrote or returned it to a purge list.
- [x] Add a targeted purge that rewrites a session into a new file with the marked entries' content removed and their `EntryBase` kept, and make N33's retention purge read the same list.
- [x] Make the extension removable: with it unloaded, no memory tool or index reaches the model.

## Acceptance criteria

- [x] A scripted model stores a record in one session and the next session's first request carries its index line in its first user message (corrected from "system prompt": the index follows N23's context files, [fact-check row N52-5](../../plans/reviews/fact-check-build-harness.md))
- [x] A `view` of `.agents/memory/../secrets.env`, or of its URL-encoded form, returns an error result and reads nothing
- [x] With the clock advanced 91 days past a project fact's last validation, `view` and the index both omit it; a read in between does not move that date
- [x] A write after an untrusted tool result is stored with `trust: "low"` and expires before a trusted record of the same type
- [x] After a `delete` and a targeted purge, no session file under the store contains the deleted fact, and every rewritten session still rebuilds
- [x] An index over 200 records stops at 200 lines, and one over 25 KB stops at 25 KB
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/memory/*.test.ts`, every one against `fakeSandbox()` and a temp directory, with a scripted model and an injected clock, so no test touches the host or reads real time.

## Docs to update

- `packages/harness/README.md`: the memory extension, the record format, the index cap and the expiry rules
- [build-harness.md](../../plans/build-harness.md): HD17's renewal rule and low-trust periods, and the §4 todo table
- N33's transcript schema page: the purge list and the targeted purge

## Risks and open questions

- A targeted purge rewrites a session file, which breaks a byte-for-byte replay of that session. Replay should report the purge instead of failing silently.
- A fact can also reach a summary entry written at compaction, and the purge marks only cover entries that wrote or returned the record. Say in the schema page that a summary may still hold it until the retention purge.
- The 90-day period copies Copilot's default, which moved from 28 days in January 2026; N39's evals may show a better period.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- `memoryExtension({ root, files, registry, clock?, sessionId?, secrets? })` from `@buildanagent/harness/memory` registers the `memory` tool (`view`, `create`, `str_replace`, `delete`, `rename` over `.agents/memory/` only) and loads a capped index (200 lines or 25 KiB); `@buildanagent/harness/memory/node` is the Node-only file store, which refuses a link anywhere on a path. It takes `files` and `registry` because the `Sandbox` interface has no list, delete or rename and the registry gives each tool's `outputTrust`.
- Only a write renews a record; a read never does. Expiry: project facts 90 days after the last validation (30 low trust), preferences until changed (30 low trust), task records at session end or after 7 days (1 low trust). A write becomes low trust once an untrusted tool result is in the conversation.
- A `delete` moves the record's call marks to a purge list; `purgeSession()` rewrites a session with the marked entries' content removed and their base fields kept, and `pruneSessions({ marks })` reports the marks it purges. Spill files, compaction summaries and the model's own repeated text can still hold a deleted fact until the retention purge.
- After the high review of PR #361: a repeated purge also replaces the file under the session id; a session's own files end at its first file or that file's `~o` copy, plus the `~q` copies above it, so a purged fork never deletes its parent's files, and the retention purge uses the same rule; a `str_replace` never raises a record's trust; the tracker marks reads of expired records and never fails another tool's call; the calls file is bounded (100 calls per record, 2 MiB), with older calls moved to the purge list; `clearPurgeMarks()` shares the memory calls' queue; and the extension denies the built-in `write` and `edit` inside `.agents/memory/` (rows N52-17 to N52-27).
- Open for the owner: whether taint should be read from the log's `tool_result.trust` (a resumed session whose history was compacted away only becomes low trust again on a fresh untrusted result); nothing coordinates two processes writing the same memory folder, so a `clearPurgeMarks()` in one process can still lose a mark a delete in another adds; `bash`, and any tool whose writes the gate can't read, can still write `.agents/memory/`, plant a record that reads as trusted, or clear the purge list, and closing that needs either a sandbox that keeps the folder out of the tools' reach or records signed by the extension (row N52-22, ⚠️); the 25 KB cap is read as 25 KiB and the expiry periods are our own choice (rows N52-4 and N52-6, ⚠️).
