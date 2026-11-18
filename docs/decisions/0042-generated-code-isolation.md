# 0042. Run generated code only in a fresh hosted sandbox per task, deny egress by default, and reject stdio MCP commands

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-agent-platform.md, PF9](../plans/build-agent-platform.md#pf9-generated-code-runs-only-in-a-fresh-hosted-sandbox-accepted-adr-0042)

## Context

Generated code is written by a model from a stranger's description. The [agent-building platforms report](../research/deployment/agent-building-platforms.md#approvals-are-common-but-signed-approvals-and-side-effect-undo-exist-nowhere) found the low-code category's security record weak, with in-process sandbox escapes and MCP configuration used for remote code execution. It drew three lessons: run generated code in a VM or container, never an in-process sandbox; never let a generated config name a stdio MCP command; and never store a user's model key in the builder's own database.

## Decision

Every generator run and every gate run gets a fresh hosted sandbox for one task and one tenant, Cloudflare Sandbox or E2B behind `SandboxClient`. Local `srt` and Docker backends are never used for tenant code. Egress is denied by default, with package registries and the user's named MCP hosts allowed. The gate rejects any generated MCP configuration that names a command instead of a URL. The third lesson is applied by ADR 0040.

## Consequences

- Todo F11 builds the sandbox profile and the MCP-config rule; it depends on the hosted backends N46b and N47b.
- Todo F15 runs escape, egress and MCP-config attacks before sign-ups open.
