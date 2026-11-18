# 0019. Order the permission pipeline deny-first, offer three middle-ground approval modes, and confine classifier allows to the host callback

- **Status:** Accepted (P4 review, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD12](../plans/build-harness.md#hd12-three-middle-ground-modes-and-no-classifier-allow-outside-the-host-callback)

## Context

Harness decision 12 asks which middle ground between per-call prompts and none to offer, and whether a classifier may approve. Approval fatigue drives users to skip prompts, and practitioners use Claude's classifier without trusting it.

## Decision

The pipeline runs hooks, deny rules, ask rules, the mode, allow rules and the host callback, in that order; no match means ask interactively and deny headless; an allow rule that shadows the host callback is a startup error. The harness ships default path-based ask rules (test deletions and skips, hooks, CI config, rules files), sticky allowances scoped to a run or session that refuse interpreter prefixes and secrets, and grouped approvals per step. Modes are `default`, `accept_edits`, `read_only`, `bypass` and `shadow`. A classifier may deny or ask as a hook, and may allow only as the host callback, recorded with `by: "classifier:<id>"`.

## Consequences

- P3's agent decision 10 decides whether the agent uses a classifier at all.
- Todo N39 counts prompts per task under each mode.
- A tool may set `approvalReuse: "none"` to refuse sticky and grouped resolutions, and a group counts as one approver's resolution per request (P4, R8; todo N14).
