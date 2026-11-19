# Plan: build our agent SDK as two workspace packages, a gateway and a loop, in 22 todos tested offline against a scripted model

- **Status:** Draft (P1, 2026-11-18), revised on 2026-11-18 with the fixes from the [P4 review](reviews/plan-review.md), and on 2026-11-18 for three deployment targets: notes in D5 and D7, and tasks added to B10 and B17 ([ADR 0033](../decisions/0033-three-deployment-targets.md)). Revised on 2026-11-19 (plan review 2) to apply [ADR 0043](../decisions/0043-standalone-safety-core.md) and the [close-sdk-gaps plan](close-sdk-gaps.md): the signer, the input hash and the pending record now come from `@buildanagent/agent-safety`, the cost projection from the gateway, and Round E feeds B10, B14 and B15.
- **Date:** 2026-11-18
- **Asked for by:** the project owner (2026-11-18), through the [implementation plans](implementation-plans.md#2-what-each-plan-contains)
- **Builds on:** the [agent-SDK guide][g] (G1b), its [reference architecture][g11] and its [twelve open decisions][g12], plus the six seams that the [harness guide §1][hg1] needs from the SDK
- **Decision records:** [ADRs 0001–0011](../decisions/README.md), and [ADR 0043](../decisions/0043-standalone-safety-core.md) (accepted, owner, 2026-11-18), which the [close-sdk-gaps plan](close-sdk-gaps.md) applies to D5, D9 and §3
- **Todos:** Round B ("build SDK") on the [todo board](../todos/README.md); §4 lists them.

The [agent-SDK guide][g] already settles the design: one in-process loop as a pure streaming function over a versioned single-method model gateway, every failure and pause returned to the caller as data, and a strict scripted test model shipped from the first release. The guide still left twelve decisions open, ranging from the package split to the tool-name rule ([guide §12][g12]). The harness plan (P2) will also build on this SDK through six seams, so any gap here becomes a workaround there ([harness guide §1][hg1]). This plan makes the twelve decisions and turns the reference architecture into two packages and 22 todos, each one reviewable batch with checkable acceptance criteria. It also gives the test strategy that keeps every todo offline. Nine decisions follow from the evidence, and the owner accepted the other three, D2, D5 and D8, on 2026-11-18 (§2). In one sentence: **build the gateway and the scripted test model first, then the loop, tools, hooks and pauses on top of them, and finish with a triage capstone that passes the same contract the eight reference capstones pass, so P2 can start on stable seams.**

## 1. Goal and non-goals

**Goal.** At the end of Round B, `@buildanagent/gateway` and `@buildanagent/sdk` build, type-check and pass `pnpm test` offline in this workspace. Together they implement the six components of the [reference architecture][g11]: the gateway, the loop, the tool runtime, the hook bus with its OTel observer, the closed event stream, and the `testing` exports. A triage capstone written against them meets the contract that every reference capstone meets ([deep comparison §1][dc-same]). Every component stays removable, as [AGENTS.md](../../AGENTS.md#planned-architecture-when-code-starts) requires.

The goal covers every recommendation in the guide's design sections, §2 to §10. The table maps each section to the todos that build it:

| Guide section | Recommendation | Todos |
| --- | --- | --- |
| [§2 Gateway][g2] | one versioned `stream()`, canonical transcript, in-band errors, three retry layers, usage and cost on every message, one caching policy, a full-request dump, a per-subagent model setting and no router; the frozen system prompt persists in the harness's `turn_start` entry ([harness plan §3.2][har-32]) | B2, B4, B5, B6, B8, B9 |
| [§3 Loop][g3] | one pure streaming function, `continueRun()`, a 20-call cap and a USD cap, stop reasons, progress detection, well-formed aborts, steering at step boundaries | B11, B14, B16 |
| [§4 Tools][g4] | Standard Schema or validated JSON Schema, the fixed pipeline, errors as data with a "do not substitute a mock" line, opt-in error redaction per tool, nulls stripped after strict lowering, truncation failure, parallel by default, three result channels, kinds and exposure | B7, B8, B9, B10, B12 |
| [§5 Events][g5] | one closed, layered union whose `*_end` events carry the authoritative item, raw events opt-in, an emitted-against-declared check, OTel `gen_ai.*` spans with content off | B11, B17 |
| [§6 Hooks][g6] | six typed interceptors and separate observers, one event object, fail-closed gates, gateway middleware | B4, B13 |
| [§7 Pauses][g7] | `awaiting_approval` as a signed log state, a blocking wrapper that writes first, a documented no-handler outcome, a clarification pause | B15, B15b |
| [§8 Testing][g8] | `ScriptedModel`, `autoResponder` with a host-tool deny list, chunked streams, seam doubles, mock transports, `allowModelRequests(false)`, stable `clock`, `idGenerator` and `random`, record and replay at the normalised boundary | B3, B18 |
| [§9 Public API][g9] | functions with options objects, an explicit provider, nothing outward by default, typed errors with `isInstance`, a readable reference loop | B4, B11, B19b |
| [§10 Versioning and docs][g10] | the four versioning rules, defaults and prompts versioned too, a defaults hash on `run_start`, docs and `llms.txt` from the release tag, compiled examples, two export diffs | B20 |

**Non-goals.** These belong to other plans or to later work, each for a stated reason:
- **The session log, its store, compaction layers, the permission pipeline, sandboxing, the MCP client and registry, tool search, and the CLI, RPC and server interfaces.** They belong to the harness plan (P2) ([guide §1][g1]; [harness research §7][har7]). This plan builds only the seams they plug into (§3.4).
- **Evals and the Inspect bridge.** The harness owns the eval machinery; the SDK's share is the base-URL and transport override ([guide §8][g8]).
- **A durable-engine adapter (Temporal and similar).** The guide keeps durable engines as adapters over the log, and the per-tool `execution` setting is the only hook they need now ([guide §3][g3]). The adapter needs the harness's log, so it waits for P2.
- **Adapters beyond the first two wire protocols**, including OpenAI Responses. Decision D2 defers them, with a reason.
- **An automatic per-request model router.** Practitioners report that switching models mid-session busts the cache, so the gateway offers a per-subagent model setting instead ([guide §2][g2]; [HN §4.1][hn41]).
- **Publishing to npm.** Both packages stay `private: true`, as the owner accepted with D8; publishing waits for an outside consumer.
- **A client-tool pause kind.** The harness defers the third host-tool pattern, so `ToolResult.pause` carries only `clarification` for now (§6.2).

## 2. Decisions

Each decision answers one open decision in [guide §12][g12], in the same order, and lists the options, the choice and the evidence. Three statuses appear:
- **Decided** means the evidence settles the decision, and its ADR records it as Proposed until P4 accepts it.
- **Decided, provisional** means the choice holds until a named todo checks it.
- **Accepted (owner, 2026-11-18)** means the choice depended on facts outside the evidence, such as budgets, accounts or plans for outside users, and the owner confirmed it. No decision still waits on the owner.

| # | Decision | Choice | Status | ADR |
| --- | --- | --- | --- | --- |
| D1 | Package split | Two packages, `@buildanagent/gateway` and `@buildanagent/sdk`, each with a `testing` subpath, under `packages/` | Decided | [0001](../decisions/0001-two-packages-gateway-and-sdk.md) |
| D2 | First wire protocols | Anthropic Messages and OpenAI-compatible Chat Completions; adapters call `fetch` directly | Accepted (owner, 2026-11-18) | [0002](../decisions/0002-first-wire-protocols.md) |
| D3 | Token fields | Separate classes; the field is named `uncachedInput`, never `input` | Decided | [0003](../decisions/0003-token-usage-fields.md) |
| D4 | Cost catalog | A versioned JSON catalog in the gateway, overridable; a provider-billed total wins; an unknown price blocks a budgeted run | Decided | [0004](../decisions/0004-cost-catalog-and-basis.md) |
| D5 | Approval signing key | A pluggable `ApprovalSigner` with key ids; a per-process ephemeral key by default; an unsigned or invalid resume always fails closed | Accepted (owner, 2026-11-18) | [0005](../decisions/0005-approval-signing.md) |
| D6 | Hook names | Our six moment-named interceptors; run-level hooks stay observers | Decided | [0006](../decisions/0006-interceptor-names.md) |
| D7 | Schema validator | `@earendil-works/pi-schema` 1.5.2 (drafts 2020-12 and 7), with `@cfworker/json-schema` 4.1.6 as the fallback | Decided, provisional (B10) | [0007](../decisions/0007-json-schema-validator.md) |
| D8 | Versioning start and CI checks | 0.x with a changelog that marks breaking changes; fail on undocumented exports and on documented names missing from the `.d.ts` | Accepted (owner, 2026-11-18) | [0008](../decisions/0008-versioning-and-doc-checks.md) |
| D9 | Budget timing | Check the USD cap before each model call, against a projected cost | Decided | [0009](../decisions/0009-pre-emptive-budget.md) |
| D10 | Run outcomes | A discriminated `RunResult` union plus a `runOrThrow()` helper | Decided | [0010](../decisions/0010-run-outcomes.md) |
| D11 | Progress-detection defaults | Three identical failing calls end the run with `no_progress`; a depth cap of 2 | Decided, provisional (N39) | none: tunable defaults |
| D12 | Tool-name rule | A per-adapter name table, a canonical rule of `^[A-Za-z0-9_-]{1,64}$` checked at definition, and reversible sanitising per adapter | Decided, provisional (B7) | [0011](../decisions/0011-tool-name-rule.md) |

### D1. Two packages, because the gateway has consumers that never run the loop

**Options.** (a) One package, `@buildanagent/sdk`, with subpath exports for the gateway and `testing`. (b) Two packages: a gateway and a loop, as pi-ai and pi-agent-core are split. (c) One package per provider adapter, as `@ai-sdk/*` are split.

**Choice: (b).** `@buildanagent/gateway` holds the transcript types, the `ModelAdapter` spec, the gateway runtime, usage and cost, and the adapters as subpath exports. `@buildanagent/sdk` holds the loop, tools, hooks, events, the OTel observer and the `testing` export, and it depends on the gateway. Each package has a `./testing` subpath. The gateway's holds mock transports and `allowModelRequests`; the SDK's holds `ScriptedModel` and the seam doubles, and it re-exports the gateway's.

**Evidence.** The guide's rule is to split if any consumer needs the gateway without the loop ([guide §12, decision 1][g12]). Three planned consumers do. First, the harness's summarisation layer makes one model call with no tools ([harness guide §3][hg3]). Second, the agent's reader and drafter are model contexts with no tools ([agent guide §9][ag9]). Third, the eval bridge needs only the base-URL override ([guide §8][g8]). The provider spec must also carry its own version, as Vercel's `specificationVersion` does, so a split lets the gateway release apart from the loop ([guide §9][g9]). Option (c) multiplies packages before we have more than two adapters; subpath exports keep the adapters tree-shakable without that cost.

### D2. Anthropic Messages and OpenAI-compatible Chat Completions first (accepted)

**Accepted by the owner on 2026-11-18.**

**Options.** Any subset of Anthropic Messages, OpenAI Responses and OpenAI-compatible Chat Completions ([guide §12, decision 2][g12]).

**Choice: Anthropic Messages and OpenAI-compatible Chat Completions; OpenAI Responses is deferred.** Each adapter calls `fetch` through an injectable `Transport` and uses no vendor SDK.

**Evidence.** The guide settles this decision with the G3 agent's provider list. The agent guide names no vendor, but it requires a judge model that differs from the agent's model, so the eval suite needs at least two providers ([agent guide §10, decision 6][ag10]). Two adapters also give the cross-provider replay pass (B6) real wire differences to test against. Anthropic Messages is the protocol our harnesses already mock: the Claude and Copilot references both run offline against a mock Messages API ([mock-anthropic.mjs](../../verify/claude-agent-sdk/scripts/mock-anthropic.mjs); [guide §8][g8]). Chat Completions is the widest-reaching second protocol, because Pi's split of `api` from `provider` lets one wire adapter serve many vendors, and Pi describes the quirks of OpenAI-compatible servers in per-model `compat` objects ([provider note §3][n-prov-3]). Responses is deferred because OpenAI's caching and strict-mode semantics come from SDK types only; its docs hosts were unreachable during the research ([SDK research §7][sr7]). Direct `fetch` matters for retries. Pi turns vendor-SDK retries off because "their built-in retry timers ignore the request AbortSignal", and a plain transport also makes the base-URL override and the mock transports trivial ([guide §2][g2]).

### D3. Usage stores four token classes, and the uncached field says so in its name

**Options.** (a) `input` means uncached input, as Pi stores it. (b) `input` means the total, as Vercel's Anthropic adapter and OTel's `gen_ai.usage.input_tokens` report it ([guide §12, decision 3][g12]; [harness research §7][har7]).

**Choice: neither name.** `Usage` carries `uncachedInput`, `cacheRead`, `cacheWrite` (by TTL), `output`, `reasoning` (a part of `output`) and `raw`. A `totalInput(usage)` helper sums the input classes, and no field is called `input`.

**Evidence.** The guide's settling test is to write the OTel projection and the cost fold against both conventions and keep the one with fewer conversions. With separate classes, the cost fold multiplies each class by its own rate and needs no conversion, while the OTel projection needs one sum ([harness research §7][har7]). With a total, the cost fold must subtract both cache classes from `input` on every message. Separate classes therefore need fewer conversions. The ambiguity of `input` caused the disagreement in the first place, since two SDKs use the same name for different sums ([SDK research §1][sr1]). A name that states its meaning removes it. Both D2 protocols are expected to count reasoning tokens inside output tokens, but nobody has checked their API references. B8 and B9 check it against each adapter's raw usage and record the result in the adapter README.

**Revision (plan review 2, 2026-11-19).** Anthropic's docs answer the question for B8: thinking tokens count inside `output_tokens`, and `usage.output_tokens_details.thinking_tokens` reports how many of the billed output tokens were reasoning. When streaming, that field arrives only on the final `message_delta` ([Anthropic, extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking), as of November 2026). B8 adds a fixture for it, and B9 still checks the OpenAI-compatible side.

### D4. Prices come from a versioned catalog, and a provider-billed total overrides it

**Options.** Price tables from a catalog shipped in the package, fetched at run time, or supplied by the caller; refresh on release or on a schedule; and whether a provider-billed total overrides the catalog, as Pi's `totalFromProvider` does ([guide §12, decision 4][g12]).

**Choice.** `@buildanagent/gateway` ships `catalog.json`, which gives each model its tiered rates per token class, an `asOf` date and a source URL. A caller can pass its own catalog. When a response carries a billed total, `cost.basis` is `"provider"` and that total wins. Otherwise the catalog prices the usage (`basis: "catalog"`). A model missing from the catalog gets `basis: "unknown"` and `total: null`. A run with a USD cap refuses to start on an unknown price and ends with `stopReason: "error"`. The catalog is refreshed in every minor release, and a test warns when an entry's `asOf` is older than 90 days. Failed attempts are priced too.

**Evidence.** Cost carries a `basis` flag and comes from a catalog with tiered rates, and failed attempts count, as OpenAI's retry accounting shows ([guide §2][g2]; [SDK decision 5][sr6]). mini-swe-agent raises when it cannot price a model ([harness research §5][har5]). A budget that silently prices at zero would be the same failure in a quieter form, so a budgeted run with an unknown price fails closed. The guide asks which first providers return a billed cost. Neither D2 protocol is known to return one, but nobody has checked, so B8 and B9 check each API reference and fixture and record the answer. The provider-wins rule costs nothing to keep if neither does. Run-time fetching would make cost depend on the network, which contradicts the "nothing reaches outside by default" rule ([guide §9][g9]).

### D5. A pluggable signer with key ids, an ephemeral default, and no unsigned resume (accepted, with HD5)

**Accepted by the owner on 2026-11-18.**

**Options.** Who owns the HMAC secret, how it rotates, and whether an unsigned resume fails closed by default. The decision merges with harness decision 5 and agent decision 3 ([guide §12, decision 5][g12]; [harness guide §13][hg13]; [agent guide §10][ag10]).

**Choice.** The SDK defines an `ApprovalSigner` interface whose signatures carry a `keyId`, so a verifier can hold a key ring and rotate keys without breaking stored pauses. `ephemeralSigner()` generates a random key per process and is the default, which serves a single-process host. `hmacSigner({ keys, current })` serves a multi-process host whose key store the harness owns. A missing, unknown-key or invalid signature always fails closed, and no option turns that off. The `testing` export provides a fixed-key signer for tests. The signed payload covers the request id, kind, call id, tool name, the canonical input hash and an optional `policyVersion`. Those are the four fields of [SDK decision 8][sr6] (id, call id, tool name and input hash), plus the request kind and the policy version that the harness's `approval_requested` entry carries ([harness guide §12][hg12]). *(Wording corrected 2026-11-18, confirmed by the owner 2026-11-19; the field list and ADR 0005 are unchanged.)*

**Evidence.** Vercel's approval responses are unsigned unless a secret is set, and our rule is to fail closed on a missing or invalid signature ([guide §7][g7]). ADK's safe behaviour for a forged call id, which runs nothing and asks again, is the outcome our resume copies ([guide §7][g7]). The guide's settling rule ties the key to the deployment model: one process can generate a key per run, and a multi-process host needs a shared store ([guide §12, decision 5][g12]).

**Outcome.** The harness, the first multi-process host, always passes `hmacSigner()` over a persistent key ring ([harness plan, HD5][har-hd5]; [ADR 0015](../decisions/0015-harness-approval-key-ring.md)). The SDK default therefore stays `ephemeralSigner()`, which serves single-process library users, and `signer` stays optional.

**Note (2026-11-18).** `ephemeralSigner()` cannot resume a pause on any serverless host, because an isolate or function may be recycled between the pause and its resume. The SDK's docs say so; hosts on Cloudflare, AWS or Vercel pass `hmacSigner()` over a persistent `KeyStore` ([ADR 0035](../decisions/0035-read-only-key-store.md); [portable agents report](../research/deployment/portable-agents.md#the-sdk-travels-the-harness-is-bound-to-one-host-in-six-places)).

**Revision (plan review 2, 2026-11-19).** [ADR 0043](../decisions/0043-standalone-safety-core.md) (accepted) moves this decision's code into `@buildanagent/agent-safety` without changing its rules, fields or shapes. The package defines the `ApprovalSigner` interface, the signers `hmacSigner()` and `ephemeralSigner()`, `canonicalInputHash()`, and the `SignedPendingRequest` and `Resolution` types. [E1](../todos/ready/E1-safety-core-outcomes.md) builds the hash and [E3](../todos/ready/E3-signed-approvals-third-party.md) the rest. The SDK re-exports all of them, so callers keep the import paths in §3.3, and B15 imports them instead of defining them.

### D6. Our six moment-named interceptors, with run-level hooks as observers

**Options.** Our names (`beforeModelCall`, `transformContext`, `afterModelCall`, `beforeToolCall`, `afterToolCall`, `shouldStop`) or LangChain's (`beforeModel`, `wrapToolCall`), and whether run-level hooks stay observers ([guide §12, decision 6][g12]).

**Choice: our names; run start and end are observer events only.**

**Evidence.** [AGENTS.md](../../AGENTS.md#planned-architecture-when-code-starts) item 2 already lists the hook moments by model and tool step, and the guide matches LangChain's count of six while naming the moments ([guide §6][g6]). The guide's settling test counts the hooks the triage capstone needs under each naming. Under ours the capstone needs two hooks: the `beforeToolCall` interceptor gates `escalate`, and an observer audits calls. LangChain's capstone also needs two pieces, its `humanInTheLoopMiddleware` and a `wrapToolCall` audit ([deep comparison §1][dc-same]). Because the counts tie, the guide's test does not separate the two namings. Two other facts favour ours. First, AGENTS.md already uses them. Second, separate `before` and `after` hooks keep each return type small and auditable, and a gate never has to call through to `execute`, which follows the guide's rule that a hook returns a replacement ([guide §6][g6]). B19 re-runs the count on the finished capstone and records it.

### D7. pi-schema validates raw JSON Schema, and B10 confirms the choice against both candidates (provisional)

**Options.** Any eval-free JSON Schema validator, supporting draft-07, 2020-12 or both ([guide §12, decision 7][g12]). Two candidates already sit in our lockfile, which means they pass the repo's age rule: `@earendil-works/pi-schema` 1.5.2 and `@cfworker/json-schema` 4.1.6.

**Choice: pi-schema 1.5.2, provisional; `@cfworker/json-schema` 4.1.6 is the fallback.** The SDK supports drafts 2020-12 and 7. Coercion is our own pipeline step, not the validator's.

**Evidence.** Both packages are MIT and need no `eval`. Pi-schema "compiles once into plain closures" for drafts 2020-12 and 7, reports errors as JSON Pointer paths, never modifies a schema, and has no dependencies. Its README reports 2,222 of 2,223 core tests passing in the official suite ([pi-schema 1.5.2 README](https://www.npmjs.com/package/@earendil-works/pi-schema/v/1.5.2), as of November 2026). It is the validator behind Pi's path-level error message, which the guide tells us to copy ([guide §4][g4]). `@cfworker/json-schema` supports drafts 4, 7, 2019-09 and 2020-12 and exists because Workers lack `eval` ([its 4.1.6 README](https://www.npmjs.com/package/@cfworker/json-schema/v/4.1.6)). Claude's output schemas are draft-07, so draft-07 support is required ([feature table, output][ft-out]). Pi-schema declares `node >=22.19.0` in its `package.json`; B1 checks that our Node 22 meets it.

**The provisional check.** B10 runs both candidates against strict-schema fixtures it writes from the Anthropic and OpenAI API references, and against a set of Claude's draft-07 output schemas. It also compares the error paths with the guide's message format. Pi-schema stays unless it fails a schema that `@cfworker/json-schema` passes.

**Note (2026-11-18).** B10 also loads the chosen validator inside workerd, because no one has tested pi-schema there; if it fails, `@cfworker/json-schema` becomes the choice for every target ([ADR 0033](../decisions/0033-three-deployment-targets.md)).

### D8. 0.x, with a changelog that marks breaking changes, and two export diffs in CI (accepted)

**Accepted by the owner on 2026-11-18.**

**Options.** 0.x with a changelog that still marks breaking changes, or 1.0 with full semver, and which CI check fails on exports missing from the docs ([guide §12, decision 8][g12]).

**Choice: 0.x.** The four versioning rules of [guide §10][g10] apply from the first release: an `experimental_` prefix for unstable surface, renames as aliases, no breaking change in a patch, and a capability list on `run_start`. In 0.x, a minor release may break the API but must say so under "Breaking Changes". CI runs two diffs: one fails when a public export has no docs entry, and one fails when the docs name a symbol missing from the `.d.ts` ([guide §10][g10]).

**Evidence.** The guide's rule is 0.x unless an external consumer will depend on the SDK before the harness ships. The only planned consumers are P2 and P3, in this workspace ([implementation plans §1](implementation-plans.md#1-goal)). Pi shipped breaking changes in the patch releases 1.5.1 and 1.0.3, which shows how a 1.x number without discipline misleads more than an honest 0.x ([guide §10][g10]). The two diffs come from our own Tier 3 method, and OpenAI's compiled `examples/docs` is the precedent for compiling every example ([guide §10][g10]).

### D9. The USD cap is checked before each model call, against a projected cost

**Options.** Check before each model call, as harness decision 18 and the HN synthesis ask, or after the crossing response, as Claude and mini-swe-agent do ([guide §12, decision 9][g12]). The decision merges with harness decision 9 and agent decision 9.

**Choice: before each call.** The loop projects the next call's cost: the input estimate times the model's input rate, plus `maxOutputTokens` (the call's option, else `Model.caps.maxOutputTokens`) times the output rate. B14 exports the projection as `projectCallCost()`, so a caller that uses `Model.complete()` outside the loop, such as the harness's summary layer, applies the same formula ([harness plan, HD9][har-hd9]). If the spend plus the projection exceeds the cap, the run ends with `stopReason: "budget"` before the call. The input estimate is the previous call's reported total input plus a character-based estimate of the messages added since. Actual cost is still recorded after each call, so any remaining overshoot shows in the result.

**Revision (plan review 2, 2026-11-19).** Under [ADR 0043](../decisions/0043-standalone-safety-core.md), `projectCallCost()` and the token-level `projectCost()` it calls move to `@buildanagent/gateway`, beside the catalog ([B5](../todos/ready/B5-usage-cost-catalog.md)). The loop and the safety package's AI SDK guard ([E5](../todos/ready/E5-pre-call-cost-guard.md)) then share one formula. B14's check imports `projectCallCost()` from the gateway, and the SDK re-exports it for the harness's summary layer.

**Evidence.** Claude's `maxBudgetUsd` acts only after the response that crosses it, and harness decision 18 asks for a pre-emptive check ([guide §3][g3]). The HN synthesis makes the same change, because loops cause the runaway-cost anecdotes ([HN §4.1][hn41]). Inspect checks cost limits at each `generate()`, which matches the pre-emptive rule ([harness guide §10][hg10]). The guide's settling test measures overshoot on our longest recorded runs. We have none yet, so B14 instead asserts a bound with the scripted model: with the pre-emptive check, the overshoot is at most the error of one call's projection, and a post-response check would overshoot by a full call. N39 reruns the measurement on recorded runs.

### D10. A discriminated result union, plus `runOrThrow()` for callers who want exceptions

**Options.** Run outcomes as stop reasons, which the research prefers, or typed errors, which the deep comparison prefers because a caller cannot ignore them ([guide §12, decision 10][g12]).

**Choice: both, as [guide §3][g3] proposes.** `RunResult` is a union discriminated by `stopReason`, and only the `done` variant carries `output`, so code that reads the output without narrowing fails to compile. `runOrThrow()` converts every other outcome into a typed `RunStoppedError` that carries the resumable `context`, as OpenAI's `AgentsError.state` does, with an `isInstance` marker in place of `instanceof` ([guide §9][g9]).

**Evidence.** The guide's settling test asks which version lets an unhandled outcome compile. A plain status field compiles when the caller ignores it, and the union does not. B11 adds a type test (`@ts-expect-error` on `result.output` without narrowing) so the property stays true. Exceptions remain reserved for programmer errors, as SDK decision 3 requires ([SDK decision 3][sr6]).

### D11. Three identical failing calls stop the run, and the depth cap is 2 (provisional)

**Options.** What counts as a repeated identical failing call or a repeated edit, how many repeats fire `no_progress`, and the default subagent depth cap ([guide §12, decision 11][g12]).

**Choice, provisional.** The default `progress` policy fires `no_progress` after three consecutive tool calls with the same tool name and the same canonical input hash that each return `isError`. A tool can declare a `progressKey(input)`, for example a file path plus a line range, and five calls with the same key and no successful call between them also fire `no_progress`. The SDK cannot see "an edit" by itself, so the edit rule needs that key. `depth` and `maxDepth` (default 2) travel in `ToolContext`, and a spawning tool refuses with an error result at the cap. No ADR records these numbers, because they are tunable defaults.

**Evidence.** The HN synthesis asks for this policy and a default depth cap, after loop and recursion anecdotes ([HN §4.1][hn41]). The guide's settling test replays recorded runs. None exist until the harness records them, so the numbers are a starting point that B14 makes configurable and N39 retunes. The defaults hash on `run_start` records the values in use ([guide §10][g10]).

### D12. A per-adapter name table first, then a canonical rule and reversible sanitising (provisional)

**Options.** The 64-character `[A-Za-z0-9_-]` floor from the tools note, or a rule built from a per-provider table ([guide §12, decision 12][g12]).

**Choice.** B7 builds the table from each D2 provider's API reference before any naming code is written. Until then, the canonical rule is `^[A-Za-z0-9_-]{1,64}$`, checked when a tool is defined, with a thrown programmer error on a violation. Each adapter maps canonical names to its wire form reversibly and keeps the map for the run, and namespaced names such as `mcp__<server>__<tool>` follow the same rule. If the table shows a provider stricter than the floor, B7 tightens the canonical rule; if every provider is looser, the floor stays, because the strictest provider sets it.

**Evidence.** The floor is an assumption without a per-provider table, which the research lists among its open limits ([SDK research §7][sr7]; [tools note, implication 9][n-tools-impl]). Names are namespaced by source and sanitised to the strictest provider, and tool order stays stable for prompt caching ([tools note §8][n-tools-8]).

## 3. Package and module layout

### 3.1 Two packages under a new top-level `packages/` directory

**Revision (plan review 2, 2026-11-19).** [ADR 0043](../decisions/0043-standalone-safety-core.md) adds a third package beside these two, `@buildanagent/agent-safety`, which Round E builds and the SDK imports. The tree and the Dependencies paragraph below show it.

Our own code goes in `packages/`, apart from `verify/`. The `verify/*` packages are harnesses for third-party SDKs with their own scripts, results and drift checks. Product code that P2 and P3 extend should not share their folder or their nightly verify job. `packages/` is also the pnpm convention, and P2 and P3 can add `packages/harness` and `packages/agent` beside these two. B1 adds `packages/*` to `pnpm-workspace.yaml`; this plan leaves the file unchanged.

```text
packages/
  gateway/                      @buildanagent/gateway
    package.json                exports: ".", "./anthropic", "./openai-chat", "./testing"
    src/
      types.ts                  Message, ContentBlock, ModelContent, ModelContext, ModelCaps, Usage, Cost, ModelEvent
      spec.ts                   ModelAdapter (specificationVersion "v1"), spec upgrade shims
      stream-contract.ts        assertStreamContract(): the start / blocks / one-terminal rule
      complete.ts               complete(): folds stream() into one AssistantMessage
      gateway.ts                createModel(), retries, middleware, onPayload, request dump
      transform-messages.ts     the cross-provider replay pass
      usage.ts  cost.ts  catalog.json   cost.ts: price(), projectCost() and projectCallCost() (B5; ADR 0043)
      names.ts                  canonical tool-name rule, per-adapter sanitising
      adapters/anthropic/       Messages: SSE parser, cache breakpoints, strict lowering
      adapters/openai-chat/     Chat Completions: SSE parser, compat flags
      testing/                  mockTransport(), startMockServer(), allowModelRequests()
    README.md  CHANGELOG.md
  sdk/                          @buildanagent/sdk
    package.json                exports: ".", "./otel", "./testing"
    src/
      run.ts                    Context, run(), continueRun(), runOrThrow(), the Run object
      loop.ts                   the step loop: transform → before → stream → after → tools → stop
      events.ts                 the closed AgentEvent union and its runtime list
      tools/                    defineTool(), outputTool(), pipeline, scheduler, error formatter
      hooks.ts                  Interceptors, Observer, hook_error handling
      budget.ts  progress.ts    D9 (imports projectCallCost() from the gateway) and D11
      pauses.ts                 re-exports SignedPendingRequest, Resolution, signers and canonicalInputHash from agent-safety;
                                createPendingRequest(), blockingApprovals()
      errors.ts                 SdkError base with isInstance markers
      otel/                     otelObserver(): gen_ai.* spans, content off
      testing/                  ScriptedModel, autoResponder, seam doubles, record and replay
    reference-loop/             a readable loop of a few hundred lines, tested like the real one
    README.md  CHANGELOG.md
  agent-safety/                 @buildanagent/agent-safety (Round E, ADR 0043)
    package.json                exports: "." (the core, no third-party imports), "./ai", "./agents"
    src/                        outcomes, canonicalInputHash (E1); effect identity (E2); signers, pending record (E3)
```

**Dependencies.** The gateway has no runtime dependencies, and it uses `fetch`, Web Streams and Web Crypto from Node 22. Nothing in the gateway names an SDK type, so the dependency runs one way: `Context`, which holds the `SignedPendingRequest` the SDK re-exports, lives in `@buildanagent/sdk`, and the gateway's own request shape is `ModelContext`. The safety package depends only on the gateway, and its root export imports no third-party SDK ([E1](../todos/ready/E1-safety-core-outcomes.md)). The SDK depends on the gateway and on `@buildanagent/agent-safety` (both `workspace:*`, the safety package through its root export only), on `@earendil-works/pi-schema` 1.5.2 (D7) and on `@standard-schema/spec` 1.1.0 for types, which the lockfile already holds. The OTel observer accepts a structural `Tracer` interface, so `@opentelemetry/api` is not a runtime dependency; its tests use `@opentelemetry/sdk-trace` 2.12.1 as an exact-pinned dev dependency. That version is already in the lockfile, because `@opentelemetry/exporter-trace-otlp-http` 0.223.2 depends on it. *(Revision, plan review 2, 2026-11-19: the plan first named `@opentelemetry/sdk-trace-base` 2.12.0, but npm marks every `sdk-trace-base` release deprecated in favour of `sdk-trace`, as of November 2026.)* Every new pin follows [AGENTS.md "Versions"](../../AGENTS.md#coding-standards): an exact version at least a week old, or the latest fixed release when an advisory applies.

**Tooling.** Both packages are ESM, extend `tsconfig.base.json`, and run tests with `node:test` through tsx (`tsx --test`), so no test framework is added. Each package's `typecheck` script runs `tsc -p`, and its `test` script runs its tests, so the root `pnpm typecheck` and `pnpm test` pick them up unchanged. Biome already covers `packages/`. `noExplicitAny` stays on there, because it is off only in `verify/*/examples`.

### 3.2 Gateway API

The signatures below revise [guide §11][g11] where a decision changes them. Each revision is marked with its decision or reason.

```ts
// @buildanagent/gateway: transcript (guide §2; SDK decision 2)
type ContentBlock =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; signature?: OpaqueToken }          // valid only for the model that made it
  | { type: "image"; mediaType: string; data: string }
  | { type: "tool_call"; callId: string; name: string; input: unknown };
type ModelContent = Extract<ContentBlock, { type: "text" | "image" }>;     // what a tool result may carry
interface OpaqueToken { api: string; provider: string; model: string; value: string }
type Message =
  | { role: "user"; content: ContentBlock[] }
  | AssistantMessage
  | { role: "tool"; callId: string; content: ModelContent[]; isError: boolean };
interface AssistantMessage {
  role: "assistant"; content: ContentBlock[]; model: ModelRef;
  stopReason: "stop" | "length" | "tool_calls" | "error" | "aborted";
  error?: { kind: "retryable" | "overflow" | "quota" | "fatal"; message: string; status?: number };
  usage: Usage; cost: Cost;
}

// Usage and cost (D3, D4): no field named `input`
interface Usage {
  uncachedInput: number; cacheRead: number; cacheWrite: { "5m": number; "1h": number };
  output: number; reasoning: number;  // reasoning is a part of output
  raw: unknown;                        // the provider's usage object, unchanged
}
declare function totalInput(u: Usage): number;
interface Cost { total: number | null; basis: "provider" | "catalog" | "unknown"; currency: "USD"; catalogAsOf?: string }
// Revision for P2: the harness sketch types `total` as number; D4 makes it null when the price is unknown.

// Model spec (SDK decision 1)
interface ModelRef { api: string; provider: string; id: string }
interface ModelAdapter {
  readonly specificationVersion: "v1";
  readonly api: string;       // wire protocol, e.g. "anthropic-messages"
  readonly provider: string;  // vendor and catalog entry
  stream(model: ModelRef, context: ModelContext, options: StreamOptions): AsyncIterable<ModelEvent>;
}
interface ModelContext { system: string; messages: Message[]; tools: WireTool[] } // what one call sends
interface WireTool { name: string; description: string; inputSchema: Record<string, unknown> } // a JSON Schema object; added in B2, which found WireTool used but undefined
type ModelEvent =
  | { type: "start" }
  | { type: "text_start" | "reasoning_start" | "tool_input_start"; index: number }
  | { type: "text_delta" | "reasoning_delta" | "tool_input_delta"; index: number; delta: string }
  | { type: "text_end" | "reasoning_end" | "tool_input_end"; index: number; block: ContentBlock }
  | { type: "done"; message: AssistantMessage }    // exactly one terminal event
  | { type: "error"; message: AssistantMessage };  // stopReason "error" | "aborted"
interface StreamOptions {
  signal?: AbortSignal; maxOutputTokens?: number;
  temperature?: number;                            // provider-optional: B8 drops it for Anthropic with a warning (revision, plan review 2)
  cacheRetention?: "none" | "short" | "long";      // one portable caching policy
  providerOptions?: Record<string, unknown>;       // escape hatch only
  onPayload?(body: unknown): unknown;              // inspect or replace the request body
}

// Gateway runtime (SDK decisions 4, 13; guide §9): an explicit provider, never a bare id or ambient credentials
type Transport = (request: Request) => Promise<Response>;   // defaults to globalThis.fetch
interface ProviderConfig { apiKey: string; baseURL?: string; transport?: Transport; headers?: Record<string, string> }
interface ModelCaps { contextWindow: number; maxOutputTokens: number; images: boolean; reasoning: boolean } // from catalog.json
interface Model {
  readonly ref: ModelRef;
  readonly caps: ModelCaps;            // Revision for P2: the window and output limit the context layers and D9 need
  stream(context: ModelContext, options?: StreamOptions): AsyncIterable<GatewayEvent>;
  complete(context: ModelContext, options?: StreamOptions): Promise<AssistantMessage>; // folds stream()
  price(usage: Usage): Cost;
}
type GatewayEvent = ModelEvent | { type: "retry"; attempt: number; delayMs: number; error: string };
declare function createModel(options: {
  adapter: ModelAdapter; id: string;
  retries?: number;                    // default 2 HTTP retries, before any output only
  middleware?: ModelMiddleware[];      // first is outermost
  catalog?: PriceCatalog;
  onRequest?(dump: RequestDump): void; // the full-request dump for any step
}): Model;
interface ModelMiddleware {            // Revision: no wrapGenerate, because complete() folds stream()
  transformParams?(e: { context: ModelContext; options: StreamOptions }): Promise<{ context: ModelContext; options: StreamOptions }>;
  wrapStream?(e: { next: () => AsyncIterable<GatewayEvent>; context: ModelContext }): AsyncIterable<GatewayEvent>;
}
declare function transformMessages(messages: Message[], target: ModelRef, caps: ModelCaps): Message[];

// Adapters, one subpath each (D2)
// import { anthropic } from "@buildanagent/gateway/anthropic";
declare function anthropic(config: ProviderConfig): ModelAdapter;
// import { openaiChat } from "@buildanagent/gateway/openai-chat";
declare function openaiChat(config: ProviderConfig & { compat?: ChatCompat }): ModelAdapter;

// @buildanagent/gateway/testing (SDK decision 14)
declare function allowModelRequests(allowed: boolean): void;  // false: any non-mock transport throws
declare function mockTransport(api: "anthropic-messages" | "openai-chat", script: WireScript): Transport;
declare function startMockServer(options: { api: string; script: WireScript; log?: string }): Promise<{ url: string; close(): Promise<void> }>; // 127.0.0.1 only
declare function assertStreamContract(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]>;
```

### 3.3 SDK API

```ts
// @buildanagent/sdk: tools (guide §4; SDK decisions 9–11; D7, D11, D12)
interface Clock { now(): string }                    // ISO 8601; fixedClock() in testing
interface ToolDefinition<I, S> {
  name: string;                                       // canonical rule, D12
  description: string;
  kind: "function" | "dynamic" | "provider-local" | "provider-executed";
  inputSchema: (StandardSchemaV1<I> & StandardJSONSchemaV1) | JSONSchema;
  exposure?: "direct" | "deferred" | "hidden";        // default "direct"; deferred tools are not sent until activated
  executionMode?: "parallel" | "sequential";          // default "parallel"
  resourceKey?(input: I): string;                     // per-resource serialisation
  progressKey?(input: I): string;                     // D11 repeated-edit detection
  execution?: "inline" | "activity";                  // per-tool durable dispatch, for a later durable adapter
  firstParty?: boolean;                               // only first-party readOnlyHint affects scheduling
  repair?(e: { input: unknown; issues: SchemaIssue[] }): Promise<unknown | undefined>;
  formatError?(e: ToolFailure): ModelContent[];       // overrides the default "do not substitute a mock" text
  redactErrors?: boolean;                             // default false: replace a thrown error's message with a fixed line
  effect?: { kind: "write"; businessKey?(input: I): string };  // revision (ADR 0043, SG3; B10): absent means read-only for the crash rule
  execute(input: I, ctx: ToolContext): Promise<ToolResult<S>>;
}
interface ToolContext {
  runId: string; callId: string; signal: AbortSignal;  // signal also fires when a sibling fails
  depth: number; maxDepth: number;                      // D11
  clock: Clock; update(details: unknown): void;         // emits tool_call_update
}
interface ToolResult<S> {
  content: ModelContent[]; details?: unknown; structured?: S;
  isError?: boolean; terminate?: boolean;
  pause?: { kind: "clarification"; question: string }; // Revision: the clarification pause starts in a tool
  outcome?: WriteOutcome;                              // revision (ADR 0043, SG3; B10): typed by agent-safety (E1)
}
declare function defineTool<I, S>(definition: ToolDefinition<I, S>): ToolDefinition<I, S>;
declare function outputTool<S>(options: { name: string; schema: StandardSchemaV1<S> & StandardJSONSchemaV1 }): ToolDefinition<S, S>;
// A run whose only tool is an outputTool ends "done" after one valid call; a schema failure costs one model call of maxSteps.
declare function clarificationTool(options?: { name?: string }): ToolDefinition<{ question: string }, never>;

// Loop (guide §3; SDK decisions 6–8; D9, D10)
interface RunOptions<S = unknown> {
  model: Model;                        // from createModel(); a string is a type error
  tools?: ToolDefinition<any, any>[];
  output?: ToolDefinition<S, S>;       // from outputTool(); its structured result becomes result.output
  interceptors?: Interceptors;
  observers?: Observer[];
  maxSteps?: number;                   // default 20 model calls; approval resolution is not a step
  budgetUsd?: number;                  // checked before each call (D9)
  progress?: ProgressPolicy | false;   // D11 defaults
  depth?: number; maxDepth?: number;   // default 0 and 2
  signer?: ApprovalSigner;             // default ephemeralSigner() (D5)
  signal?: AbortSignal;
  modelOptions?: StreamOptions;
  clock?: Clock; idGenerator?: () => string; random?: () => number;  // stable, public
  includeRaw?: boolean;                // raw provider events, opt-in
}
declare function run<S>(options: RunOptions<S> & { system: string; input: string | ContentBlock[]; history?: Message[] }): Run<S>;
// Revision (R1): Context moved here from the gateway. It is plain JSON, so a caller may build it from its own store.
interface Context { system: string; messages: Message[]; pending?: SignedPendingRequest[] }
declare function continueRun<S>(context: Context, options: RunOptions<S> & { resolutions?: Resolution[] }): Run<S>;
// A call with a verified "allow" resolution runs without calling beforeToolCall; the host re-checks policy before resolving.
// A context whose last message is an errored assistant message drops it and re-issues the call.
declare function runOrThrow<S>(run: Run<S>): Promise<DoneResult<S>>;   // throws RunStoppedError (D10)
interface Run<S> extends AsyncIterable<AgentEvent> {
  readonly id: string;
  readonly result: Promise<RunResult<S>>;     // non-streaming callers await this
  steer(message: string | ContentBlock[]): Promise<DeliveryReceipt>;
  followUp(message: string | ContentBlock[]): Promise<DeliveryReceipt>;
  abort(reason?: string): void;
  on(observer: Observer): () => void;         // returns unsubscribe
}
interface DeliveryReceipt { id: string; kind: "steer" | "follow_up"; message: ContentBlock[]; stepIndex: number }
interface ResultBase { messages: Message[]; context: Context; usage: Usage; cost: Cost; steps: number }
type DoneResult<S> = ResultBase & { stopReason: "done"; output: S | undefined };
type RunResult<S> =
  | DoneResult<S>
  | (ResultBase & { stopReason: "max_steps" | "budget" | "no_progress" | "aborted" | "error"; error?: RunError })
  | (ResultBase & { stopReason: "stopped"; stoppedBy: string })          // a shouldStop hook ended the run; its reason
  | (ResultBase & { stopReason: "awaiting_approval" | "clarification_requested"; pending: SignedPendingRequest[] });
// Revision: every variant carries usage, cost and a resumable context; only "done" carries output.
interface RunError {
  kind: "overflow" | "quota" | "retryable" | "fatal" | "unknown_price" | "hook";  // the first four copy AssistantMessage.error.kind
  message: string; status?: number;
}

// Pauses (guide §7; SDK decision 8; D5). Revision (ADR 0043, plan review 2): SignedPendingRequest, Resolution,
// ApprovalSigner, ephemeralSigner, hmacSigner and canonicalInputHash are defined in @buildanagent/agent-safety
// (E1, E3) and re-exported here unchanged; createPendingRequest and blockingApprovals stay in the SDK.
interface SignedPendingRequest {
  id: string; kind: "approval" | "clarification"; callId: string; tool: string;
  inputHash: string; policyVersion?: string; question?: string; reason?: string;
  keyId: string; signature: string; createdAt: string;
}
type Resolution =
  | { requestId: string; decision: "allow" | "deny"; reason?: string; by?: string }
  | { requestId: string; answer: string; by?: string };
interface ApprovalSigner {
  readonly keyId: string;
  sign(payload: Uint8Array): Promise<string>;
  verify(keyId: string, payload: Uint8Array, signature: string): Promise<boolean>;
}
declare function ephemeralSigner(): ApprovalSigner;
declare function hmacSigner(options: { keys: Record<string, Uint8Array>; current: string }): ApprovalSigner;
declare function canonicalInputHash(input: unknown): Promise<string>;   // the hash the harness stores too
declare function createPendingRequest(                                   // a pause built outside a run (code-initiated calls)
  fields: { kind: "approval"; callId: string; tool: string; input: unknown; policyVersion?: string },
  signer: ApprovalSigner,
): Promise<SignedPendingRequest>;
declare function blockingApprovals(resolve: (p: SignedPendingRequest) => Promise<Resolution>): Interceptors; // emits, waits, appends

// Hooks (guide §6; SDK decision 12; D6). Every event extends HookEventBase.
interface HookEventBase { runId: string; stepIndex: number; callId?: string; signal: AbortSignal; timestamp: string }
interface ContextEvent extends HookEventBase { system: string; messages: readonly Message[]; model: ModelRef; lastUsage?: Usage }
interface ModelCallEvent extends HookEventBase { context: ModelContext; options: StreamOptions }
interface ModelResultEvent extends HookEventBase { message: AssistantMessage }
interface ToolCallEvent extends HookEventBase { callId: string; tool: string; input: unknown }
interface ToolResultEvent extends ToolCallEvent { result: ToolResult<unknown> }
interface StepEvent extends HookEventBase { messages: readonly Message[]; lastMessage: AssistantMessage }
interface Interceptors {
  transformContext?(e: ContextEvent): Promise<Message[]>;   // this call's request only; result.messages and context keep the full history
  beforeModelCall?(e: ModelCallEvent): Promise<ModelCallPatch | void>;
  afterModelCall?(e: ModelResultEvent): Promise<{ message?: AssistantMessage } | void>;
  beforeToolCall?(e: ToolCallEvent): Promise<GateDecision>;
  afterToolCall?(e: ToolResultEvent): Promise<Partial<ToolResult<unknown>> | void>;
  shouldStop?(e: StepEvent): Promise<boolean | { continue: string | ContentBlock[] } | { stop: "no_progress" | "hook"; reason: string }>;
  // true or { stop: "hook" } ends the run "stopped"; { stop: "no_progress" } ends it "no_progress"
  onFailure?: "fail_closed" | "continue";     // default "fail_closed" for gates
}
interface ModelCallPatch { system?: string; messages?: Message[]; activeTools?: string[]; model?: Model; options?: StreamOptions }
// activeTools may name deferred tools, which are then sent; tools go out in definition order whatever the list's order.
type GateDecision =
  | { decision: "allow"; input?: unknown; reason?: string }
  | { decision: "deny"; reason: string }
  | { decision: "ask"; reason?: string; policyVersion?: string };
// No beforeToolCall: every registered tool is allowed. "ask" without blockingApprovals: the run pauses
// with awaiting_approval. Nothing denies silently, and the option's JSDoc says both.
type Observer = (event: AgentEvent) => void | Promise<void>;  // a throw becomes hook_error

// Events (guide §5; SDK decision 13): a closed union; AGENT_EVENT_TYPES lists it at run time
type AgentEvent = EventBase & (
  | { type: "run_start"; sdkVersion: string; specVersion: "v1"; defaultsHash: string; capabilities: string[]; model: ModelRef }
  | { type: "run_end"; result: RunResult<unknown> }
  | { type: "agent_settled" }                                             // after retries have stopped
  | { type: "step_start" } | { type: "step_end"; stopCheck: "continue" | "stop" }
  | { type: "model_call_start"; request: RequestDump } | { type: "model_call_end"; message: AssistantMessage }
  | { type: "text_start" | "reasoning_start" | "tool_input_start"; index: number }
  | { type: "text_delta" | "reasoning_delta" | "tool_input_delta"; index: number; delta: string }
  | { type: "text_end" | "reasoning_end" | "tool_input_end"; index: number; block: ContentBlock }
  | { type: "tool_call_start"; callId: string; tool: string; input: unknown }
  | { type: "tool_call_update"; callId: string; details: unknown }
  | { type: "tool_call_end"; callId: string; result: ToolResult<unknown> }  // the authoritative item, after afterToolCall
  | { type: "approval_request"; request: SignedPendingRequest }          // both pause kinds
  | { type: "steer_applied"; receipt: DeliveryReceipt }                  // fires for steers and follow-ups
  | { type: "context_transformed"; before: number; after: number }      // Revision: "compaction" is the harness's word
  | { type: "retry"; attempt: number; delayMs: number; error: string }
  | { type: "hook_error"; hook: string; error: string }
  | { type: "warning"; code: "max_steps"; detail: string }
  | { type: "error"; error: RunError } | { type: "abort"; reason?: string }
  | { type: "raw"; event: unknown }                                     // only with includeRaw
);
interface EventBase { runId: string; seq: number; stepIndex: number; timestamp: string }

// Budget (D9): the projection the loop uses, exported for calls made outside it.
// Revision (ADR 0043, plan review 2): defined in @buildanagent/gateway (B5) and re-exported here.
declare function projectCallCost(model: Model, context: ModelContext, options?: StreamOptions): Cost;

// Versioning (D8; guide §10): the strings run_start.capabilities carries; the SDK README lists each one
declare const CAPABILITIES: readonly string[];

// @buildanagent/sdk/otel (guide §5)
interface TracerLike { startSpan(name: string, options?: { attributes?: Record<string, unknown>; startTime?: number }): SpanLike }
interface SpanLike { setAttribute(name: string, value: unknown): void; end(endTime?: number): void }
declare const GEN_AI_ATTRIBUTES: Readonly<Record<string, string>>;     // the gen_ai.* names, shared with the harness projection
declare const SEMCONV_GENAI_COMMIT: "d28355d";                          // the pinned convention commit (harness HD7)
declare function otelObserver(options: { tracer: TracerLike; captureContent?: boolean }): Observer; // content off by default

// @buildanagent/sdk/testing (guide §8; SDK decision 14)
interface AssistantScript {                    // added in B3, which found AssistantScript used but undefined
  content: ContentBlock[]; stopReason?: "stop" | "length" | "tool_calls"; // default: tool_calls if content has a tool call, else stop
  error?: NonNullable<AssistantMessage["error"]>; usage?: Partial<Omit<Usage, "raw">>; // error ends the stream with an error terminal
}
interface RecordedRequest {                    // added in B3: a frozen, detached snapshot taken when the call is made
  readonly model: ModelRef; readonly context: ModelContext;
  readonly options: Readonly<Pick<StreamOptions, "maxOutputTokens" | "temperature" | "cacheRetention" | "providerOptions">>;
}
type ScriptStep = AssistantScript | ((request: RecordedRequest) => AssistantScript | Promise<AssistantScript>);
declare class ScriptedModel implements ModelAdapter {
  constructor(steps: ScriptStep[], options?: { chunkSize?: number; ref?: Partial<ModelRef>; idGenerator?: () => string }); // idGenerator added in B3: fills missing tool-call ids
  readonly calls: readonly RecordedRequest[];   // frozen, detached snapshots
  assertComplete(): void;                       // throws if steps remain
}
declare class UnexpectedModelCallError extends Error {}  // thrown on over-run
declare function autoResponder(options?: { denyTools?: Array<string | RegExp> }): ScriptStep; // default deny list covers host tools
declare function testSigner(): ApprovalSigner;               // re-exports E3's fixed-key test signer (revision, plan review 2)
declare function scriptedApprovals(resolutions: Resolution[]): Interceptors;
declare function fixedClock(start: string, stepMs?: number): Clock;
declare function sequentialIds(prefix?: string): () => string;
declare function seededRandom(seed: number): () => number;   // added in B3: the seeded random the todo asks for
declare function recordPairs(model: Model, stamp: RecordingStamp): { model: Model; pairs(): RecordedPair[] };
declare function replayPairs(pairs: RecordedPair[]): ScriptedModel;   // rejects expired or mismatched stamps
```

### 3.4 The seams P2 consumes

The harness plan should use these names as written; P4 checks that it does ([implementation plans §3](implementation-plans.md#3-the-review-p4)). The first six are the seams of [harness guide §1][hg1]; the rest are what its sketches assume from the SDK.

| Seam | SDK surface | Harness use |
| --- | --- | --- |
| Context transform | `Interceptors.transformContext`, `context_transformed` | the five context layers ([harness guide §3][hg3]) |
| Tool gate | `Interceptors.beforeToolCall` → `GateDecision` | the permission pipeline fills it ([harness guide §5][hg5]) |
| Authoritative end events | `*_end`, `tool_call_end`, `model_call_end` with full items | session-log entries ([harness guide §2][hg2]) |
| Resume primitive | `continueRun(context, { resolutions })`; `context` on every result; `Context` as plain JSON | resume from a stored log in any process |
| Tool exposure | `ToolDefinition.exposure`, `ModelCallPatch.activeTools` | registry, MCP client and tool search ([harness guide §4][hg4]) |
| Base URL and transport | `ProviderConfig.baseURL`, `ProviderConfig.transport` | the Inspect bridge and offline mocks ([harness guide §10][hg10]) |
| Pause records | `SignedPendingRequest`, `canonicalInputHash`, `ApprovalSigner`, `createPendingRequest()` | `approval_requested` and `approval_resolved` entries; code-initiated calls (harness N40) |
| Header stamp | `run_start.sdkVersion`, `defaultsHash`, `capabilities` | the `session_header` entry and protocol `initialize` |
| Usage and cost | `Usage`, `Cost`, `totalInput()`, `GEN_AI_ATTRIBUTES` | usage entries and the telemetry projection (harness decision 7) |
| Gateway without the loop | `Model.complete()`, `Model.caps`, `projectCallCost()` | the summarisation layer and its pre-checked cost |
| Determinism | `clock`, `idGenerator`, `random` | byte-identical playback tests |

## 4. Rounds and todos

Round B runs in four stages, each ending in a state the harness round could build on. Every todo has a file in [`docs/todos/ready/`](../todos/ready/), written from [the template](../todos/TEMPLATE.md). Every todo's acceptance criteria include the repo-wide gate: `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline.

### 4.1 Stage 1 builds the gateway types and the scripted model that every later todo tests against

The guide says to start with the gateway and the test model, because every other component depends on them ([guide §12][g12]).

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [B1](../todos/done/B1-sdk-workspace-scaffold.md) | Scaffold `packages/gateway` and `packages/sdk` in the workspace | P4 | S |
| [B2](../todos/done/B2-gateway-core-types.md) | Gateway core types, the v1 model spec, the stream contract and `complete()` | B1 | M |
| [B3](../todos/done/B3-scripted-model.md) | `ScriptedModel`, chunked streams, determinism options and `allowModelRequests` | B2 | M |
| [B4](../todos/ready/B4-gateway-runtime.md) | Gateway runtime: `createModel`, retries, middleware, `onPayload` and the request dump | B3 | M |
| [B5](../todos/ready/B5-usage-cost-catalog.md) | Usage, the cost catalog and fold, and the caching policy | B4 | M |

### 4.2 Stage 2 adds the two wire adapters and the replay pass between them

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [B6](../todos/ready/B6-transform-messages.md) | The cross-provider `transformMessages` pass | B3 | M |
| [B7](../todos/ready/B7-tool-name-table.md) | Per-provider tool-name table and the canonical name rule | B1 | S |
| [B8](../todos/ready/B8-anthropic-adapter.md) | Anthropic Messages adapter and its mock transport | B5, B6, B7 | L |
| [B9](../todos/ready/B9-openai-chat-adapter.md) | OpenAI-compatible Chat Completions adapter and its mock transport | B5, B6, B7 | L |

### 4.3 Stage 3 builds the loop, its tools, hooks, budget and signed pauses

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [B10](../todos/ready/B10-tool-runtime.md) | Tool definitions, the validation pipeline and the validator check (D7) | B3, B7, E1 | M |
| [B11](../todos/ready/B11-loop-core.md) | Loop core: `run`, the closed event union, stop reasons, aborts and `runOrThrow` | B4, B10 | L |
| [B12](../todos/ready/B12-parallel-tools.md) | Parallel tool scheduling, per-resource serialisation and sibling cancellation | B11 | M |
| [B13](../todos/ready/B13-interceptors-observers.md) | The six interceptors and observers | B11 | M |
| [B14](../todos/ready/B14-budget-progress.md) | Pre-emptive USD budget, progress detection and the depth cap | B5, B13, E1 | M |
| [B15](../todos/ready/B15-signed-pauses.md) | Signed pauses in the loop on the safety package's signers, and `createPendingRequest` | B13, E3 | M |
| [B15b](../todos/ready/B15b-continue-run.md) | `continueRun`, `blockingApprovals()` and the clarification pause | B15 | M |
| [B16](../todos/ready/B16-steering.md) | Steering and follow-up with delivery receipts | B11 | S |

### 4.4 Stage 4 ships telemetry, the testing exports, the capstone and the docs checks

| ID | Title | Depends on | Size |
| --- | --- | --- | --- |
| [B17](../todos/ready/B17-otel-observer.md) | OTel `gen_ai.*` observer with content off | B13, B5 | M |
| [B18](../todos/ready/B18-testing-export.md) | Complete the `testing` exports: `autoResponder`, seam doubles, record and replay, mock server | B8, B9, B15b | M |
| [B19](../todos/ready/B19-triage-capstone.md) | Triage capstone and the conformance suite | B12, B14, B15b, B16, B18 | M |
| [B19b](../todos/ready/B19b-reference-loop.md) | The readable reference loop, passing the capstone | B19 | M |
| [B20](../todos/ready/B20-versioning-docs.md) | Versioning policy, defaults hash, compiled docs, `llms.txt` and the export diffs | B17, B19 | M |

The longest dependency chain runs B1 → B2 → B3 → B4 → B11 → B13 → B15 → B15b → B18 → B19 → B20, eleven todos. B6, B7, B10 and B19b can run beside it. Round E feeds this stage: E1 ─► B10 and B14, and E3 ─► B15 ([close-sdk-gaps plan §4](close-sdk-gaps.md#4-round-e-and-its-todos)). Weighted by size, E1 → B10 is as long as B4, so E1 sits on the loop's critical path. Three todos stay size L: the two adapters (B8, B9) and the loop core (B11).

## 5. Test strategy

### 5.1 The scripted test model is the default seam, and mock transports test the wire

Every loop, tool, hook and pause test drives `ScriptedModel` through `createModel`, so the gateway's retry, usage and cost code runs in the loop's tests too. `ScriptedModel` is strict by design: an over-run throws `UnexpectedModelCallError`, every test calls `assertComplete()` in teardown, and each recorded request is a frozen, detached snapshot ([guide §8][g8]). Those properties answer the two failures our references hit: Vercel's mock exhausts silently, and a recorded array that aliases live history keeps changing after the call ([guide §8][g8]).

Adapters get a second seam. Each adapter test runs the adapter over `mockTransport()`, an in-process fake of its HTTP API that replays wire fixtures, including chunk splits inside tool-call JSON. The fixtures come from the API references and from the mock that already serves the Claude and Copilot harnesses ([mock-anthropic.mjs](../../verify/claude-agent-sdk/scripts/mock-anthropic.mjs)). No adapter test opens a socket; only `startMockServer()` does, and it binds to 127.0.0.1.

### 5.2 Conformance tests pin the contracts that other code relies on

Five contract suites run in `pnpm test`:
- **Stream contract.** `assertStreamContract()` checks every adapter and `ScriptedModel`: `start` first, start, delta and end per block keyed by index, then exactly one `done` or `error`. Pi's guarantee is the model for this check ([guide §2][g2]).
- **Event closure.** Every test run records the emitted event types, and a teardown check fails on any type missing from `AGENT_EVENT_TYPES`, which is the Copilot failure ([guide §5][g5]).
- **Replay transform.** A conversation recorded on one adapter replays on the other, and the pass drops foreign reasoning, remaps ids and repairs orphaned calls ([guide §2][g2]).
- **Determinism.** The same script, clock and id generator produce a byte-identical event log on a second run ([guide §8][g8]).
- **Type tests.** `@ts-expect-error` cases pin D10 (output only after narrowing), D6 (interceptors take one event object) and the explicit provider (a bare model string is a type error).

### 5.3 The triage capstone checks the whole SDK against the reference capstones

The eight reference capstones share one contract: a read-only lookup tool, a state-changing tool a person must approve, a typed result and an offline test ([deep comparison §1][dc-same]). B19 writes the same agent on our SDK in `packages/sdk/examples/triage-agent.ts`, and runs it on `ScriptedModel` and on both adapters' mock transports. It covers the three cases that ADK and Copilot test: an approved escalation, a rejected one, and a result that fails its schema ([deep comparison §1][dc-same]). Each capstone row then becomes a check on one part of the SDK:

| Capstone row | What our capstone must show | Part verified | Reference failure it guards against |
| --- | --- | --- | --- |
| Tool surface | only the two defined tools reach the model; no built-ins exist | tool runtime, exposure | Copilot's 19 default built-ins ([guide §9][g9]) |
| Risky tool | `beforeToolCall` returns `ask`; the run ends `awaiting_approval`; a second process resumes it with a signed resolution; a forged signature runs nothing | pauses, signer, `continueRun` | Claude and Pi pauses that die with the process; Vercel's unsigned responses ([guide §7][g7]) |
| Typed result | `outputTool` ends the run with `output` typed and validated; an invalid result returns an error to the model, not a logged warning | tools, `terminate` | ADK's logged-only schema violation ([guide §4][g4]) |
| Extra guard | an observer audits every call; the step cap and budget are set and asserted | hooks, budget | defaults from one call to none ([guide §3][g3]) |
| Test seam | `ScriptedModel`, then the mock transports, with `assertComplete()` | testing export, adapters | mocks behind HTTP for Claude and Copilot ([guide §8][g8]) |

B19 also records the capstone's line count beside the reference table. The count is a report, not a gate.

### 5.4 Tests run offline, with the repo's safety rules built in

Every test file imports a shared setup that calls `allowModelRequests(false)` and replaces `globalThis.fetch` with a guard that throws for any non-loopback host. The setup also fails if a provider key variable such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set, so a test cannot reach a real provider by accident. The package test scripts spawn nothing third-party. If a later todo must spawn code, it uses an allowlisted environment (`PATH`, a temp `HOME`, `TMPDIR`, `LANG`), never `...process.env` ([AGENTS.md](../../AGENTS.md#coding-standards)). `autoResponder` refuses host tools by name as well as by kind, with a default deny list that includes `bash`, `exec_command`, `shell`, `write`, `edit` and `delete`, because OpenAI's `exec_command` once slipped past a type filter ([guide §8][g8]). Scripts are finite, and the test runner has a per-file timeout.

### 5.5 Evals belong to the harness, and the SDK tests only its share

Model quality and tool selection belong to evals with a real model, which the harness runs on Inspect against a mini-swe-agent baseline ([guide §8][g8]; [harness guide §10][hg10]). The SDK's share is a test that `baseURL` and `transport` reach every adapter request, and that `startMockServer()` serves a bridge-style client.

## 6. Risks, open questions and sequence

### 6.1 Five risks remain, and each has a setting, a fixture stamp or a non-goal against it

- **The interfaces could change under the harness.** P4 found fourteen seams the harness and agent plans needed beyond §3.4, and this plan now carries them ([plan review §4][p4-4]). A later need may still appear. Mitigation: §3.4 lists every seam by name, and the 0.x policy (D8) allows a breaking minor release with a changelog entry.
- **Adapter fixtures may drift from the live APIs.** Mock transports test our parser against our fixtures, not against the provider. Mitigation: B18 stamps every recorded pair with an SDK, provider and model version and an expiry, and replay rejects expired pairs ([guide §8][g8]). A live check against a real endpoint stays opt-in and outside `pnpm test`.
- **The provisional defaults may be wrong.** D7, D11 and D12 rest on checks that B7, B10 and N39's recorded runs perform. Mitigation: each is a setting, each change gets a changelog entry and a setting that keeps the old value, and the defaults hash on `run_start` records which values a run used ([guide §10][g10]).
- **Scope creep from the harness side.** Compaction, permissions and the session log are tempting to start inside the loop. Mitigation: the non-goals in §1, and the fact that every such feature lands in the SDK only as an interceptor or an event.
- **Node version.** Pi-schema declares `node >=22.19.0`, and `.nvmrc` says `22`. B1 checks the resolved CI version and pins `.nvmrc` to a matching minor if needed.
- **Node 22 reaches end of life on 2027-04-30** ([Node.js release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json), as of November 2026). Node 24 is in maintenance and Node 26 is Active LTS. Mitigation: move the workspace to Node 24 or 26 before that date, in its own todo, and re-check pi-schema's and `srt`'s `engines` fields then. *(Added in plan review 2, 2026-11-19.)*

### 6.2 No question is open, and one item waits for a later round

- **Answered by the owner on 2026-11-18:** D2, D5 and D8 (§2). Publishing waits for an outside consumer.
- **Answered by P2:** the harness takes `Cost.total` as `number | null`, and `context_transformed` is enough because the harness writes its compaction entry from its own `transformContext` ([harness plan §3.6][har-36]).
- **Answered by P3:** the reader and drafter run as tool-less loop runs, not through `Model.complete()` (agent plan, AD1).
- **Later:** a client-tool pause kind on `ToolResult.pause`, for the third host-tool pattern the harness defers (harness need 13, dropped from Rounds B and N by [P4][p4-4]).

### 6.3 Where Round B slots into the roadmap

Round B starts after P4 closes, and it is the first round of the build phase, because the [roadmap](roadmap.md) stops the current phase at the reviewed plans. A new milestone, "M5 Our agent SDK", covers B1 to B20 with B15b and B19b. The harness round does not wait for the loop: it starts after B1 and B2, and each later harness stage waits for the SDK todos it consumes ([harness plan §6.3][har-63]). The roadmap gains one line for Round B, `P4 ─► B1 … B20 ─► M5`, and the harness plan owns the `B2 ─► N1` branch. **Revision (plan review 2, 2026-11-19):** Round B also depends on Round E (M5e), which the owner released for building on 2026-11-19: E1 ─► B10 and B14, and E3 ─► B15. Round E starts after B1, so it runs beside B4–B9.

Round B closes when the triage capstone passes on our own SDK with the contract the eight references pass, and the harness can import every seam in §3.4 by the name this plan gives it. As of 2026-11-19, B1–B3 are done, and B4, B6, B7 and E1 have every dependency done.

[g]: ../guides/agent-sdk.md
[p4-4]: reviews/plan-review.md#4-needs-reconciliation-24-change-upstream-3-drop-1-is-already-covered
[har-32]: build-harness.md#32-session-log-api
[har-36]: build-harness.md#36-needs-from-the-sdk-plan
[har-63]: build-harness.md#63-where-round-n-slots-into-the-roadmap
[har-hd5]: build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5
[har-hd9]: build-harness.md#hd9-sdk-d9s-per-call-check-plus-a-session-cap-and-a-pre-checked-summary-call-with-sdk-d9
[g1]: ../guides/agent-sdk.md#1-the-sdk-owns-the-loop-and-its-contracts-and-the-harness-owns-where-state-lives
[g2]: ../guides/agent-sdk.md#2-the-model-gateway-should-expose-one-versioned-streaming-method-over-a-transcript-the-sdk-owns
[g3]: ../guides/agent-sdk.md#3-the-loop-should-be-one-in-process-pure-function-capped-in-model-calls-that-ends-with-a-stop-reason
[g4]: ../guides/agent-sdk.md#4-tools-should-take-standard-schema-validate-inside-the-sdk-and-return-every-failure-to-the-model-as-data
[g5]: ../guides/agent-sdk.md#5-the-event-stream-should-be-one-closed-layered-union-whose-end-events-carry-the-authoritative-item
[g6]: ../guides/agent-sdk.md#6-hooks-should-be-six-typed-interceptors-and-separate-observers-each-taking-one-event-object
[g7]: ../guides/agent-sdk.md#7-an-approval-should-end-the-run-in-a-signed-resumable-log-state-not-block-a-callback
[g8]: ../guides/agent-sdk.md#8-the-sdk-should-ship-a-strict-scripted-test-model-in-a-testing-export-from-the-first-release
[g9]: ../guides/agent-sdk.md#9-the-public-api-should-be-functions-with-options-objects-an-explicit-provider-and-nothing-that-reaches-outside-the-process-by-default
[g10]: ../guides/agent-sdk.md#10-versioning-must-cover-defaults-and-prompts-as-well-as-types-and-docs-must-compile-against-the-release-tag
[g11]: ../guides/agent-sdk.md#11-reference-architecture
[g12]: ../guides/agent-sdk.md#12-open-decisions-for-round-p
[hg1]: ../guides/agent-harness.md#1-the-harness-owns-where-state-lives-and-what-a-call-may-touch-and-it-plugs-into-the-sdk-through-six-seams
[hg2]: ../guides/agent-harness.md#2-the-session-log-should-be-one-append-only-tree-of-typed-entries-with-head-a-writer-lock-and-pauses-as-entries
[hg3]: ../guides/agent-harness.md#3-context-policy-should-run-five-removable-layers-cheapest-first-and-keep-every-compaction-visible-and-reversible
[hg4]: ../guides/agent-harness.md#4-the-tool-registry-should-name-defer-and-gate-every-tool-from-one-place-and-the-mcp-client-should-be-a-removable-extension
[hg5]: ../guides/agent-harness.md#5-the-permission-pipeline-should-be-ordered-deny-first-and-fail-closed-and-its-approvals-should-be-signed-entries
[hg10]: ../guides/agent-harness.md#10-evals-should-run-on-inspect-against-mini-swe-agent-and-report-cost-per-task-beside-pass-rate
[hg12]: ../guides/agent-harness.md#12-reference-architecture
[hg13]: ../guides/agent-harness.md#13-open-decisions-for-round-p
[ag9]: ../guides/agent.md#9-reference-architecture
[ag10]: ../guides/agent.md#10-open-decisions-for-round-p
[sr1]: ../research/agent-sdk/agent-sdk-research.md#1-the-model-boundary-works-best-as-one-versioned-streaming-method-over-a-provider-neutral-transcript
[sr6]: ../research/agent-sdk/agent-sdk-research.md#6-fourteen-design-decisions-follow-from-the-evidence
[sr7]: ../research/agent-sdk/agent-sdk-research.md#7-several-decisions-rest-on-unread-code-unreachable-sources-or-secondary-summaries
[n-prov-3]: ../research/agent-sdk/notes/provider-abstraction.md#3-provider-specific-options-pass-through-namespaced-bags-and-payload-hooks
[n-tools-8]: ../research/agent-sdk/notes/tools.md#8-names-should-be-namespaced-by-source-and-sanitized-to-the-strictest-provider
[n-tools-impl]: ../research/agent-sdk/notes/tools.md#design-implications-for-our-sdk
[har5]: ../research/agent-harness/agent-harness-research.md#5-observability-is-a-span-tree-projected-from-the-log-and-evals-must-report-cost-beside-pass-rate
[har7]: ../research/agent-harness/agent-harness-research.md#7-the-evidence-revises-the-8-layer-architecture-in-six-places-and-creates-three-tensions-with-the-sdk-synthesis
[hn41]: ../research/practitioners/practitioner-research.md#41-sdk-g1b
[dc-same]: ../comparison/deep-comparison.md#1-the-same-agent-takes-58-to-115-lines-on-every-sdk-and-differs-in-its-gate
[ft-out]: ../comparison/feature-table.md#output-structured-output-everywhere-though-adk-only-logs-a-schema-violation
