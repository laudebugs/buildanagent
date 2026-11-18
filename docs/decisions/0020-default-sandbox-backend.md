# 0020. Default to `srt` for interactive runs and Docker for headless runs, and run `none` only on an explicit unsafe flag

- **Status:** Proposed — owner to confirm (after todo N19)
- **Date:** 2026-11-18
- **Plan:** [build-harness.md, HD4](../plans/build-harness.md#hd4-srt-for-interactive-runs-and-docker-for-headless-runs-owner-to-confirm)

## Context

Harness decision 4 asks for the default sandbox backend. `srt` costs very little but shares the host kernel; Docker's strength depends on its setup; neither has been measured on our hardware; and Claude's settings-file sandbox fails open.

## Decision

Interactive local runs default to `srt`; headless runs and eval trials default to Docker with `--cap-drop ALL --read-only --network none`. `none` requires `{ tier: "none", unsafe: true }`, is stamped in `env_stamp` and warns at session start. Every backend fails closed. No backend claims to stop a hostile process. The credential proxy injects credentials on local reverse-proxy routes and filters all other egress by name, with no TLS interception (HD15).

## Consequences

- Todo N19 measures cold start and per-call overhead and may move interactive runs to Docker.
- The owner decides the threat model and whether macOS is a supported host.
