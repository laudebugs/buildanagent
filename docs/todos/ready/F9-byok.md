# F9: BYOK through the user's AI Gateway, the encrypted-key fallback, and a no-fallback test

| Field | Value |
| --- | --- |
| ID | `F9` |
| Status | `ready` |
| Plan | [Build agent platform §5.1](../../plans/build-agent-platform.md#51-stage-f-a-builds-everything-that-needs-no-engine) |
| Round / milestone | Round F (build the agent platform), M8 |
| Depends on | [F1](F1-platform-tenancy.md), [F7](F7-cloudflare-connection-and-deploy.md) |
| Size | M |

## Goal

Make every model call, at build time and at run time, use the user's own key, with no path to a key of ours (PF7).

## Context

- [PF7](../../plans/build-agent-platform.md#pf7-the-users-own-model-key-with-no-fallback-to-ours-accepted-adr-0040) and [ADR 0040](../../decisions/0040-tenant-cloud-connections-and-byok.md).
- [Authenticated Gateway](https://developers.cloudflare.com/ai-gateway/configuration/authentication/) and [BYOK](https://developers.cloudflare.com/ai-gateway/configuration/bring-your-own-keys/).

## Scope

**In scope**

- The gateway-token path with `byok_only` on
- The encrypted-key path, added only at egress
- Writing the deployed agent's key reference into the user's secret store

**Out of scope**

- Billing (F13)

## Tasks

- [ ] Guide the user to create a gateway, store the provider key in their Secrets Store and turn on `byok_only`.
- [ ] Store only the gateway's `Run` token, encrypted.
- [ ] Implement the encrypted-key path through the egress route.
- [ ] Add a test that a failed BYOK call ends in an error.

## Acceptance criteria

- [ ] No platform model key exists in any configuration.
- [ ] A failed BYOK call never retries on another key.

## Tests

Offline tests against a recorded gateway; a configuration scan for platform keys.

## Docs to update

Platform docs for BYOK setup.

## Risks and open questions

None.

## Revision (2026-11-18, SDK gaps)

Gap 7 of the [close-sdk-gaps plan](../../plans/close-sdk-gaps.md#3-each-gap-the-todos-that-cover-it-and-what-changes) adds a test for the silent fallbacks the research found. Add:

- [ ] Every generated agent builds its providers with [E6](E6-byok-no-fallback.md)'s `explicitProvider()`, and the gate fails a project whose deploy configuration leaves Cloudflare AI Gateway's `byok_only` off or routes any model call through Vercel AI Gateway. Vercel's "Fallback to Vercel Keys" is a team dashboard setting that no deploy configuration records, so the gate cannot check it ([ADR 0040](../../decisions/0040-tenant-cloud-connections-and-byok.md): Vercel AI Gateway is not used for tenant calls unless its fallback is off).

The owner chose on 2026-11-18 to refuse Vercel AI Gateway outright for generated agents' model calls ([SG4](../../plans/close-sdk-gaps.md#sg4-generated-agents-model-calls-never-go-through-vercel-ai-gateway-accepted)). That narrows [ADR 0040](../../decisions/0040-tenant-cloud-connections-and-byok.md), whose attested-setting path this todo does not implement for model calls. **Follow-up when this todo starts:** write a short ADR that amends 0040 to record the narrowing.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
