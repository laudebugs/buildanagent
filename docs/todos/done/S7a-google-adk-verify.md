# S7a: Google ADK

| Field | Value |
| --- | --- |
| ID | `S7a` |
| Status | `done` |
| Plan | [SDK references §4](../../plans/sdk-references.md#4-the-eight-sdks) |
| Round / milestone | M2c (added 2026-11-18) |
| Depends on | [ mirror, verification harness, behavioral examples and TS parity check](../ready/ mirror, verification harness, behavioral examples and TS parity check.md) |
| Size | S6b-cloudflare-reference:L |

## Goal

Google ADK, following the eight-step SDK process in [AGENTS.md](../../../AGENTS.md#process-for-documenting-an-sdk) and the plan's S6/S7 notes, including the language policy (TypeScript references with a parity check against the SDK's primary language).

## Context

- The [SDK references plan](../../plans/sdk-references.md), sections S6, S7 and the language policy
- The five finished references as the structure to mirror

## Scope

**In scope**

- As named in the title; see the plan section for packages, docs, test model and behaviors

**Out of scope** (and which todo covers it)

- Deployment to the vendor's platform; primary-language harnesses (the parity check reads their docs only)

## Tasks

- [x] Do the work the title names, following the plan section
- [x] Draft any prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [x] Run the local checks and push

## Acceptance criteria

- [x] The deliverables named in the plan exist and pass review
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The SDK harness's behavioral examples, where the todo has a harness.

## Docs to update

Root README; the relevant plan.

## Risks and open questions

Cloudflare needs the Workers runtime locally (workerd); Google's TypeScript ADK lags its Python primary. Record both in the fact-checks.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- Pinned `@google/adk@2.5.0`, the owner's pin, six days old. `@google/genai` is 2.32.0, the newest in ADK's range. A commented override sets `gaxios@6>uuid` to 11.1.1 for GHSA-w5hq-g745-h8pq.
- Docs mirrored from `google/adk-docs` and `google/adk-js` (both Apache-2.0), TypeScript only: Python, Go, Java and Kotlin tabs dropped, `--8<--` snippets resolved.
- ADK ships no fake model, so a `ScriptedLlm` subclass of `BaseLlm` is registered with `LLMRegistry` for doc runs. Non-local `fetch` and http are blocked, and host tools are denied by name.
- 304 sources type-checked: 221 pass, 62 fragment, 12 syntax and 9 API mismatches, all doc errors grouped by cause. Of 163 runnable sources, 109 ran, 54 were skipped for stated needs, and none errored. 8 of 8 behavioral examples pass.
- Sixteen draft findings (`results/findings-draft.md`) feed S7b. I re-checked F2, the confirmation docs that tell TypeScript users to hand-roll a gate `FunctionTool.requireConfirmation` already provides.
- Parity draft (`results/parity-draft.md`): TypeScript lacks LiteLLM, context caching and compaction, session rewind and YAML config, and is weaker on output-schema validation and parallel tool execution. Many TypeScript features are documented only for Python. 152 of 261 "Supported in ADK" tags list Python but not TypeScript.
