# F5: `@buildanagent/agent-safety` with adapters for `agents` 0.33.0 and `ai` 7.0.162

> **On hold (owner, 2026-11-19): do not start until the owner says go.** The owner lifted the build hold for the SDK, harness and Round E only ([roadmap](../../plans/roadmap.md)).

| Field | Value |
| --- | --- |
| ID | `F5` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [E7](../done/E7-safety-portability.md) |
| Size | M |

## Goal

Release `@buildanagent/agent-safety`, which Round E builds, for the generation templates (F6): every generated agent imports its signed approvals, effect identity and typed outcomes (PF5).

## Context

- [PF5](../../plans/build-agent-platform.md#pf5-one-safety-package-inside-every-generated-agent-proposed).
- [Close-sdk-gaps plan](../../plans/close-sdk-gaps.md) and [ADR 0043](../../decisions/0043-standalone-safety-core.md) (accepted): Round E (E1–E7) builds the package this todo releases.
- [SG3](../../plans/close-sdk-gaps.md#sg3-a-write-reports-one-of-five-outcomes-and-unknown-is-never-retried-with-a-fresh-key-accepted): the five outcome kinds.
- [Cloudflare skill](../../../.agents/skills/cloudflare-agents/SKILL.md) and [Vercel AI SDK skill](../../../.agents/skills/vercel-ai-sdk/SKILL.md): each SDK's approval gate.

## Scope

**In scope**

- A versioned README for template authors: the root export, the `./ai` and `./agents` subpaths, and how a template passes a persistent key ring
- The exact `ai` 7.0.162 and `agents` 0.33.0 peer pins, attached to the `./ai` and `./agents` subpaths (optional peers), so the root export stays free of them
- A changelog and the release version the templates pin

**Out of scope**

- Compensation logic for specific tools (per generated agent)
- The guarantees themselves, built in Round E: the five outcomes `applied`, `not_applied`, `compensated`, `partial` and `unknown` (E1), effect identity (E2), the signer (E3), plan approvals (E4a, E4b), the cost guard (E5), the BYOK guard (E6) and the stores (E7)

## Tasks

- [ ] Check that E7 is done and the package's full suite passes in Node and workerd.
- [ ] Write the README for template authors and the changelog.
- [ ] Confirm the exact peer pins on `./ai` and `./agents`, re-pinning under ADR 0038 if either SDK has moved.
- [ ] Tag the version F6's templates import.

## Acceptance criteria

- [ ] An unsigned or tampered resume is refused on both SDKs (E3's tests, rerun here).
- [ ] A replayed write with the same key does not run twice (E2's and E7's tests, rerun here).
- [ ] A template that imports only the root export installs without `ai` or `agents`.

## Tests

Offline tests on each SDK's mock model.

## Docs to update

The package README.

## Risks and open questions

Both SDKs move; the package pins exact versions (ADR 0038).

## History

The SDK-gaps revision of 2026-11-18 moved this todo's build scope into Round E and its **Depends on** from B15 to [E7](../done/E7-safety-portability.md); plan review 2 (2026-11-19) folded it into the sections above, with five outcomes per SG3 and the signer from E3.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
