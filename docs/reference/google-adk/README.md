# Google ADK reference

TypeScript reference for Google's [Agent Development Kit](https://github.com/google/adk-js), pinned to **`@google/adk@2.5.0`** with `@google/genai@2.32.0` and `zod@4.6.7`. All three packages are open source: ADK and genai under Apache-2.0, zod under MIT. Python is ADK's primary language (`google-adk` 2.14.1 as of November 2026), so the guide carries a TypeScript parity section. The owner added ADK as the seventh SDK on 2026-11-18.

**Pin decision.** 2.5.0 was published on 2026-11-12 and is still the latest release as of November 2026. On 2026-11-18, when it was six days old, the owner chose it over the one-week rule in [AGENTS.md](../../../AGENTS.md#coding-standards) ([plan, S7](../../plans/sdk-references.md#s7-google-agent-development-kit-added-2026-11-18)). `@google/genai@2.32.0` is the newest release in 2.5.0's `^2.29.1` range.

| File | What it is |
|---|---|
| [guide.md](guide.md) | Our reference: `LlmAgent` and `Runner`, function tools, the deprecated workflow agents and the graph `Workflow`, sessions and state, callbacks and plugins, structured output, tool confirmation, offline testing, a production checklist, the triage-agent capstone and the TypeScript parity section |
| [fact-check.md](fact-check.md) | How accurate the docs are: type-checks of 304 sources, offline runs of 163, an API-surface diff, behavioral tests and 16 findings |
| [`source/`](source/) | The docs mirror. `source/adk-docs/` comes from `google/adk-docs` at commit `ff7a5f56` (2026-11-17): every Markdown page and the TypeScript snippets. `source/adk-js/` comes from `google/adk-js` at tag `main-v2.5.0` (`b1b94c0d`, the `gitHead` npm records for 2.5.0): samples, repo guides, READMEs and the changelog. Both are Apache-2.0, so the mirror is committed with their `LICENSE` files. `_manifest.json` records every file, commit and the fetch date |
| [../../../verify/google-adk/](../../../verify/google-adk/) | Verification harness: the scripted `BaseLlm`, the network-blocking preload, and our 8 verified examples |

The docs site renders adk-docs main, and that repo has no release tags, so the mirror records a commit. No page runs ahead of 2.5.0 at that commit ([harness README](../../../verify/google-adk/README.md#why-the-docs-mirror-is-from-main)).

## Regenerate the mirror and re-verify

```bash
pnpm install            # at the repo root: installs every harness
cd verify/google-adk
pnpm run fetch-docs     # -> docs/reference/google-adk/source/ (commit and tag pinned in scripts/fetch-docs.mjs)
pnpm run verify         # all tiers; writes verify/google-adk/results/*.json
```

`node scripts/run-examples.mjs examples --only 01-function-tool,07-tool-confirmation` reruns a subset without overwriting `results/run-examples.json`.

## Security override

`@google/adk@2.5.0` pulls in `uuid@9` through `@google-cloud/vertexai@1.12.0`, `google-auth-library@9` and `gaxios@6.7.1`, which carries GHSA-w5hq-g745-h8pq (moderate). No parent release carries the fix, so `pnpm-workspace.yaml` overrides `gaxios@6>uuid` to `11.1.1`. That release is the newest fixed one that keeps the CommonJS entry `gaxios@6` requires, because `uuid` 12 and later are ESM-only. Remove the override once vertexai moves to `google-auth-library` 10 ([harness README](../../../verify/google-adk/README.md#security-alerts-2026-11-18)).

**Held on 2026-11-22.** The weekly update (#339) proposed `@google/genai` 3.3.0 and `@a2a-js/sdk` 1.3.0, and we kept 2.32.0 and 0.3.14. Both are majors outside the ranges that `@google/adk` 2.5.0, still the latest release, declares (`^2.29.1` and `^0.3.10`). A harness that checks ADK against a dependency ADK does not support tests nothing a reader can install: with genai 3.3.0 two of our samples (`samples/flows` and `samples/models`) stopped type-checking against ADK's genai 2.x types. The pins move when a release of ADK widens its ranges, which is also what the A2A 1.0 hold in the [A2A research](../../research/a2a/agent-to-agent-protocols.md) waits for.

## Upgrading the pinned version

1. Bump `@google/adk`, `@google/genai` and `@a2a-js/sdk` in `verify/google-adk/package.json` to exact releases at least one week old, with genai and `@a2a-js/sdk` inside ADK's declared ranges (`^2.29.1` and `^0.3.10` for 2.5.0), or to the latest fixed release if a pin has a known vulnerability.
2. Update `JS_TAG` (the `main-v<version>` tag that matches the npm `gitHead`) and `DOCS_COMMIT` in `scripts/fetch-docs.mjs`, then run `pnpm install`, `pnpm run fetch-docs` and `pnpm run verify`.
3. Re-check F2 (`requireConfirmation` in the confirmation docs), F8 (`Workflow` experimental), F10 (`outputSchema` only logged), F11 (sequential tool calls) and F13 (the workflow-agent deprecation) against the new release. Check whether the `uuid` override is still needed.
4. Review `ahead-of-release` entries in `results/typecheck-docs.json` and any support tag in `checks.supportTags.typescriptNewerThanPinned` by hand.
5. Diff `results/*.json` against the previous run, then update `guide.md`, `fact-check.md` and the parity section, which feeds todo C5's `docs/comparison/typescript-gaps.md`.
