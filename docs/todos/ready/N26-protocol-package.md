# N26: Protocol package: the typed union, framing and the generated JSON Schema

| Field | Value |
| --- | --- |
| ID | `N26` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N2](N2-session-entries-schema.md), [B11](../done/B11-loop-core.md), [B15](../done/B15-signed-pauses.md) |
| Size | M |

## Goal

Define the harness protocol once, as a discriminated TypeScript union with strict JSON-RPC 2.0 framing, a JSONL framer that is safe for U+2028, and a generated JSON Schema that other-language clients can use alone.

## Context

- [HD6](../../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods): the decision and its evidence
- [ADR 0016](../../decisions/0016-protocol-json-rpc-framing.md): the decision records
- [harness guide §8](../../guides/agent-harness.md#8-one-typed-protocol-should-sit-under-the-sdk-cli-and-rpc-interfaces-with-stdio-jsonl-as-the-first-remote-transport): one union, `jsonrpc`, framing rules
- [build-harness.md §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the API sketch

## Scope

**In scope**

- `ClientCommand`, `InitializeResult`, `Disposition`, `ServerRequest`, `ServerNotification`, `HarnessEvent`, `ErrorCodes`
- `JsonlFramer` splitting on `\n` only, with a maximum line size
- `encode()` and `decode()` that validate `jsonrpc: "2.0"`
- `schema/protocol.schema.json`, generated and committed, with a staleness test
- Fixtures for every message, validated against the schema and type-checked with `satisfies`

**Out of scope** (and which todo covers it)

- The dispatcher (N27)

## Tasks

- [ ] Pin the JSON Schema generator as an exact dev dependency at least a week old (shared with N2).
- [ ] Declare `@buildanagent/gateway` and `@buildanagent/sdk` as `dependencies` used for types only; `ContentBlock`, `AgentEvent` and `SignedPendingRequest` come in as type-only imports, and `SessionEntry` is the package's own (N2).

## Acceptance criteria

- [ ] A JSON string containing U+2028 and U+2029 round-trips through the framer
- [ ] A message without `jsonrpc` is rejected with the JSON-RPC invalid-request code
- [ ] Every fixture validates and type-checks in both directions
- [ ] The emitted JavaScript of `@buildanagent/protocol` imports nothing outside the package (a test scans `dist/` for import specifiers)
- [ ] `@buildanagent/protocol` declares no dependency on `@buildanagent/harness`, so the workspace graph has no cycle
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/protocol/test/framing.test.ts`, `schema.test.ts`, `fixtures.test.ts`.

## Docs to update

`packages/protocol/README.md`: the method list and framing rules. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None open. P4 moved the entry union into this package (R2), so the protocol never imports the harness.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
