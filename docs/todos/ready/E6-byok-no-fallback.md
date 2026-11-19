# E6: BYOK with no silent fallback: explicit keys, an egress assertion and gateway settings

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E6` |
| Status | `ready` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E1](../ongoing/E1-safety-core-outcomes.md) |
| Size | S |

## Goal

Make sure every model call made by an agent on our package carries the user's own key and nothing else, and fails instead of quietly using another credential (gap 7). The AI SDK has three silent paths in 7.0.162: a provider reads its key from the environment when none is passed, it reads its base URL from the environment when none is passed, and a string model id routes through Vercel AI Gateway with `AI_GATEWAY_API_KEY` or a Vercel OIDC token. Vercel AI Gateway also falls back to Vercel's own billed keys by default. The user chose none of these.

## Context

- The AI SDK's provider pages in our mirror: the Anthropic and OpenAI providers' `apiKey` setting "defaults to the `ANTHROPIC_API_KEY` environment variable" and "defaults to the `OPENAI_API_KEY` environment variable" (`docs/reference/vercel-ai-sdk/source/content/providers/01-ai-sdk-providers/05-anthropic.mdx` and `03-openai.mdx`). The pinned builds also read `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` when `baseURL` is omitted, and `ai` resolves a string model id through `globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway` ([fact-check rows 41–43](../../plans/reviews/fact-check-close-sdk-gaps.md)).
- Cloudflare's [Unified Billing page](https://developers.cloudflare.com/ai-gateway/features/unified-billing/) (fetched 2026-11-18): the dashboard setting **Require provider credentials**, `byok_only: true` in the gateway update API, and the per-request `cf-aig-no-wholesale: true` header, which "cannot relax the gateway setting".
- Vercel's [BYOK page](https://vercel.com/docs/ai-gateway/authentication-and-byok/byok) (fetched 2026-11-18): **Fallback to Vercel Keys** is a team setting on the AI Gateway Settings tab, "on by default".
- [Agent-building platforms report, BYOK](../../research/deployment/agent-building-platforms.md#no-platform-deploys-a-built-agent-to-cloudflare-or-vercel-and-byo-key-usually-carries-a-markup): Vercel's default-on fallback and Cloudflare's opt-in `byok_only`.
- [ADR 0040](../../decisions/0040-tenant-cloud-connections-and-byok.md): every model call on the user's own key, with no fallback.
- [build-sdk.md §3.2](../../plans/build-sdk.md#32-gateway-api): our gateway takes an explicit `ProviderConfig.apiKey` and no ambient credentials.

## Scope

**In scope**

- `explicitProvider()`: builds `@ai-sdk/anthropic` and `@ai-sdk/openai` providers only from a key and a base URL the caller passes, and refuses an empty one
- `egressGuard()`: a `fetch` wrapper that allows model requests only to the configured host and only with the configured credential header, and adds `cf-aig-no-wholesale: true` to every Cloudflare AI Gateway request
- `assertNoDefaultProvider()`: fails when code resolves a string model id, so no call reaches Vercel AI Gateway by default
- A settings checker for Cloudflare AI Gateway's `byok_only`, and a rule that refuses Vercel AI Gateway routes

**Out of scope** (and which todo covers it)

- Storing tenants' keys (F9)
- Our own gateway (the revision to B4)

## Design notes

`explicitProvider({ provider, apiKey, baseURL })` passes both values to the provider factory and a custom `fetch` from `egressGuard`. The guard rejects a request to any other host, a request whose credential header differs from the configured key, and a request with no credential header. For Anthropic through Cloudflare AI Gateway, the key travels in `x-api-key`, because the gateway does not treat `Authorization: Bearer` as provider credentials on that endpoint. The settings checker reads the gateway configuration the deploy step produces and fails the deploy if `byok_only` is not `true`. Vercel's fallback setting lives in the team dashboard and appears in no deploy configuration, so the checker cannot verify it; following ADR 0040, the package refuses any Vercel AI Gateway route instead.

## Tasks

- [ ] Write `explicitProvider()` and `egressGuard()`.
- [ ] Write the tests below with an environment that sets decoy keys for both providers.
- [ ] Write the checker against the setting names recorded in Context, and re-read both pages on the day the todo starts.

## Acceptance criteria

- [ ] With decoy `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN` set in the test environment, every recorded request carries only the user's key; a decoy value appearing in any request fails the test.
- [ ] With decoy `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` set, every request still goes to the configured host.
- [ ] A `generateText` call with a string model id fails before any request.
- [ ] Every request to a Cloudflare AI Gateway host carries `cf-aig-no-wholesale: true`.
- [ ] `explicitProvider` with an empty or missing key throws before any request.
- [ ] A request to a host other than the configured one is refused by the guard.
- [ ] The settings checker fails a configuration with `byok_only` absent or `false`, and refuses any configuration that routes calls through Vercel AI Gateway.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/byok.test.ts`, using a recording transport; no request leaves the machine.

## Docs to update

The package README (the BYOK rule in one paragraph, and the two gateway settings).

## Risks and open questions

- A gateway's setting names can change; the checker records the docs date it was written against and fails on an unknown field, rather than passing.
- Refusing Vercel AI Gateway outright is stricter than ADR 0040, which allows it once the fallback is off. The owner chose the refusal on 2026-11-18 ("Refuse it", [SG4](../../plans/close-sdk-gaps.md#sg4-generated-agents-model-calls-never-go-through-vercel-ai-gateway-accepted)): no API documents the team setting, so an attestation cannot be checked, and ADR 0040's attested-setting path is not used for generated agents' model calls. Allowing the gateway later needs a way to read that setting and a new owner decision.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
