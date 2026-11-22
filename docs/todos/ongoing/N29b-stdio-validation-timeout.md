# N29b: Check command params, bound the stdio write and settle N29's five questions

| Field | Value |
| --- | --- |
| ID | `N29b` |
| Status | `ongoing` |
| Plan | [Build harness §6.4](../../plans/build-harness.md#64-five-questions-that-follow-from-n29-wait-for-the-owner) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N29](../done/N29-stdio-transport.md), [N30](../done/N30-cli.md) |
| Size | M |

## Goal

Act on the owner's answers to the five questions N29 left open (2026-11-22): a command with malformed params gets `InvalidParams`, the stdio transport stops on a client that closes its input and never reads, and the plan's §6.4 reads as answered. The same change fixes the flaky `stdio.test.ts` case that waits on a client that stops reading.

## Context

- [Build harness §6.4](../../plans/build-harness.md#64-five-questions-that-follow-from-n29-wait-for-the-owner): the five questions and their options.
- [N29's Outcome](../done/N29-stdio-transport.md#outcome): the named limits this todo closes or records.
- [N53](../ready/N53-stdio-identity-binding.md): the follow-up for identity binding, already open.

## Owner's answers (2026-11-22, relayed by the manager session)

1. **Yes.** A bad command gets `InvalidParams`, validated with `@earendil-works/pi-schema` 1.5.2, which the harness declares itself, so the lockfile gains no package. Each command needs its own branch picked out of `protocol.schema.json`'s one `anyOf`. The existing `InvalidParams` cases (`fromSeq`, an unissued cursor) stay.
2. **Keep `"id": null`** for an unreadable request (JSON-RPC 2.0 §5). Record the choice and the `@modelcontextprotocol/client` 2.4.0 incompatibility.
3. **Ship `rpc` without identity binding**, as an accepted and documented limit: whoever holds the two streams acts as the dispatcher's user, and `Resolution.by` is passed on as sent. The harness README, the `rpc` help text and the plan state it plainly, because the repository is already public. N53 tracks the binding.
4. **Yes.** The transport gets its own write timeout, an option on `stdioTransport` with a safe default. It logs the reason and closes the connection.
5. **Accepted:** `json-rpc-2.0` 1.8.1 as the dev dependency.

## Scope

**In scope**

- A params validator over `protocol.schema.json` that runs before each command's handler and answers `InvalidParams`.
- The write timeout on `stdioTransport`, tested with a fake clock, and the flaky `stdio.test.ts` case rewritten to use it.
- The plan's §6.4 (answer, date and who for each question), the harness README, and fact-check rows.

**Out of scope** (and which todo covers it)

- Identity binding (N53).
- Any change to the `"id": null` answer.

## Tasks

- [ ] Declare `@earendil-works/pi-schema` 1.5.2 in the harness's `package.json`, pinned exactly, with the lockfile gaining no new package.
- [ ] Validate each command's params against its schema branch before the handler runs; keep the existing `InvalidParams` cases.
- [ ] Add `writeTimeoutMs` to `stdioTransport` with a default, a logged reason and a closed connection; test it with a fake clock.
- [ ] Rewrite the flaky "a client that stops reading" test so it waits on the fake clock, with no real-time wait.
- [ ] Update §6.4, the harness README and the plan's statement of the identity limit; fact-check each new claim.

## Acceptance criteria

- [ ] A command with params that break its schema is answered `InvalidParams` and no handler runs.
- [ ] A client that closes its input and never reads ends the transport after the timeout, with a logged reason.
- [ ] The stdio tests use no real-time wait for the timeout.
- [ ] §6.4 shows each question answered with its date and who answered.
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/harness/test/server/` (a validation test over every command and the stdio timeout case).

## Docs to update

The plan's §6.4, the harness README's stdio section and its list of what the transport does not check.

## Risks and open questions

The schema's `anyOf` may not give one clean branch per command; if it does not, record how each branch is picked.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

To be written when the work is done.
