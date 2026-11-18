# 0028. Hold one USD budget per ticket across the three contexts, and hand every budget stop to a person

- **Status:** Accepted (owner, 2026-11-18); $3 in shadow, production at the shadow p99
- **Date:** 2026-11-18
- **Plan:** [build-agent.md, AD9](../plans/build-agent.md#ad9-one-budget-per-ticket-across-the-three-roles-and-every-budget-stop-hands-the-ticket-to-a-person-accepted)

## Context

Agent decision 9 asks for the per-ticket budget's value and what happens on a stop. ADR 0009 checks the USD cap before each model call, and HD9 passes a session's remaining budget to each run.

## Decision

The ticket session holds one budget; before each context, the workflow folds the usage of the ticket's child sessions and passes the remainder as the turn's budget. A `budget` stop, an unknown price, `max_steps` or `no_progress` in any context ends the ticket with a handoff whose reason names the stop, and nothing retries. Shadow runs under a $3 ceiling per ticket; the production budget is the p99 cost of resolved shadow tickets.

## Consequences

- The owner confirms the production value after shadow.
- Todo A13 tests every stop-to-handoff path.
