# 0027. Label every reply as AI-written in code, hash identifiers in spans, and require a retention period before shadow

- **Status:** Accepted (owner, 2026-11-18); synthetic and de-identified tickets only in the repo
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD8](../plans/build-agent.md#ad8-code-appends-the-ai-label-spans-hash-identifiers-and-later-stages-need-a-retention-period-owner-to-confirm-with-hd11)

## Context

Agent decision 8 asks how replies are labelled, which fields are hashed in traces and what retention applies to the session log. ADR 0018 keeps transcripts with no automatic deletion until a retention period is set, which suits a developer tool but not a product that holds customer data.

## Decision

The reply tool appends a fixed AI-written label in code after approval. Spans carry requester, tenant and order ids only as keyed HMAC-SHA-256 hashes, with the key held beside the approval key ring outside every sandbox; content and tool arguments stay off. Lookups return summaries, never full profiles. The offline stage needs no retention setting; shadow, canary and general release refuse to start without one, and it covers child sessions and spill files. Real tickets stay outside the repository unless the owner allows them in.

## Consequences

- The owner, with support and legal, sets the label wording, the retention period and where real tickets live.
- The harness's span projection needs a keyed-hash option (build-agent.md §3.7, H12).
