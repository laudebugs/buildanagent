# L12q: Write the new tested examples the docs pages need

| Field | Value |
| --- | --- |
| ID | `L12q` |
| Status | `done` |
| Plan | [Publish and docs §4](../../plans/publish-and-docs.md#4-round-l-and-its-todos) (the L12 docs redesign) |
| Round / milestone | Round L (publish and docs, added 2026-11-23) |
| Depends on | [L12k](../done/L12k-docs-fences-gateway-figures.md) |
| Size | M (one pull request per package if it grows) |

## Goal

Give the docs pages for the protocol, harness and agent-safety packages the tested examples their `file=` fences will quote, so L12c's sidebar and the package pages can land without waiting for code. This is docs support: examples and their test wiring only, with no change to any package's `src/`. The manager asked for it on 2026-11-23.

## Context

- [L12](L12-docs-redesign.md) and [DS5](../../plans/publish-and-docs.md#ds5-the-docs-redesign-l12-proposed-2026-11-22): the package pages (L12g protocol and CLI, L12h and L12i harness, L12j agent-safety) and the rule that new examples carry their own tests.
- [examples.md](../../guidelines/examples.md): an example does one thing, reads top to bottom, uses only public entry points, names its numbers, holds no test scaffolding and is tested offline.
- `packages/harness/examples/` and `packages/agent-safety/examples/`: the patterns the existing examples and their tests follow.
- [`apps/docs/README.md`](../../../apps/docs/README.md): how a page quotes a `// #region` with a `file=` fence, and the rule that every `ts` block comes from a tested file.

## Scope

**In scope**

- `packages/protocol/examples/`: examples of what the protocol is for, such as framing and parsing a JSONL message and checking a message against the published schema.
- `packages/harness/examples/`: a sandbox example that provisions the fake sandbox, runs a command through it and shows the policy it enforces, and a compaction example that runs the context policy with a summary on a scripted model.
- `packages/agent-safety/examples/`: a bring-your-own-key example that guards a model call with the user's own key and a spend cap.
- A test for each, in the package's own `test/`, that runs it offline and fails when it stops working, and `// #region` markers so a docs fence can quote the part a page shows.

**Out of scope**

- Any change to a package's `src/`: if an example needs one, stop and tell the manager.
- The pages themselves, their figures and the sidebar (L12g to L12j, L12c).
- A real provider call, a real sandbox backend or a host-touching tool.
- Editing anything under `.github/`.

## Tasks

- [x] Write the protocol examples and their tests.
- [x] Write the sandbox example and its test, with an Opus review because it touches the sandbox policy.
- [x] Write the compaction example and its test.
- [x] Write the bring-your-own-key example and its test.

## Acceptance criteria

- [x] Each example runs offline on a scripted model or a fake, through its own test, and the test fails when the example stops working
- [x] Each example follows examples.md and has `// #region` markers for the parts a page quotes
- [x] No `src/` file changes, so no changeset
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

Each package's `test/`, beside its existing example tests.

## Docs to update

The plan's todo table, and the L12 todo if its example list changes.

## Risks and open questions

- A package may not export what an example needs from a public entry point; that is a `src/` change, so the example waits and the manager decides.
- The sandbox example touches the sandbox policy, so its reviewer checks that it runs only against the fake and no host file.

## Definition of done

- [x] Claimed: the first commit created this file in `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing`, and changed claims re-checked against their sources
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
- [x] Two code-review rounds run on the pull request (`/code-review high --max-findings default`, then `medium` and `low` after more than 6 confirmed findings, otherwise `low`), with every finding fixed or explained in a commit message
- [x] Copy reviewed with `/anthropic-skills:writing-review` after the code changes, with its findings fixed

## Outcome

All four example sets are in. No `src/`, `package.json` or `tsconfig.build.json` file changed, so no changeset. The protocol's `tsconfig.json` now includes `examples/`, so `pnpm typecheck` checks them, and none ships in a tarball (row L12q-10). Claims are in the fact-check log, rows L12q-1 to L12q-10.

- **Protocol** (`packages/protocol/examples/`, test `test/examples.test.ts`):
  - `read-stream.ts`: `readStream()` frames a chunked JSONL stream and decodes each message. A page can quote the region `read`.
  - `read-session-file.ts`: `summarizeSession()` counts a session file's entries by type, reports unreadable lines and stops at a newer format. Region: `read`.
  - `client-requests.ts`: `requestLines()` writes `session/create` and `turn/start`, and `describeServerMessage()` narrows the server's four message kinds. Regions: `requests` and `reply`.
  - The examples validate nothing against the JSON Schema: the schema files are not in the tarball and the validator is a dev dependency, so no public entry point offers it.
- **Harness** (`packages/harness/examples/compaction.ts`, test `test/examples/compaction.test.ts`): `chatWithCompaction()` runs three questions under a small budget, so the third turn starts with a summary. It returns the summary, the tokens before and after, and how many entries the summary replaced. Regions: `policy` (the context policy and harness), `run` (the session and turns) and `report` (reading the `compaction` entry).
- **Agent-safety** (`packages/agent-safety/examples/own-key-capped.ts`, test in `test/examples.test.ts`): `answerOnUserKey()` builds the provider with `explicitProvider()` from the caller's key, guards it with a 0.5 USD cap and returns the refusal text when a call could pass it. Regions: `provider` and `call`. The caller's `send` replaces the network `fetch`, which `explicitProvider()` accepts as its `fetch` option.
- **Harness sandbox** (`packages/harness/examples/sandbox-fake.ts`, test `test/examples/sandbox-fake.test.ts`): `runInFakeSandbox()` provisions `fakeSandbox()` with a policy that reads and writes `/work/repo`, reads `/opt/tool-cache` and reaches no host, runs a command, shows a write outside the write roots denied (`../outside.txt`, a harmless target) and reads the policy back. Regions: `policy`, `provision`, `run`, `denied` and `read-back`. The test also spies on `process.getBuiltinModule`, through which every Node-only part of the harness loads its modules, so it fails if the example touches the host.
