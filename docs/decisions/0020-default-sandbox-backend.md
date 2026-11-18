# 0020. Default to `srt` for interactive runs and Docker for headless runs, and run `none` only on an explicit unsafe flag

- **Status:** Accepted (owner, 2026-11-18); todo N19's measurements can still revise it
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD4](../plans/build-harness.md#hd4-srt-for-interactive-runs-and-docker-for-headless-runs-accepted)

## Context

Harness decision 4 asks for the default sandbox backend. `srt` costs very little but shares the host kernel; Docker's strength depends on its setup; neither has been measured on our hardware; and Claude's settings-file sandbox fails open.

## Decision

Interactive local runs default to `srt`; headless runs and eval trials default to Docker with `--cap-drop ALL --read-only --network none`. `none` requires `{ tier: "none", unsafe: true }`, is stamped in `env_stamp` and warns at session start. Every backend fails closed. No backend claims to stop a hostile process. The credential proxy injects credentials on local reverse-proxy routes and filters all other egress by name, with no TLS interception (HD15).

## Consequences

- Todo N19 measures cold start and per-call overhead and may move interactive runs to Docker.
- Clarified by P4 (2026-11-18): any change after N19 is a new ADR that supersedes this one, because an accepted record is never rewritten.
- The owner decides the threat model and whether macOS is a supported host.
