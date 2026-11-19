# 0001. Ship the SDK as two packages, a gateway and a loop, under `packages/`

- **Status:** Accepted (P4 review, 2026-11-18); names amended by [0044](0044-rename-to-buildanagent.md) (2026-11-19)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D1](../plans/build-sdk.md#d1-two-packages-because-the-gateway-has-consumers-that-never-run-the-loop)

## Context

The [agent-SDK guide](../guides/agent-sdk.md#12-open-decisions-for-round-p) (decision 1) asks whether the gateway, the loop and the test doubles ship as one package or several, and settles it by one rule: split if any consumer needs the gateway without the loop. Three planned consumers do: the harness's summarisation layer, the agent's tool-less reader and drafter, and the eval bridge. The provider spec must also version apart from the loop.

## Decision

We ship `@agent-speak/gateway` (transcript types, the v1 model spec, the gateway runtime, usage and cost, adapters as subpath exports) and `@agent-speak/sdk` (loop, tools, hooks, events, OTel observer, and the run `Context`, which holds the SDK's pause records). The gateway names no SDK type, so the dependency runs one way. Each has a `./testing` subpath. Our own packages live in a new top-level `packages/` directory, apart from the third-party harnesses in `verify/`.

## Consequences

- `pnpm-workspace.yaml` needs a `packages/*` entry (todo B1).
- The gateway can release a new spec version without a loop release, and the loop depends on it with `workspace:*`.
- Adapters stay subpaths until a third adapter or a heavy dependency justifies a package of its own.
- P4 (2026-11-18) moved `Context` from the gateway to the SDK, because its `pending` field names `SignedPendingRequest` (plan review R1); the gateway keeps `ModelContext`.
