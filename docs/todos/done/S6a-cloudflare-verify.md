# S6a: Cloudflare Agents

| Field | Value |
| --- | --- |
| ID | `S6a` |
| Status | `done` |
| Plan | [SDK references §4](../../plans/sdk-references.md#4-the-eight-sdks) |
| Round / milestone | M2c (added 2026-11-18) |
| Depends on | [S5b](../done/S5b-langchain-reference.md) |
| Size | S5b-langchain-reference:L |

## Goal

Cloudflare Agents, following the eight-step SDK process in [AGENTS.md](../../../AGENTS.md#process-for-documenting-an-sdk) and the plan's S6/S7 notes, including the language policy (TypeScript references with a parity check against the SDK's primary language).

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

- Pinned `agents@0.33.0`, `@cloudflare/think@0.23.0` and `@cloudflare/ai-chat@0.12.2`, plus the vercel harness's AI SDK pins. The local runtime is `miniflare@5.20261103.0-beta` (`workerd@1.20261103.1`), the version stable wrangler 4.157.0 ships; the README explains the beta.
- Docs mirrored from the `cloudflare/agents` repo at tag `agents@0.33.0` and the `cloudflare/cloudflare-docs` agents pages at a recorded commit, with MIT, CC-BY-4.0 and attribution files. 24 repo pages changed after the tag; the npm package ships docs identical to the tag.
- Every run happens inside workerd: esbuild bundles each example, Miniflare provides SQLite Durable Objects and a mocked Workers AI binding, model providers are shimmed to `MockLanguageModelV4`, and outbound hosts other than localhost get a 403.
- 1,927 doc blocks type-checked: 331 pass, 1,227 fragment, 294 syntax, 17 other, 56 API mismatches, 2 ahead of the release. Of 204 runnable blocks, 171 ran with no errors, 3 were refused by the network block, and 28 were skipped. 9 of 9 behavioral examples pass.
- Eighteen draft findings (`results/findings-draft.md`) feed S6b. I re-checked F1 (Think's `runTurn` drops `body`) and F6 (the docs' `routeAgentRequest(...) ||` without `await`) against the source.
- Gaps: Workflows (no binding configured), containers, Browser Rendering, voice, x402, email and OAuth MCP flows are not run offline.
