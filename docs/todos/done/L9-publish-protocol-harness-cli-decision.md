# L9: Decide to publish the protocol, harness and CLI packages

| Field | Value |
| --- | --- |
| ID | `L9` |
| Status | `done` |
| Plan | [Publish and docs §2, PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) |
| Round / milestone | Round L (publish and docs) |
| Depends on | None |
| Size | S |

## Goal

Record the owner's decision to publish `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli` to npm, together, in one release after N30 has given the CLI a working binary, and plan the two todos that carry it out.

## Context

- [PB1 to PB3](../../plans/publish-and-docs.md#2-decisions) and [ADR 0047](../../decisions/0047-first-release-and-trusted-publishing.md): what covers only the gateway and SDK today

## Scope

**In scope**

- ADR 0058, plan section PB4, and todos L10 and L11

**Out of scope** (and which todo covers it)

- Any change to a package, a workflow or npm (L10, L11)

## Tasks

- [x] Draft the ADR, the plan section and the two todos

## Acceptance criteria

- [x] Each claim is in the fact-check log (rows L9-1 to L9-16), and `pnpm check` passes

## Tests

`pnpm check` and `pnpm fact-check-logs`.

## Docs to update

ADR index, the publish plan, the roadmap.

## Risks and open questions

None.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`) in the last work commit, and the plan's todo table updated
- [ ] Two code-review rounds run on the pull request, with every finding fixed or explained in a commit message
- [ ] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed and the rubric scores in the pull request description

## Outcome

- [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md) records the decision, [PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) argues it, and [L10](../ready/L10-make-protocol-harness-cli-publishable.md) and [L11](../ready/L11-bootstrap-and-release-protocol-harness-cli.md) carry it out. The three packages publish together, after N30, in one fixed group of five with the gateway and SDK.
- The harness depends on the private `@buildanagent/agent-safety`, which no one has decided how to ship. The owner chooses, and L10's pack test enforces it.
- Unverified: how Changesets treats a private member of a fixed group (fact-check row L9-10).
