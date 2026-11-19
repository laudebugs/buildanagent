# 0018. Keep transcripts until a retention period is set, and keep the entry base stable per format version

- **Status:** Accepted (owner, 2026-11-18); amended by [0056](0056-file-based-memory-and-log-purge.md) (2026-11-19), so a memory delete also marks and purges the log entries that carry the fact
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD11](../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-accepted)

## Context

Harness decision 11 asks for the default retention, where expired entries go, and which fields are stable. Practitioners treat local transcripts as their system of record and name a 30-day purge as the limit; agent decision 8 merges with this as data policy.

## Decision

No automatic deletion by default. `retention: { days, action: "archive" | "purge" }` archives expired sessions as gzip files that stay searchable, or deletes them. `EntryBase` (`id`, `parentId`, `seq`, `timestamp`, `type`, `origin`), the entry type names and `formatVersion` are stable; other fields may change only with a `formatVersion` bump that ships a migration writing a new file. The JSON Schema is published in `packages/harness/schema/`.

## Consequences

- Todo N33 documents the schema and measures disk cost.
- The agent plan may set a stricter retention for customer data.
