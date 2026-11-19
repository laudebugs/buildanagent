# X2: Dependency security: upgrade every vulnerable pin to its latest fixed release

| Field | Value |
| --- | --- |
| ID | `X2` |
| Status | `done` |
| Plan | [CI §3b](../../plans/ci.md#3b-dependency-security-x2-added-2026-11-18) |
| Round / milestone | Round X (maintenance), next after S6b |
| Depends on | None |
| Size | M |

## Goal

Clear the 19 Dependabot alerts on main (7 high, 9 moderate, 3 low, as of 2026-11-18) by moving each vulnerable dependency to its latest fixed release, as the 2026-11-18 policy allows, and keep the harnesses verified.

## Context

- The policy in [AGENTS.md](../../../AGENTS.md#coding-standards): pins at least one week old, except that a known vulnerability calls for the latest fixed release
- `github.com/laudebugs/buildanagent/security/dependabot`, or `pnpm audit` locally

## Scope

**In scope**

- Every package in the workspace (root and `verify/*`), direct or transitive

**Out of scope** (and which todo covers it)

- A routine upgrade of the SDK pins themselves (each SDK's next upgrade); CI automation (X1)

## Tasks

- [x] List the alerts (`pnpm audit --json`, or the Dependabot page) and map each to the harness that pulls it in
- [x] Upgrade each to the latest fixed release, bumping the direct dependency for transitive ones; use `pnpm.overrides` with a comment only when no fixed parent release exists
- [x] Run `pnpm check`, `pnpm typecheck`, `pnpm test`, and `pnpm run verify` for every affected harness
- [x] Record any change in doc-example results in that SDK's fact-check, and any alert accepted as unfixable in the harness README
- [x] Push, then confirm the alert count on GitHub

## Acceptance criteria

- [x] No open high alert without a recorded reason
- [x] All local checks and the affected harnesses' `verify` pass

## Tests

The existing harness suites.

## Docs to update

Affected harness READMEs and fact-checks.

## Risks and open questions

An SDK upgrade forced by a vulnerability can change doc-example results; record those changes in the fact-check rather than pinning to a vulnerable release.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

All 19 alerts came from the Cloudflare harness. Eighteen were in one copy of `undici@7.29.0`, pulled in through `just-bash@3.6.1` → `guarded-fetch@0.1.3`. No parent release fixes it, so a commented `pnpm-workspace.yaml` override pins `guarded-fetch>undici` to 7.30.2. Doc-example outcomes were unchanged, and all 9 behavioral examples pass. The last alert, `picomatch@4.0.7` (ReDoS), has no fixed release; it is accepted in `verify/cloudflare-agents/README.md` with the reason. `pnpm audit` went from 19 to 1. Prose: two README paragraphs, written to the writing rules.
