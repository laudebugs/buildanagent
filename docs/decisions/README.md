# Decision records

Each file records one lasting decision: what we chose, why, and what follows from it. Plans make the decisions and give the full options and evidence; a record here keeps the outcome findable after the plan is done.

## Format

- **Name:** `NNNN-kebab-title.md`, numbered in order of creation. Numbers are never reused.
- **Header:** a title that states the decision, then **Status**, **Date** and a **Plan** link to the section that argues it.
- **Status:** `Proposed` (written, not yet reviewed), `Proposed — owner to confirm` (needs the owner's call), `Accepted` (reviewed in P4 or confirmed by the owner), or `Superseded by NNNN`. A record marked provisional names the todo whose check can change it.
- **Sections:** Context (the question and the evidence, in a few sentences), Decision (what we chose), Consequences (what changes, what follows, and who acts).
- **Changes:** never rewrite an accepted record. Write a new one and mark the old one superseded.

## Index

| ADR | Decision | Status | Plan |
| --- | --- | --- | --- |
| [0001](0001-two-packages-gateway-and-sdk.md) | Ship the SDK as two packages, a gateway and a loop, under `packages/` | Proposed | [D1](../plans/build-sdk.md#d1-two-packages-because-the-gateway-has-consumers-that-never-run-the-loop) |
| [0002](0002-first-wire-protocols.md) | Build Anthropic Messages and OpenAI-compatible Chat Completions adapters first, on plain `fetch` | Proposed — owner to confirm | [D2](../plans/build-sdk.md#d2-anthropic-messages-and-openai-compatible-chat-completions-first-owner-to-confirm) |
| [0003](0003-token-usage-fields.md) | Store four token classes, and name the uncached field `uncachedInput` | Proposed | [D3](../plans/build-sdk.md#d3-usage-stores-four-token-classes-and-the-uncached-field-says-so-in-its-name) |
| [0004](0004-cost-catalog-and-basis.md) | Price usage from a versioned catalog, let a billed total win, and block budgeted runs on unknown prices | Proposed | [D4](../plans/build-sdk.md#d4-prices-come-from-a-versioned-catalog-and-a-provider-billed-total-overrides-it) |
| [0005](0005-approval-signing.md) | Sign pauses with a pluggable, key-id signer, default to an ephemeral key, and never accept an unsigned resume | Proposed — owner to confirm (with P2) | [D5](../plans/build-sdk.md#d5-a-pluggable-signer-with-key-ids-an-ephemeral-default-and-no-unsigned-resume-owner-to-confirm-with-p2) |
| [0006](0006-interceptor-names.md) | Name the six interceptors by model and tool moment, and keep run-level hooks as observers | Proposed | [D6](../plans/build-sdk.md#d6-our-six-moment-named-interceptors-with-run-level-hooks-as-observers) |
| [0007](0007-json-schema-validator.md) | Validate raw JSON Schema with pi-schema 1.5.2, supporting drafts 2020-12 and 7 | Proposed (provisional until todo B10) | [D7](../plans/build-sdk.md#d7-pi-schema-validates-raw-json-schema-and-b10-confirms-the-choice-against-both-candidates-provisional) |
| [0008](0008-versioning-and-doc-checks.md) | Start at 0.x with marked breaking changes, and fail CI on undocumented exports and on stale doc names | Proposed — owner to confirm | [D8](../plans/build-sdk.md#d8-0x-with-a-changelog-that-marks-breaking-changes-and-two-export-diffs-in-ci-owner-to-confirm) |
| [0009](0009-pre-emptive-budget.md) | Check the USD budget before each model call, against a projected cost | Proposed | [D9](../plans/build-sdk.md#d9-the-usd-cap-is-checked-before-each-model-call-against-a-projected-cost) |
| [0010](0010-run-outcomes.md) | Return run outcomes as a discriminated union, and offer `runOrThrow()` for typed errors | Proposed | [D10](../plans/build-sdk.md#d10-a-discriminated-result-union-plus-runorthrow-for-callers-who-want-exceptions) |
| [0011](0011-tool-name-rule.md) | Check canonical tool names against `^[A-Za-z0-9_-]{1,64}$`, and sanitise reversibly per adapter | Proposed (provisional until todo B7) | [D12](../plans/build-sdk.md#d12-a-per-adapter-name-table-first-then-a-canonical-rule-and-reversible-sanitising-provisional) |
| [0012](0012-harness-packages.md) | Ship the harness as four packages: protocol, harness with one subpath per component, CLI and evals | Proposed | [HD13](../plans/build-harness.md#hd13-four-packages-with-one-subpath-export-per-removable-component) |
| [0013](0013-log-entry-per-content-block.md) | Write one session-log entry per content block, from the SDK's end events, and never persist deltas | Proposed (provisional until todo N35) | [HD1](../plans/build-harness.md#hd1-one-entry-per-content-block-written-from-the-sdks-end-events-provisional) |
| [0014](0014-session-writer-lock.md) | Guard each session with an exclusive lock file and a renewed lease, on local disk only | Proposed (provisional until todo N4) | [HD2](../plans/build-harness.md#hd2-a-lock-file-with-a-renewed-lease-on-local-disk-only-provisional) |
| [0015](0015-harness-approval-key-ring.md) | Have the harness always sign pauses with a persistent, host-only key ring, and make every approval a pause first | Proposed — owner to confirm (with ADR 0005) | [HD5](../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-owner-to-confirm-with-sdk-d5) |
| [0016](0016-protocol-json-rpc-framing.md) | Frame the harness protocol as strict JSON-RPC 2.0, with the `jsonrpc` field and twelve v1 client methods | Proposed | [HD6](../plans/build-harness.md#hd6-strict-json-rpc-20-with-the-jsonrpc-field-and-twelve-v1-methods) |
| [0017](0017-telemetry-convention-pin-and-cost-attributes.md) | Pin semconv-genai at `d28355d`, and name cost attributes in our own namespace | Proposed | [HD7](../plans/build-harness.md#hd7-pin-semconv-genai-d28355d-and-name-cost-in-our-own-namespace-with-sdk-d3) |
| [0018](0018-retention-and-transcript-schema.md) | Keep transcripts until a retention period is set, and keep the entry base stable per format version | Proposed — owner to confirm | [HD11](../plans/build-harness.md#hd11-keep-transcripts-until-the-owner-sets-a-retention-period-and-keep-the-entry-base-stable-owner-to-confirm) |
| [0019](0019-permission-pipeline-and-approval-modes.md) | Order the permission pipeline deny-first, offer three middle-ground approval modes, and confine classifier allows to the host callback | Proposed | [HD12](../plans/build-harness.md#hd12-three-middle-ground-modes-and-no-classifier-allow-outside-the-host-callback) |
| [0020](0020-default-sandbox-backend.md) | Default to `srt` for interactive runs and Docker for headless runs, and run `none` only on an explicit unsafe flag | Proposed — owner to confirm (after todo N19) | [HD4](../plans/build-harness.md#hd4-srt-for-interactive-runs-and-docker-for-headless-runs-owner-to-confirm) |
| [0021](0021-mcp-client-base.md) | Build the MCP client on `@modelcontextprotocol/client` 2.4.0, behind our own `McpConnection` interface | Proposed (provisional until todo N24) | [HD14](../plans/build-harness.md#hd14-build-the-mcp-client-on-modelcontextprotocolclient-240-provisional) |
