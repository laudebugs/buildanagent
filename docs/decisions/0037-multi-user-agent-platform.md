# 0037. Build the agent platform for other users from the start, with one tenant per user

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-agent-platform.md, PF1](../plans/build-agent-platform.md#pf1-other-users-from-the-start-one-tenant-per-user-accepted)

## Context

The owner added a platform for building agents to our plans: a user describes an agent, and the platform builds it, checks it and deploys it to the user's own cloud. Asked whether it should serve the owner first or others from the start, the owner chose "Others from the start". The personal coding agent stays personal under [ADR 0032](0032-personal-coding-agent-first.md), and the [agent-building platforms report](../research/deployment/agent-building-platforms.md) found no product that ships tested code to the user's own cloud.

## Decision

The platform is multi-user from its first milestone. Each user is one tenant, the unit of isolation. A tenant's tasks run in Durable Objects named by tenant and task, its secrets are encrypted under a tenant key, and its sandboxes are never shared. Sign-in, tenancy, cloud connections, BYOK, isolation, quotas and the audit log are all in milestone M8.

## Consequences

- Round F's first todos build tenancy (F1) and sign-in (F2) before any generation work.
- ADR 0032 and ADR 0034 are unchanged; the platform's stricter rules get their own records (0041, 0042).
- Teams and roles are out of M8 and need a later record.
