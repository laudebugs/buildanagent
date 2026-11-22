# N53: Bind a stdio client to a user, so `Resolution.by` is checked and not trusted

| Field | Value |
| --- | --- |
| ID | `N53` |
| Status | `ready` |
| Plan | [Build harness §4, Stage 6](../../plans/build-harness.md#46-stage-6-puts-the-protocol-its-transports-and-the-cli-over-the-harness) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N29](../done/N29-stdio-transport.md), [N30](../done/N30-cli.md) |
| Size | M |

## Goal

Let a host tell the dispatcher who is on the other end of a stdio connection, so that an approval's `Resolution.by` is checked against that identity instead of passed on as the client sent it. Today `buildanagent rpc` and `stdioTransport()` authenticate nobody: whoever holds the streams acts as the dispatcher's user. The owner decided on 2026-11-22 to ship the CLI that way, because the repository is already public, and to track this as its own todo.

## Context

- [N29](../done/N29-stdio-transport.md) and [N30](../done/N30-cli.md): the transport and the command that expose the limit, and the three places that state it (the `rpc` help text, the CLI README and the harness README).
- [ADR 0037](../../decisions/0037-multi-user-agent-platform.md): the platform's tenant rules, which a bound identity must serve.

## Scope

**In scope**

- A way for the host to hand `stdioTransport()` or the dispatcher's `connect()` an identity, and a rule for what a request that names another user does.
- `Resolution.by` checked against that identity on every approval, with a typed refusal when it differs.
- The three statements of the limit updated to say what is now checked.

**Out of scope**

- Authenticating the person: the host decides who the identity is; this todo only binds it and checks it.

## Tasks

- [ ] Decide the identity's shape with the owner (a user id, a signed token or a host callback), and record it in an ADR if it is a lasting choice.
- [ ] Bind it at connect time and check `Resolution.by` on every approval.
- [ ] Update the `rpc` help, the CLI README and the harness README.

## Acceptance criteria

- [ ] An approval whose `by` differs from the connection's identity is refused with a typed error and no resolution is written
- [ ] A connection with no identity behaves as today, and the docs still say so
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/server/` for the dispatcher and the stdio transport, and `packages/cli/test/rpc.test.ts` for the command.

## Docs to update

The CLI and harness READMEs, the `rpc` help text and the plan's todo table.

## Risks and open questions

- The identity's shape is the owner's call.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
