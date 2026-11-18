# 0034. Give the coding agent one GitHub App, minted outside the sandbox, that pushes only to agent branches

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-coding-agent.md, CA5](../plans/build-coding-agent.md#ca5-one-github-app-minted-outside-the-sandbox-pushing-only-to-agent-branches-accepted)

## Context

The [portable agents report](../research/deployment/portable-agents.md#cloud-coding-agents-are-a-control-plane-around-a-disposable-vm) names the GitHub identity as one of two designs a cloud coding agent needs before code, and finds the common weakness in Open SWE: a token whose scope is the whole App installation. Narrowing the token to one repository is not enough either, because GitHub App permissions apply per repository, not per branch.

## Decision

The owner installs one GitHub App on their account and selects its repositories. For each task the control plane mints an installation access token narrowed to that task's repository; GitHub expires it after one hour. The token never enters the sandbox: the egress route adds it to git and API requests. The route rejects pushes to any ref outside `refs/heads/agent/*`, deletions and tags. A ruleset on each repository's default branch requires a pull request and blocks force pushes, with the App off its bypass list.

## Consequences

- Todo W3 builds the token minting, the repository allowlist and the git route, and tests the route against recorded `git push` traffic.
- The owner creates the App and the rulesets; W3's docs give the steps.
- A multi-user agent would need per-user installations and a new record.
