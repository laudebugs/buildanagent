# W3: GitHub App token minting, repository allowlist and the git egress route

| Field | Value |
| --- | --- |
| ID | `W3` |
| Status | `ready` |
| Plan | [Build coding agent §5](../../plans/build-coding-agent.md#52-round-w-builds-the-coding-agent) |
| Round / milestone | Round W (build the coding agent), M7 |
| Depends on | [N43](N43-remote-sandbox-egress-policy.md), [W1](W1-coding-agent-scaffold.md) |
| Size | M |

## Goal

Build the identity ADR 0034 describes: per-task installation tokens minted outside the sandbox, a repository allowlist, and an egress route that lets git push only to `refs/heads/agent/*`.

## Context

- [ADR 0034](../../decisions/0034-github-app-identity.md): the decision.
- [GitHub, installation access tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app): token scope and the one-hour expiry.

## Scope

**In scope**

- Token minting narrowed to one repository
- The git route's ref filter, rejecting deletions and tags
- Owner setup docs for the App and the default-branch ruleset

**Out of scope**

- Pull request creation (W6)

## Tasks

- [ ] Implement minting with the `repositories` parameter
- [ ] Parse git push requests in the route and reject refs outside the agent namespace
- [ ] Record real `git push` traffic as fixtures and test the route offline
- [ ] Write the setup steps

## Acceptance criteria

- [ ] A push to `main` and a tag push are rejected in tests
- [ ] The token never appears in the sandbox's environment or output

## Tests

Offline route tests on recorded pushes; a secret-scan assertion.

## Docs to update

Package README; plan CA5.

## Risks and open questions

Git's smart HTTP protocol has several push forms; cover each in fixtures.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
