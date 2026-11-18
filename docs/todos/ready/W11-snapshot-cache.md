# W11: Snapshot-cache ADR and, if justified, the cache

| Field | Value |
| --- | --- |
| ID | `W11` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [W8](W8-cloud-mode-evals.md) |
| Size | M |

## Goal

Decide whether tasks need a cached environment snapshot, using W8's and N49's numbers, and build it only if start time dominates (CA8).

## Context

- [Portable agents report](../../research/deployment/portable-agents.md#cloud-coding-agents-are-a-control-plane-around-a-disposable-vm): how Claude Code on the web snapshots its environment.

## Scope

**In scope**

- An ADR on the snapshot key, invalidation and storage
- The cache, if the ADR accepts it

**Out of scope**

- Per-user environments

## Tasks

- [ ] Read W8 and N49
- [ ] Write the ADR
- [ ] Build the cache behind `SandboxClient`'s snapshot flag if accepted

## Acceptance criteria

- [ ] An ADR exists with a decision and the numbers behind it

## Tests

Depends on the ADR.

## Docs to update

Plan CA8; ADR index.

## Risks and open questions

The owner may decide start time is acceptable and close this todo with the ADR alone.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
