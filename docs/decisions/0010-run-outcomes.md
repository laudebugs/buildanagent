# 0010. Return run outcomes as a discriminated union, and offer `runOrThrow()` for typed errors

- **Status:** Accepted (P4 review, 2026-11-18)
- **Date:** 2026-11-18
- **Plan:** [build-sdk.md, D10](../plans/build-sdk.md#d10-a-discriminated-result-union-plus-runorthrow-for-callers-who-want-exceptions)

## Context

Guide decision 10 weighs stop reasons, which the research prefers, against typed errors, which a caller cannot ignore. Its test is which version lets an unhandled outcome compile.

## Decision

`RunResult` is discriminated by `stopReason`, and only the `done` variant carries `output`. `runOrThrow()` turns other outcomes into a `RunStoppedError` that carries the resumable context and an `isInstance` marker. Exceptions stay reserved for programmer errors.

## Consequences

- A type test pins that reading `output` without narrowing fails to compile.
- Every result variant carries usage, cost and a resumable context.
