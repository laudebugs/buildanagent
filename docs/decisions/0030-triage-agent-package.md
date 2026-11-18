# 0030. Ship the triage agent as one private package, `@agent-speak/triage-agent`, with one subpath per removable component

- **Status:** Accepted (P4 review, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD13](../plans/build-agent.md#ad13-one-private-package-agent-speaktriage-agent-with-one-subpath-per-removable-component)

## Context

The agent's code needs a home. The harness plan rules agent policy out of the harness, and the SDK and harness plans both chose subpath exports over many small packages.

## Decision

One package, `packages/triage-agent`, `private: true`, with subpaths `./policy`, `./tools`, `./roles`, `./workflow`, `./helpdesk`, `./evals`, `./rollout` and `./testing`. The taint hook, policy hook, outbound checks and shadow wrapper can each be switched off for an ablation; the tier table and identity binding cannot.

## Consequences

- Todo A1 scaffolds the package; dependencies are the workspace's SDK, harness and evals packages plus `zod` 4.6.7, which todo A3 checks against the SDK's schema type.
