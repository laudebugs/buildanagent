# 0032. Build a personal cloud coding agent as the first agent on our stack, and defer the triage agent

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-coding-agent.md, CA1 and CA2](../plans/build-coding-agent.md#ca1-one-user-the-owners-repositories-and-the-owners-model-key-accepted)

## Context

The roadmap built a support-triage agent first (M7, [build-agent.md](../plans/build-agent.md)). The owner then asked for a cloud coding agent like Claude Code on the web, for personal use ("just personal with our own api key"), and chose it to replace triage. The [portable agents report](../research/deployment/portable-agents.md#cloud-coding-agents-are-a-control-plane-around-a-disposable-vm) found that our harness plan already covers the inside of a coding agent's sandbox, so a coding agent puts the planned harness to work from its first task.

## Decision

The first agent built on our SDK and harness is a coding agent for one user, the owner, on repositories the owner chooses, with the owner's own model key. It replaces the triage agent as M7. The triage plan, decisions AD1–AD14, ADRs 0022–0031 and todos A1–A24 are deferred, not withdrawn, and stay as written.

## Consequences

- Round W in [build-coding-agent.md](../plans/build-coding-agent.md) becomes M7; the triage round moves to a deferred milestone in the roadmap.
- Harness todo N38b, which adds ten triage tasks to HD8's seed suite, is deferred with the triage round. HD8 and its twenty repository tasks are unchanged.
- No tenancy, billing or per-user GitHub install is built. A multi-user agent needs a new decision.
