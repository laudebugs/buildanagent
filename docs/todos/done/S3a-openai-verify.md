# S3a: OpenAI Agents SDK: mirror, verification harness and behavioral examples

| Field | Value |
| --- | --- |
| ID | `S3a` |
| Status | `done` |
| Plan | [SDK references §4 S3](../../plans/sdk-references.md#s3-openai-agents-sdk-done) |
| Round / milestone | Round S (SDK references), M1 |
| Depends on | [S2](../done/S2-pi-reference.md) |
| Size | L |

## Goal

Build `verify/openai-agents-sdk/`, the offline harness for `@openai/agents`, and run the first five steps of the SDK process on it. The reference docs in S3b depend on these verified facts.

## Context

- the eight-step process in [AGENTS.md](../../../AGENTS.md#process-for-documenting-an-sdk) and its lessons in the [plan §2](../../plans/sdk-references.md#2-what-s1-and-s2-taught-us)
- The upstream repo `openai/openai-agents-js`: docs under `docs/src/content/docs/` (Astro, `.md` and `.mdx`) and runnable code under `examples/`
- [verify/pi/](../../../verify/pi/) as the closest template, because this SDK also runs its loop in-process

## Scope

**In scope**

- Pin `@openai/agents` and its sub-packages exactly, at the latest release that is at least two weeks old
- Mirror the docs and `examples/` from the matching release tag, with the MIT license (committed)
- Extraction that resolves MDX code embeds to their source files
- A scripted test model through the SDK's `Model` or `ModelProvider` interface, or a first-party fake if the SDK ships one
- An allowlisted child environment and a network guard
- The API-surface diff and 6–9 behavioral examples, ending with the triage-agent capstone

**Out of scope** (and which todo covers it)

- The guide and fact-check (S3b)
- The realtime and voice agents, and the Python SDK

## Tasks

- [x] Research: confirm versions, the docs layout, the release tag, the license, and the SDK's testing seam; write findings into the todo's notes
- [x] Create `verify/openai-agents-sdk/` as a workspace package with exact pins and the shared tsconfig
- [x] Write `scripts/fetch-docs.mjs` and commit the mirror to `docs/reference/openai-agents-sdk/source/` with `_manifest.json`
- [x] Write `scripts/extract-examples.mjs`, resolving `.mdx` embeds and copying `examples/` files with their relative imports intact
- [x] Write `scripts/typecheck-examples.mjs` (port from Pi) and classify every error; fix harness faults before recording findings
- [x] Write the test model and `scripts/run-examples.mjs`, with the environment allowlist and network guard
- [x] Write `scripts/factcheck-api.mjs` for the documented surfaces: agent options, run options, tool definitions, guardrails, run events and stream events
- [x] Write behavioral examples: hello agent, function tool, handoff, guardrail tripwire, human approval and resume from `RunState`, session, structured output, and the triage capstone
- [x] Run `pnpm run verify`, commit `results/`, and push

## Acceptance criteria

- [x] `pnpm --filter @buildanagent/verify-openai-agents-sdk test` passes offline
- [x] `pnpm run verify` inside the package regenerates every result file
- [x] Every Tier 1 api-mismatch is classified as a docs, SDK or harness issue
- [x] `pnpm check` and `pnpm typecheck` pass at the root

## Tests

The behavioral examples in `verify/openai-agents-sdk/examples/`, run by `pnpm test`.

## Docs to update

Root README SDK table; `verify/openai-agents-sdk/README.md`; AGENTS.md if the process gains a lesson.

## Risks and open questions

MDX embeds may hide code from the extractor; report any unresolved embed. If the SDK has no fake model, keep the scripted one minimal and say so in the fact-check.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
