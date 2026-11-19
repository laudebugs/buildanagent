# E6: BYOK with no silent fallback: explicit keys, an egress assertion and gateway settings

> **History:** the owner held Round E on 2026-11-19 ("Approve plan, don't start yet") and lifted the hold the same day ("Lift hold on all of E"), so this todo starts once its **Depends on** are done ([SG2](../../plans/close-sdk-gaps.md#sg2-round-e-may-start-before-round-b-after-b1-and-b5-accepted-hold-lifted)).

| Field | Value |
| --- | --- |
| ID | `E6` |
| Status | `done` |
| Plan | [Close SDK gaps §4](../../plans/close-sdk-gaps.md#4-round-e-and-its-todos) |
| Round / milestone | Round E (close the SDK gaps), M5e |
| Depends on | [E1](../done/E1-safety-core-outcomes.md) |
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

- [x] Write `explicitProvider()` and `egressGuard()`.
- [x] Write the tests below with an environment that sets decoy keys for both providers.
- [ ] Write the checker against the setting names recorded in Context, and re-read both pages on the day the todo starts.

## Acceptance criteria

- [x] With decoy `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN` set in the test environment, every recorded request carries only the user's key; a decoy value appearing in any request fails the test.
- [x] With decoy `ANTHROPIC_BASE_URL` and `OPENAI_BASE_URL` set, every request still goes to the configured host.
- [x] A `generateText` call with a string model id fails before any request.
- [x] Every request to a Cloudflare AI Gateway host carries `cf-aig-no-wholesale: true`.
- [x] `explicitProvider` with an empty or missing key throws before any request.
- [x] A request to a host other than the configured one is refused by the guard.
- [x] The settings checker fails a configuration with `byok_only` absent or `false`, and refuses any configuration that routes calls through Vercel AI Gateway.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/agent-safety/test/byok.test.ts`, using a recording transport; no request leaves the machine.

## Docs to update

The package README (the BYOK rule in one paragraph, and the two gateway settings).

## Risks and open questions

- A gateway's setting names can change; the checker records the docs date it was written against and fails on an unknown field, rather than passing.
- Refusing Vercel AI Gateway outright is stricter than ADR 0040, which allows it once the fallback is off. The owner chose the refusal on 2026-11-18 ("Refuse it", [SG4](../../plans/close-sdk-gaps.md#sg4-generated-agents-model-calls-never-go-through-vercel-ai-gateway-accepted)): no API documents the team setting, so an attestation cannot be checked, and ADR 0040's attested-setting path is not used for generated agents' model calls. Allowing the gateway later needs a way to read that setting and a new owner decision.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`@buildanagent/agent-safety` now keeps every AI SDK model call on the key the caller passes, and fails before sending when a call would use any other credential. The third-party claims behind it are rows E6-1 to E6-13 of [the plan's fact-check log](../../plans/reviews/fact-check-close-sdk-gaps.md). The code-review rounds and the writing review run on the pull request after this commit.

The public API:

- **Root entry, with no third-party import:** `egressGuard()`, with its `EgressGuardOptions`, `EgressCredential` and `CredentialHeader` types and the `CREDENTIAL_HEADERS` and `CLOUDFLARE_NO_WHOLESALE_HEADER` constants; `checkModelRoutes()`, with `ModelRoutesConfig`, `ModelRoute`, `CloudflareAiGatewaySettings`, `ModelRoutesReport`, `ModelRouteProblem`, `ModelRouteProblemCode` and `MODEL_ROUTE_SETTINGS_AS_OF`; and `CLOUDFLARE_AI_GATEWAY_HOST`.
- **New `./byok` subpath:** `explicitProvider()` and `assertNoDefaultProvider()`. It imports `@ai-sdk/anthropic` 4.0.96 and `@ai-sdk/openai` 4.0.108, which join the optional peers.
- **`SafetyError` codes:** `invalid_byok_config`, `egress_refused` and `default_provider`.

Each criterion and the test in `test/byok.test.ts` that covers it:

- Decoy keys: `beforeEach` sets all six decoys, and every recording test runs `assertNoDecoys()` over each request's URL, headers and body. Two control tests show the decoys are live: providers built without settings send the decoy key and host, and a string model id sends the decoy `AI_GATEWAY_API_KEY` to `ai-gateway.vercel.sh`.
- Decoy base URLs: the Anthropic and OpenAI tests assert each request's exact URL on the configured host.
- String model id: "after assertNoDefaultProvider, a generateText call with a string model id fails before any request", which also covers `streamText`, plus the `prepareStep` test.
- `cf-aig-no-wholesale: true`: both providers through a Cloudflare AI Gateway endpoint, and a guard test that overwrites a `false` value.
- Empty or missing key: five bad keys for each provider throw `invalid_byok_config`, and the recorder stays empty.
- Another host: six URLs outside the base URL, and a `Request` to Vercel AI Gateway, are refused with `egress_refused`.
- Settings checker: three tests cover `byok_only` absent, false or not a boolean, Vercel AI Gateway routes, and unknown fields.

Judgement calls:

- **The re-read of both gateway pages could not happen.** `developers.cloudflare.com` and `vercel.com` are outside this session's network allowlist, so the checker rests on the 2026-11-18 reads (rows 44 and 45), records that date as `MODEL_ROUTE_SETTINGS_AS_OF`, and row E6-12 is ⚠️. The third task stays unticked until someone re-reads them.
- **The checker reads our own route record**, `{ routes: [{ provider, baseURL, cloudflareAiGateway?: { byok_only } }] }`, not Cloudflare's full gateway object. No deploy step exists yet, and an unknown-field rule over Cloudflare's whole API object would need its schema, which this session could not fetch. F9's deploy step produces this record.
- **The guard checks more than the host:** the origin, the base URL's path prefix, the configured credential header's exact value, and the absence of every other credential header. It never follows a redirect, because Node 22's `fetch` forwards `x-api-key` across origins (row E6-10).
- **Base URLs must use https**, except on a loopback host, and must not carry a user name, password, query or fragment.
- **`assertNoDefaultProvider()` throws when another default provider is set**, rather than replacing it, so a deliberate setting elsewhere surfaces instead of vanishing.
- **`explicitProvider()` takes no `headers` option**, because Anthropic's provider spreads caller headers over its own `x-api-key` (row E6-8).
- **Authenticated Cloudflare gateways and stored BYOK keys are out of scope.** The guard refuses `cf-aig-authorization`, so a gateway with authentication on, or one that holds the provider key itself, needs a follow-up option, which belongs with F9.
- **The SDK's vendored `errors.ts`** follows the new codes, with an empty changeset, because the SDK exports no `SafetyError` (row E6-13).
- **A flaky book test:** `apps/manual`'s "book:switch-report runs on the real book and exits 0" timed out at its 5-second limit twice while the machine's load average was near 18, and passed on a rerun at a load near 7. The script exits 0 in about 4.7 seconds under load, and this change touches nothing it reads.
