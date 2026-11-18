# S8a: GitHub Copilot SDK

| Field | Value |
| --- | --- |
| ID | `S8a` |
| Status | `done` |
| Plan | [L:SDK references §4](../../plans/sdk-references.md#4-the-eight-sdks) |
| Round / milestone | M2c (added 2026-11-18) |
| Depends on | [ mirror, verification harness and behavioral examples](../ready/ mirror, verification harness and behavioral examples.md) |
| Size | S7b-google-adk-reference |

## Goal

GitHub Copilot SDK, as the plan section describes.

## Context

- The [SDK references plan](../../plans/sdk-references.md): the language policy, S8 and the TypeScript gap report
- The finished references and their fact-checks

## Scope

**In scope**

- As named in the title; see the plan section

**Out of scope** (and which todo covers it)

- The comparison update (C4) and skills (K4)

## Tasks

- [x] Do the work the plan section describes, citing primary sources at recorded versions
- [x] Draft prose with `/anthropic-skills:writing` and review it with `/anthropic-skills:writing-review`
- [x] Run the local checks and push

## Acceptance criteria

- [x] The deliverables exist, every claim has a source, and review fixes are applied
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass

## Tests

The SDK harness's behavioral examples, where the todo has a harness.

## Docs to update

Root README; the relevant plan.

## Risks and open questions

Primary-language docs may be blocked by the network policy; ask the owner to allow specific hosts.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

- Pinned `@github/copilot-sdk@1.0.31`. It bundles Copilot runtime 1.0.109, whose source SHA matches `@github/copilot@1.0.109`.
- Docs mirrored from the public MIT `github/copilot-sdk` repo at tag `v1.0.31`, and committed. Nothing from the CLI package (GitHub's own license) is mirrored, and no binary is committed.
- Only the model is mocked. The real SDK and runtime run unmodified over JSON-RPC on stdio, and a local Anthropic-style mock is reached through the SDK's own BYOK `provider` setting, which needs no GitHub token. Every run happens inside `unshare -rn` (loopback-only network) with an allowlisted environment. The mock denies built-in tools by name, and `00-sandbox` asserts that the network is unreachable.
- 455 sources type-checked (132 pass first time; 138 once an undeclared `client`/`session` is declared; 36 API mismatches grouped by cause). Of 83 runnable blocks, 50 ran, 30 were skipped and 3 failed: two doc errors and one that needs enterprise settings.
- 10 behavioral examples pass. In the triage capstone, identity comes from trusted context, and the escalation waits for an approval decided later.
- Nine draft findings (`results/findings-draft.md`) feed S8b. I re-checked F1 against the JSDoc ("left pending") and against example 03 (denied).
- Parity: six official SDKs share one runtime, and TypeScript is first-class. The only gaps are Rust-only extras (`results/parity-draft.md`).
