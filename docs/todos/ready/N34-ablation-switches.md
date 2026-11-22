# N34: Ablation switches and the ablation hash

| Field | Value |
| --- | --- |
| ID | `N34` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 7](../../plans/build-harness.md#47-stage-7-adds-telemetry-completion-checks-evals-and-ablation) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N10](N10-mid-turn-overflow.md), [N14](../done/N14-sticky-grouped-quorum.md), [N20](../done/N20-credential-proxy.md), [N21](N21-builtin-tools.md), [N23](N23-skills-context-files.md), [N25](N25-mcp-http-background.md), [N31](N31-telemetry-projection.md), [N32](../done/N32-completion-check.md) |
| Size | M |

## Goal

Make every removable component one flag in `AblationConfig`, stamp the configuration's hash into each session header, and prove each no-op path offline.

## Context

- [harness guide §11](../../guides/agent-harness.md#11-every-component-should-be-removable-because-the-value-of-harness-scaffolding-decays-as-models-improve): every component removable; the log, pipeline and protocol stay
- [build-harness.md §3.5](../../plans/build-harness.md#35-extension-protocol-telemetry-eval-and-ablation-apis): the API sketch
- [build-harness.md §5.6](../../plans/build-harness.md#56-ablation-runs-switch-one-component-off-at-a-time-and-report-in-the-eval-format): the test strategy

## Scope

**In scope**

- `AblationConfig` and `ablationHash()`
- Flags for the five context layers, MCP, each extension tier, tool search, the credential proxy, telemetry, the completion check and the sandbox tier
- Fail-safe removal: proxy off means no credentials; sandbox `none` still needs `unsafe: true`
- A test matrix that runs a scripted session with each flag off

**Out of scope** (and which todo covers it)

- Running ablations on real models (N39)

## Tasks

- [ ] Make the log, the pipeline and the protocol absent from `AblationConfig` on purpose, with a comment pointing at the guide.

## Acceptance criteria

- [ ] Every flag off still completes the scripted session
- [ ] Two configurations differing in one flag have different hashes, and the hash is in `session_header`
- [ ] With `credentialProxy: false`, a tool that needs a credential fails with an error result
- [ ] The matrix keeps `fakeSandbox()` for every arm; the `sandbox: "none"` arm asserts only the tier stamp in `env_stamp`, and its scripted session calls no host tool (`bash`, `write`, `edit`)
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/ablation.test.ts`.

## Docs to update

`packages/harness/README.md`: the ablation table. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
