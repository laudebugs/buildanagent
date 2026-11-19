# F11: The generated-code sandbox profile and MCP-config rule

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F11` |
| Status | `ready` |
| Plan | [Build agent platform §5.2](../../plans/build-agent-platform.md#52-stage-f-b-connects-the-engine-and-ships-m8) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [N43](N43-remote-sandbox-egress-policy.md), [N46b](N46b-cloudflare-sandbox-backend.md), [N47b](N47b-e2b-sandbox-backend.md) |
| Size | M |

## Goal

Define the sandbox profile for tenant code: a fresh hosted sandbox per task, egress denied by default, and no stdio MCP commands (PF9).

## Context

- [ADR 0042](../../decisions/0042-generated-code-isolation.md).
- [Agent-building platforms report](../../research/deployment/agent-building-platforms.md#approvals-are-common-but-signed-approvals-and-side-effect-undo-exist-nowhere): the security lessons.

## Scope

**In scope**

- The profile on Cloudflare Sandbox and E2B
- The allowlist: package registries and the user's named MCP hosts
- The gate rule that rejects command-based MCP configuration

**Out of scope**

- Security testing (F15)

## Tasks

- [ ] Compile the profile through `EgressPolicy` for both backends.
- [ ] Refuse local backends for tenant tasks.
- [ ] Add the MCP-config check to the gate.

## Acceptance criteria

- [ ] A tenant task on a local backend is refused.
- [ ] A generated config with an MCP `command` fails the gate.

## Tests

Conformance cases added to N45's suite for the profile.

## Docs to update

The plan's §5.2 table.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
