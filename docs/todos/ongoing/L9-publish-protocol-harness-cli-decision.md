# L9: Decide to publish the protocol, harness and CLI packages

| Field | Value |
| --- | --- |
| ID | `L9` |
| Status | `ongoing` |
| Plan | [Publish and docs §2, PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) |
| Round / milestone | Round L (publish and docs) |
| Depends on | None |
| Size | S |

## Goal

Record the owner's decision to publish `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli` to npm, in that order, after the gateway and SDK, and plan the two todos that carry it out.

## Context

- [PB1 to PB3](../../plans/publish-and-docs.md#2-decisions) and [ADR 0047](../../decisions/0047-first-release-and-trusted-publishing.md): what covers only the gateway and SDK today

## Scope

**In scope**

- ADR 0058, plan section PB4, and todos L10 and L11

**Out of scope** (and which todo covers it)

- Any change to a package, a workflow or npm (L10, L11)

## Tasks

- [ ] Draft the ADR, the plan section and the two todos

## Acceptance criteria

- [ ] Each claim is in the fact-check log, and `pnpm check` passes

## Tests

`pnpm check` and `pnpm fact-check-logs`.

## Docs to update

ADR index, the publish plan, the roadmap.

## Risks and open questions

None.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description
