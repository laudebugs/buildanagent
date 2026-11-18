# X2: Dependency security: upgrade every vulnerable pin to its latest fixed release

| Field | Value |
| --- | --- |
| ID | `X2` |
| Status | `ready` |
| Plan | [CI §3b](../../plans/ci.md#3b-dependency-security-x2-added-2026-11-18) |
| Round / milestone | Round X (maintenance), next after S6b |
| Depends on | None |
| Size | M |

## Goal

Clear the 19 Dependabot alerts on main (7 high, 9 moderate, 3 low, as of 2026-11-18) by moving each vulnerable dependency to its latest fixed release, as the 2026-11-18 policy allows, and keep the harnesses verified.

## Context

- The policy in [AGENTS.md](../../../AGENTS.md#coding-standards): pins at least one week old, except that a known vulnerability calls for the latest fixed release
- `github.com/laudebugs/agent-speak/security/dependabot`, or `pnpm audit` locally

## Scope

**In scope**

- Every package in the workspace (root and `verify/*`), direct or transitive

**Out of scope** (and which todo covers it)

- A routine upgrade of the SDK pins themselves (each SDK's next upgrade); CI automation (X1)

## Tasks

- [ ] List the alerts (`pnpm audit --json`, or the Dependabot page) and map each to the harness that pulls it in
- [ ] Upgrade each to the latest fixed release, bumping the direct dependency for transitive ones; use `pnpm.overrides` with a comment only when no fixed parent release exists
- [ ] Run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm run verify` for every affected harness
- [ ] Record any change in doc-example results in that SDK's fact-check, and any alert accepted as unfixable in the harness README
- [ ] Push, then confirm the alert count on GitHub

## Acceptance criteria

- [ ] No open high alert without a recorded reason
- [ ] All local checks and the affected harnesses' `verify` pass

## Tests

The existing harness suites.

## Docs to update

Affected harness READMEs and fact-checks.

## Risks and open questions

An SDK upgrade forced by a vulnerability can change doc-example results; record those changes in the fact-check rather than pinning to a vulnerable release.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
