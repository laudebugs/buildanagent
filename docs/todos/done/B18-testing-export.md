# B18: Complete the `testing` exports: `autoResponder`, seam doubles, record and replay, mock server

| Field | Value |
| --- | --- |
| ID | `B18` |
| Status | `done` |
| Plan | [Build SDK §4, Stage 4](../../plans/build-sdk.md#44-stage-4-ships-telemetry-the-testing-exports-the-capstone-and-the-docs-checks) |
| Round / milestone | Round B (build SDK), M5 |
| Depends on | [B8](../done/B8-anthropic-adapter.md), [B9](../done/B9-openai-chat-adapter.md), [B15b](../done/B15b-continue-run.md) |
| Size | M |

## Goal

Finish the `testing` exports so users of the SDK, and the harness, can test agents offline with the same safety rules our verification harnesses learned.

## Context

- [agent-SDK guide §8](../../guides/agent-sdk.md#8-the-sdk-should-ship-a-strict-scripted-test-model-in-a-testing-export-from-the-first-release): five safety rules, record and replay at the normalised boundary
- [test strategy §5](../../plans/build-sdk.md#5-test-strategy)

## Scope

**In scope**

- `autoResponder()` with a default host-tool deny list matched by name (`bash`, `exec_command`, `shell`, `write`, `edit`, `delete`)
- `scriptedApprovals()` and scripted doubles for the approval and MCP seams, and `testSigner()`, which re-exports [E3](../done/E3-signed-approvals-third-party.md)'s fixed-key test signer (plan review 2, 2026-11-19)
- `recordPairs()` and `replayPairs()` at the normalised request and response boundary, stamped with SDK, provider and model versions and an expiry
- `startMockServer()` bound to 127.0.0.1, writing a JSONL request log

**Out of scope** (and which todo covers it)

- A sandbox double: the sandbox interface is P2's; add the double when P2 defines it

## Tasks

- [x] Synthesise tool arguments from JSON Schema as the existing mock does.
- [x] Reject replay of expired or mismatched stamps with a typed error.
- [x] Strip `authorization` and API-key headers from anything recorded.

## Acceptance criteria

- [x] `autoResponder()` never calls a tool on the deny list, even when it is the only tool offered (it answers in text instead)
- [x] A recorded run replays through `replayPairs()` to the same event log
- [x] An expired recording throws on replay
- [x] No recorded pair contains an `authorization` or `x-api-key` header
- [x] `startMockServer()` refuses to bind to a non-loopback address
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/sdk/test/testing-export.test.ts`, `packages/gateway/test/mock-server.test.ts`.

## Docs to update

`packages/sdk/README.md`: the testing guide. The plan's todo table in [build-sdk.md §4](../../plans/build-sdk.md#4-rounds-and-todos).

## Risks and open questions

Record and replay must never capture real credentials; the header strip is tested.

Recordings hold no `raw` provider events ([B11c](../ready/B11c-raw-provider-events.md)): they sit outside the normalized boundary, so the "same event log" check compares the log without them.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

Both `testing` exports are complete. The SDK's `@buildanagent/sdk/testing` adds `autoResponder()`, `synthesizeInput()`, `recordPairs()`, `replayPairs()`, `scriptedApprovals()`, `scriptedMcpServer()` and `testSigner()`, and the gateway's `@buildanagent/gateway/testing` adds `startMockServer()` and the credential strippers. The changesets are `.changeset/testing-export-sdk.md`, a `minor` bump that opens with "Breaking Changes" because `SdkErrorCode` and `ScriptStep` grow, and `.changeset/testing-export-gateway.md`, a `minor` bump.

Decisions:

- **Record and replay work on events, not on an `AssistantScript`.** A pair's response is a `StreamScript`, the call's normalised events from `start` to its terminal. `ScriptedModel` plays a `StreamScript` exactly as recorded, because an adapter's chunking and block order, such as parallel tool calls, can't be rebuilt from final content. `retry` events stay out, because a replay can't reproduce them, and so does any event outside the model spec, which covers [B11c](../ready/B11c-raw-provider-events.md)'s `raw` events once they exist. `usage.raw` is the provider's usage object, not an event, so it stays and replays unchanged.
- **The stamp is filled in by the recorder.** `recordPairs(model, { providerVersion, expiresAt, clock? })` takes only what it can't know, and stamps the SDK version and the model's API, provider, id and caps itself. The caps let the replay report the recorded model's limits when the catalog lacks it.
- **A replay refuses four kinds of drift.** It throws `RecordingError` for an expired recording, pairs whose stamps differ, a stamp field that differs from `expect`, and an SDK on another release line (the minor version under 0.x, the major from 1.0). A request that differs from the recorded one fails that call, and `ReplayModel.assertComplete()` rethrows the error with the first differing path. Requiring the exact SDK version would break every committed fixture on each alpha release.
- **Credentials are left out by name, at any depth.** `stripCredentials()` drops every property named `authorization`, `proxy-authorization`, `x-api-key`, `api-key`, `x-goog-api-key`, `cf-aig-authorization`, `cookie`, `set-cookie` or `apiKey`, compared without case, hyphens or underscores, from the request and the events. The mock server keeps the header names and writes `[redacted]` as their values, so a test can still see that a header was sent. The replay strips the incoming request the same way before it compares.
- **The deny list can grow but never shrink.** `denyTools` adds to `DEFAULT_DENIED_TOOLS`, and a string matches the whole name ignoring case.
- **`scriptedApprovals()` answers; the test's gate asks.** It wraps `blockingApprovals()`, so the real signing and verification run. An answer's `requestId` is optional, because a test can't know a generated id in advance.
- **`scriptedMcpServer()` builds plain frozen tool definitions.** It checks each namespaced name with the gateway's name rule and leaves the schema to `run()`, because `defineTool()` would load pi-schema into the testing export, and pi-schema 1.5.2's broken `source` condition would then fail the pack test for `@buildanagent/sdk/testing` too.
- **`startMockServer()` is the gateway's one Node-only module besides the guards.** It imports `node:http` when a server starts, so the testing export still loads on every target; `portability.test.ts` and [typescript.md](../../guidelines/typescript.md#shared-packages-are-portable-no-node-only-apis-in-src) list it. It binds only to 127.0.0.0/8 or `::1` (not `localhost`, whose address depends on the resolver), and its `transport` is marked as a mock and refuses any URL outside the server.
- **`testSigner()` comes from a vendored copy.** The safety package is still private, so `packages/sdk/src/vendor/agent-safety/testing.ts` is a byte-identical copy of its `testing.ts`, and the drift test covers it.

Each criterion and the test that covers it:

- Deny list: "autoResponder() answers in text when <name> is the only tool offered", once for each default name, plus the case-insensitive match, `denyTools` and the mixed-tools tests (`packages/sdk/test/testing-export.test.ts`).
- Same event log: "a run recorded on the Anthropic adapter replays through replayPairs() to the same event log" records a tool-calling run over `mockTransport()`, writes the pairs through JSON, replays them and compares the logs with `deepEqual`.
- Expiry: "an expired recording throws on replay".
- No credential: "no recorded pair contains an authorization or API-key header, or the key itself" checks a recording from the Anthropic adapter and one whose `providerOptions` carry six credential headers and an `apiKey`. "startMockServer() writes one JSON line per request and never writes the API key" and "startMockServer() serves a plain fetch client and redacts its authorization and cookie headers" (`packages/gateway/test/mock-server.test.ts`) cover the server.
- Loopback only: "startMockServer() refuses to bind to <host>" for `0.0.0.0`, `::`, `192.168.1.20`, `localhost` and `example.com` (`mock-server.test.ts`).
- Offline checks: `pnpm check`, `pnpm typecheck`, `pnpm test` and `node --test scripts/ci/*.test.mjs` pass from the repo root.

Left out: the sandbox double waits for P2's sandbox interface, as the scope says.
