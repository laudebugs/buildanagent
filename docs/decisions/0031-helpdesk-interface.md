# 0031. Route every read and write through one `Helpdesk` interface, with a fake for tests, a shadow wrapper for rollout and a real adapter the owner names

- **Status:** Proposed — owner to confirm (which helpdesk)
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD14](../plans/build-agent.md#ad14-one-helpdesk-interface-is-the-agents-only-way-out-with-a-fake-for-tests-a-shadow-wrapper-for-rollout-and-a-real-adapter-the-owner-names-owner-to-confirm)

## Context

Offline tests need a helpdesk that touches nothing real, shadow mode needs reads to run while writes are recorded, and the harness's `shadow` permission mode replaces every tool's execution, reads included.

## Decision

All tools and code steps use one `Helpdesk` interface. Its reply method takes no recipient. `fakeHelpdesk()` serves every offline test, `shadowHelpdesk(real)` passes reads through and records writes, and the real adapter (todo A24) reaches the owner's helpdesk only through the harness's credential proxy.

## Consequences

- The owner names the helpdesk, a sandbox account, the API credential's scopes and the approval surface that authenticates approvers.
- If the harness gains shadow mode by tool (build-agent.md §3.7, H7), the shadow wrapper can be removed.
