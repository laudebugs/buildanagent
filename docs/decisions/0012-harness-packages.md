# 0012. Ship the harness as four packages: protocol, harness with one subpath per component, CLI and evals

- **Status:** Accepted (P4 review, 2026-11-18); names amended by [0044](0044-rename-to-buildanagent.md) (2026-11-19)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD13](../plans/build-harness.md#hd13-four-packages-with-one-subpath-export-per-removable-component)

## Context

The harness guide defines one typed protocol package first, wants the CLI to be a replaceable client, and requires every component other than the log, the pipeline and the protocol to be removable for ablation. One package hides those boundaries; a package per component multiplies manifests before any component has a second consumer.

## Decision

`@agent-speak/protocol` holds the typed union, the session-entry union, framing and generated JSON Schema. Its emitted JavaScript imports nothing at run time; it declares `@agent-speak/gateway` and `@agent-speak/sdk` as dependencies for types only, and never depends on the harness. `@agent-speak/harness` holds the session log, context policy, registry, MCP client, permissions, sandbox, credentials, extensions, telemetry, ablation and dispatcher, each behind its own subpath export. `@agent-speak/cli` is the `agent-speak` binary and a client of the in-process transport. `@agent-speak/evals` holds reports, trajectory conversion and the offline replay suite, with the Inspect task beside it in Python. All four live in `packages/` beside the SDK's two.

## Consequences

- Todo N1 scaffolds the four packages; no change to `pnpm-workspace.yaml` beyond B1's `packages/*`.
- A component that gains an outside consumer can move to its own package later without changing its subpath's API.
- P4 (2026-11-18) moved the `SessionEntry` union into the protocol package, so protocol → harness is no longer a cycle (plan review R2); `@agent-speak/harness/session` re-exports it.
