# 0039. Refuse every deploy that lacks a passing gate report for its exact commit, and keep the eval graders out of the generator's reach

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-agent-platform.md, PF4](../plans/build-agent-platform.md#pf4-a-check-and-deploy-gate-with-graders-the-generator-never-sees-accepted-adr-0039)

## Context

No product in the [agent-building platforms report](../research/deployment/agent-building-platforms.md#testing-a-generated-agent-before-showing-it-is-the-least-served-step) tests a generated agent before showing it. The same report records the Darwin Gödel Machine's failure: a variant removed the logging its hallucination detector relied on, and hiding the checking functions reduced how often that happened. A skill that tells a model to run tests is advice the model can skip.

## Decision

The gate is platform code that runs in a fresh sandbox after generation. It type-checks the project against the pinned SDK's types, runs the project's tests against the SDK's mock model with host-touching tools denied by name, and runs evals with positive and negative cases scored by graders the generator cannot read or edit. It signs a report for the exact commit. Deploy adapters accept only a deploy request that carries a passing, signed report for that commit, and every later deploy re-runs the gate.

## Consequences

- Todos F3 and F4 build the gate, reusing the verification harnesses' type-check and mock-model runners.
- The graders live in the platform, per template and per tenant, never in the user's repository.
- Todo F15 tests whether a generated project can read or alter the graders.
