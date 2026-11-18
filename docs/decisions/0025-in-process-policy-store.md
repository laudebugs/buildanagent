# 0025. Keep cross-run counters and kill-switch flags in an in-process snapshot, read synchronously by a permission hook

- **Status:** Proposed (provisional until todo A7)
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD4](../plans/build-agent.md#ad4-an-in-process-policy-snapshot-read-synchronously-by-a-permission-hook-with-a-measured-kill-switch-delay-provisional)

## Context

Agent decision 4 asks where cross-run counters and kill-switch flags live and how the pipeline reads them on every call without a network round trip. The kill switch must degrade by tool, tier, tenant or globally and act mid-run without a deploy.

## Decision

A `PolicyStore` keeps an in-memory snapshot that reads synchronously with no I/O; `consume()` persists a counter before it returns true. `memoryPolicyStore()` serves tests and `filePolicyStore()` serves one host, with atomic renames and a 1-second polling fallback. Intake, a permission hook (deny only), a `shouldStop` interceptor and code-initiated calls all read it. A multi-host store waits for a multi-host deployment.

## Consequences

- The agent enforces R4 through the harness's existing permission hooks, so `PermissionConfig.policyStore` can be dropped or typed (build-agent.md §3.7, H6).
- Todo A7 measures read latency and the delay from a flip to a stopped context; the design stays if the delay is within 2 seconds.
