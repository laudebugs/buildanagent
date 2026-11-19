# A3: Tool contract, typed errors and the contract lint

> **Deferred (2026-11-18).** The owner chose a personal coding agent as the first agent on our stack, so this todo waits until the triage round resumes ([ADR 0032](../../decisions/0032-personal-coding-agent-first.md)). Do not start it before then.

| Field | Value |
| --- | --- |
| ID | `A3` |
| Status | `ready` |
| Plan | [Build agent §4, Stage 1](../../plans/build-agent.md#41-stage-1-builds-the-trusted-run-context-the-helpdesk-boundary-and-the-ten-tools) |
| Round / milestone | Round A (build agent), M7b |
| Depends on | [A2](A2-trusted-context-helpdesk.md), [B10](../done/B10-tool-runtime.md), [N11](N11-tool-registry.md) |
| Size | M |

## Goal

Define `AgentTool` and the adapter that turns it into a harness `RegisteredTool` with the trusted run context bound in the wrapper, plus `toolError()` and a lint that fails the build on a weak contract, so every tool is designed before any tool is written.

## Context

- [build-agent.md §3.2](../../plans/build-agent.md#32-trusted-run-context-helpdesk-and-tool-contracts): `AgentTool`, `defineAgentTool()`, `toRegisteredTool()`, `toolError()`, `lintTools()`
- [agent guide §3](../../guides/agent.md#3-tools-deserve-more-design-effort-than-the-prompt-few-workflow-shaped-tools-identity-from-trusted-context-and-errors-that-say-what-to-do-next): full contracts, errors that name the next step, output budgets, the lint
- [build-agent.md §3.7](../../plans/build-agent.md#37-needs-from-the-sdk-and-harness-plans): needs AH2 (per-turn host context) and AH10 (output trust), now in harness N6 and N11

## Scope

**In scope**

- `AgentTool`, `defineAgentTool()`, `toRegisteredTool(tool)`, which copies `outputTrust` and sets `approvalReuse: "none"` for T2–T4
- `toolError({ cause, next, avoid })` producing an SDK `ToolResult` with `isError: true`
- Input examples validated at registration
- `lintTools()`: name pattern `<service>_<verb>_<resource>`, description of three or more sentences with a "do not use" sentence, no identity-shaped field (`email`, `customerId`, `userId`, `requesterId`, `accountId`) in any input schema, tier present, output budget present
- The check that Zod 4.6.7 schemas satisfy `StandardSchemaV1 & StandardJSONSchemaV1`; the raw JSON Schema fallback if not

**Out of scope** (and which todo covers it)

- The ten tools (A4, A5)
- The tier table (A6)

## Tasks

- [ ] Read the trusted run context from the turn's `hostContext` in the wrapper; the harness passes it per turn (N6, N11).
- [ ] Record the Zod check's result in the package README.

## Acceptance criteria

- [ ] A tool with a `customerId` input fails the lint, and so does one with a two-sentence description
- [ ] An invalid input example throws at registration
- [ ] A host-context value reaches `execute` and appears in no recorded request
- [ ] A registered T2–T4 tool carries `approvalReuse: "none"`, and every tool carries its declared `outputTrust`
- [ ] `toolError()` text contains the cause, the next step and the avoid line
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/triage-agent/test/tools/contract.test.ts`, `test/tools/lint.test.ts`.

## Docs to update

The package README's "Tool contract" section. The plan's todo table in [build-agent.md §4](../../plans/build-agent.md#4-rounds-and-todos).

## Risks and open questions

If Zod fails the SDK's schema type, tools use raw JSON Schema; record the gap for the SDK reference.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
