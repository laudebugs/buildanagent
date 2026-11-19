# 0056. Keep long-term memory as sourced files that expire, and let a memory delete reach the session log

- **Status:** Accepted (owner, 2026-11-19); amends [0018](0018-retention-and-transcript-schema.md)
- **Date:** 2026-11-19
- **Plan:** [build-harness.md, HD17](../plans/build-harness.md#hd17-long-term-memory-is-a-file-based-extension-of-sourced-records-that-expire-unless-a-check-renews-them-accepted) and [HD11's amendment](../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-accepted)

## Context

The harness had no long-term memory, and AGENTS.md asks for "File-based memory first". The [retrieval and memory report](../research/memory/retrieval-and-memory.md) (U18) found that the memory products of 2026 write small, sourced records through a tool, recall them through a short index, and forget them by expiry. It also found that none of our eight SDKs expires a memory inside the process. A recalled record can be stale or planted: MINJA planted records through queries alone, and later sessions obeyed them in 76.8% of attempts. ADR 0018 keeps every transcript until a retention period is set, so a fact deleted from memory would still sit in the log entry that recorded its write. The report proposed twelve plan changes, and the owner approved all twelve on 2026-11-19. This record covers changes 5 and 7.

## Decision

- Long-term memory is an extension that is off until a host loads it. It offers one `memory` tool with `view`, `create`, `str_replace`, `delete` and `rename` over `.agents/memory/` only, and it validates every path.
- Each record holds a subject, the fact, a source, a type, a created date, a last-validated date, an expiry and a trust level. An index of one line per record, capped at 200 lines or 25 KB, loads at session start, and the agent searches the rest with the read-only `grep` and `glob` built-ins.
- A project fact expires 90 days after its last successful validation, a task record when its session ends, and a preference when the user changes it. Reading a record never renews it.
- Writes in a session that has received output from an untrusted tool are stored as low-trust and expire sooner than any trusted record of their type. The memory tool cannot write skills, context files or rules.
- **Amendment to ADR 0018.** A memory delete also marks the log entries that wrote or returned the record. The retention purge removes them with their session, and a targeted purge removes them sooner by rewriting the session into a new file with the marked content removed and each `EntryBase` kept. The default of no automatic deletion is unchanged.

## Consequences

- Todo N52 builds the extension, the purge marks and the targeted purge; todo N21 adds `grep` and `glob`.
- Todo N33's retention purge must read the purge list, and its schema page documents the targeted purge.
- A targeted purge breaks a byte-for-byte replay of the session it rewrites, so replay reports the purge.
- The proposed HD16 in plan review 2 takes the same untrusted-input rule for `write` and `edit` on procedural paths once the owner decides it.
