# L9: Decide to publish the protocol, harness and CLI packages (three, then four with agent-safety)

| Field | Value |
| --- | --- |
| ID | `L9` |
| Status | `done` |
| Plan | [Publish and docs §2, PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) |
| Round / milestone | Round L (publish and docs) |
| Depends on | None |
| Size | S |

## Goal

Record the owner's decision to publish `@buildanagent/protocol`, `@buildanagent/harness` and `@buildanagent/cli` to npm (three, then four with `@buildanagent/agent-safety`; the Outcome addendum covers the change), together, in one release after N30 has given the CLI a working binary, and plan the two todos that carry it out.

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

- [x] Each claim is in the fact-check log (rows L9-1 to L9-35), and `pnpm check` passes

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

- [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md) records the decision, [PB4](../../plans/publish-and-docs.md#pb4-publish-the-protocol-harness-and-cli-packages-after-the-gateway-and-sdk-accepted) argues it, and [L10](../done/L10-make-protocol-harness-cli-publishable.md) and [L11](../done/L11-bootstrap-and-release-protocol-harness-cli.md) carry it out. The protocol, harness and CLI publish together, after N30, in one fixed group with the gateway and SDK (five members at the time; the addendum below makes it six).
- The harness depends on `@buildanagent/agent-safety`, which was private; the owner decided the same day to publish it too (see the addendum), and L10's pack test enforces that no package that will publish depends on one outside the six.
- Unverified: how Changesets treats a private member of a fixed group (fact-check row L9-10).
- Addendum (2026-11-22, after the pull request opened):
  - **agent-safety.** The owner decided to publish `@buildanagent/agent-safety` too ("yes, we're publishing agent-safety too") as a sixth member of the fixed group. That answers the harness's dependency, and [ADR 0058](../../decisions/0058-publish-protocol-harness-and-cli.md) decision 9 records it.
  - **Placeholders.** The owner published placeholders of the protocol, harness, CLI and agent-safety by hand. `npm view` at about 15:00 UTC listed them with neither version deprecated. The owner then deprecated them, and by about 15:15 UTC every version printed the message (row L9-43); L11 re-verifies it before the release.
  - **Release plan.** The pull request's medium review changed the plan: the new `release.yml` lands in the same merge as L11, L11's `release-plan.mjs` change has a defined version source, and the unverified fixed-group behaviour is a hard gate in L10 with a fallback in L11.
