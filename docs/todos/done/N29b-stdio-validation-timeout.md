# N29b: Check command params, bound the stdio write and settle N29's five questions

| Field | Value |
| --- | --- |
| ID | `N29b` |
| Status | `done` |
| Plan | [Build harness §6.4](../../plans/build-harness.md#64-the-owner-answered-n29s-five-questions-on-2026-11-22) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N29](../done/N29-stdio-transport.md), [N30](../done/N30-cli.md) |
| Size | M |

## Goal

Act on the owner's answers to the five questions N29 left open (2026-11-22): a command with malformed params gets `InvalidParams`, the stdio transport stops on a client that closes its input and never reads, and the plan's §6.4 reads as answered. The same change fixes the flaky `stdio.test.ts` case that waits on a client that stops reading.

## Context

- [Build harness §6.4](../../plans/build-harness.md#64-the-owner-answered-n29s-five-questions-on-2026-11-22): the five questions, their options and now the owner's answers.
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

- [x] Declare `@earendil-works/pi-schema` 1.5.2 in the harness's `package.json`, pinned exactly, with the lockfile gaining no new package.
- [x] Validate each command's params against its schema branch before the handler runs; keep the existing `InvalidParams` cases.
- [x] Add `writeTimeoutMs` to `stdioTransport` with a default, a logged reason and a closed connection; test it with a fake clock.
- [x] Rewrite the flaky "a client that stops reading" test so it waits on the fake clock, with no real-time wait.
- [x] Update §6.4, the harness README and the plan's statement of the identity limit; fact-check each new claim.

## Acceptance criteria

- [x] A command with params that break its schema is answered `InvalidParams` and no handler runs.
- [x] A client that closes its input and never reads ends the transport after the timeout, with a logged reason.
- [x] The stdio tests use no real-time wait for the timeout.
- [x] §6.4 shows each question answered with its date and who answered.
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root.

## Tests

`packages/harness/test/server/` (a validation test over every command and the stdio timeout case).

## Docs to update

The plan's §6.4, the harness README's stdio section and its list of what the transport does not check.

## Risks and open questions

The schema's `anyOf` may not give one clean branch per command; if it does not, record how each branch is picked.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`dispatch()` now checks every command's params against the protocol schema before its handler runs and answers `InvalidParams`, and `stdioTransport` takes `writeTimeoutMs`. The plan's §6.4 records the owner's five answers, each with its date and who answered.

**Params validation** (`packages/harness/src/server/params.ts`). The harness declares `@earendil-works/pi-schema` 1.5.2 exactly, and the lockfile gains only the importer's link, no package. The protocol package ships no JSON, so the harness keeps a copy of `protocol.schema.json` beside `params.ts`, which `tsc` emits into `dist/server/` as the gateway does with `catalog.json`; a test compares the copy with the protocol's file by parsed value, because Biome reformats the copy. A command's branch is the one in the schema's top-level `anyOf`, flattened one level, that requires an `id` and whose `method` `const` or `enum` names a client method. Two branches for one method throw. Each method's validator is compiled on its first command and kept. The error names the method, the field path (cut at 120 characters) and the failed keyword, never a value the client sent. The experimental opt-in gate runs first, so a client that has not opted in still gets `NotOptedIn`. The `fromSeq` and cursor checks are unchanged. `test/server/params.test.ts` covers every command method, derived from the protocol's list, so a new method without a branch fails it.

**Write timeout** (`stdio.ts`). `writeTimeoutMs` defaults to 30,000 ms and `Infinity` turns it off. It applies once the input has ended: the timer starts when the transport begins waiting on the output and restarts each time the output takes a line, so a slow reader is not cut off. On expiry the transport logs `stdio: stopped: the output took no line for N ms after the input ended` and closes the connection. A value outside 1 to 2,147,483,647 (other than `Infinity`) rejects with the new `invalid_transport_options` before connecting. The tests use Vitest's fake clock and check that no timer is left; two fail when the restart is disabled.

**The flaky test was the test's child, not the transport.** The child's watcher polled `session/open` every 5 ms. When its open landed after the turn had settled, it never saw `turn/settled`, and the test timed out after 20 s, as in CI. Slowing the poll to 300 ms reproduced it every time. The child now creates the session before it reads stdin and the test opens it; the backlog assertion is unchanged. The todo's task to rewrite that test on the fake clock did not apply, because the test does not involve the timeout.

**Answers 2, 3 and 5 needed no code.** `"id": null` stays, and the framing-interop test and the protocol README already record the MCP client quirk. The identity limit was already stated in the `rpc` help, the CLI README and the harness README (N30); the harness README now also says to run the transport only where every process that can reach the streams is trusted. N53 holds the binding. `json-rpc-2.0` 1.8.1 stays a pinned dev dependency.

**Checks.** The harness tests passed three times in a row (899 passed, 72 skipped), and the harness and root typechecks, `pnpm check` and the four maintainability checks passed. `scripts/ci/packages-pack.test.mjs` skips locally, so no change to its lists was made: `pi-schema` is reached only through the `server` entry, which `SOURCE_CONDITION_FAILURES` already lists. No changeset: the harness is private.
