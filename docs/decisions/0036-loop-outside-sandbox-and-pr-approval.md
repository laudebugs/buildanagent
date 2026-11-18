# 0036. Run the coding agent's loop outside the sandbox, and make the draft pull request its approval point

- **Status:** Accepted (owner, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-coding-agent.md, CA4 and CA6](../plans/build-coding-agent.md#ca4-the-loop-runs-in-a-durable-object-outside-the-sandbox-accepted)

## Context

A cloud coding agent must settle two placements: where its loop runs and where the owner approves its work. For the loop, OpenHands V1 runs it inside the container; mini-swe-agent and Open SWE keep it outside and send each command in ([portable agents report](../research/deployment/portable-agents.md#cloud-coding-agents-are-a-control-plane-around-a-disposable-vm)). For approval, our Copilot research found that the cloud agent's draft pull request is the only Copilot surface that holds a whole change for one human decision ([Copilot diff review report](../research/agent-ui/copilot-diff-review.md#visual-studio-and-jetbrains-review-after-the-write-the-cloud-agent-reviews-before-the-merge)).

## Decision

The loop runs in the task's Durable Object (or the target's equivalent host), and the sandbox only runs commands. The sandbox holds no credentials. Inside the sandbox and its allowlist, commands run without per-call prompts; any call outside those bounds becomes a signed pause. The owner's merge of the draft pull request is the commit point.

## Consequences

- A reclaimed sandbox costs a resume, because the session log lives outside it; todo W4 tests resume onto a fresh sandbox.
- The permission pipeline (HD12) is configured for this profile in W2; no new pipeline mode is added.
- Every outward write (push, API call) carries an idempotency key persisted before the call, so a replayed wake cannot open a second pull request.
