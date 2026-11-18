# 0041. Deliver platform code through one public GitHub App that each user installs, with tokens bound to the task's own tenant

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-agent-platform.md, PF8](../plans/build-agent-platform.md#pf8-one-public-github-app-installed-by-each-user-accepted-adr-0041)

## Context

The personal coding agent uses one App on the owner's account ([ADR 0034](0034-github-app-identity.md)). A multi-user platform needs an App other users can install. GitHub documents that a public App can be installed by "any user on GitHub", while a private one installs only on its owner's account ([GitHub, App visibility](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/making-a-github-app-public-or-private)).

## Decision

The platform registers one public GitHub App. Each user installs it on the repositories the platform may write. ADR 0034's rules apply per tenant: a one-hour installation token narrowed to the task's repository, minted outside the sandbox, added at egress, and allowed to push only to `agent/*` branches. One rule is new: a task may use only an installation that belongs to its own tenant.

## Consequences

- Todo F10 builds the App registration, installation records and the tenant check, reusing W3's token minting and git route.
- ADR 0034 stays the record for the personal agent and is unchanged.
