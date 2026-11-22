# N18: Sandbox escalation state machine

| Field | Value |
| --- | --- |
| ID | `N18` |
| Status | `done` |
| Plan | [Build harness §4, Stage 4](../../plans/build-harness.md#44-stage-4-adds-the-sandbox-backends-and-the-credential-proxy) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N15](../done/N15-sandbox-interface.md), [N13](../done/N13-signed-approvals.md) |
| Size | M |

## Goal

Turn a sandbox denial into a tested, host-side state transition: under `never` the denial returns to the model, under `on-request` it becomes a signed approval and, once approved, one rerun with a widened policy.

## Context

- [harness guide §6](../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both): Codex's escalation flow; the model never widens its own sandbox
- [build-harness.md §3.4](../../plans/build-harness.md#34-permission-approval-and-sandbox-apis): the API sketch
- [HD5](../../plans/build-harness.md#hd5-the-harness-always-passes-hmacsigner-over-a-persistent-key-ring-accepted-with-sdk-d5): the decision and its evidence

## Scope

**In scope**

- `escalation({ approvalPolicy, approvals })` with states sandboxed, denied, requested, approved, rerun, done
- `granular`: per-rule escalation policy
- No tool parameter or model output that can request a wider sandbox

**Out of scope** (and which todo covers it)

- New backends: the `srt` and Docker backends ([N16](N16-srt-backend.md), [N17](N17-docker-backend.md)) and the hosted ones ([N46b](../ready/N46b-cloudflare-sandbox-backend.md), [N47b](../ready/N47b-e2b-sandbox-backend.md), [N48b](../ready/N48b-vercel-sandbox-backend.md))

## Tasks

- [x] Write the transition table as data and test every edge.
- [x] Check that a hook approval covers the rerun and a classifier allow (`by: "classifier:…"`) does not.

## Acceptance criteria

- [x] Under `never`, a denial reaches the model as an error result and no approval entry is written
- [x] Under `on-request`, a denial writes `approval_requested`; after `allow`, the command reruns once with the widened policy
- [x] A second denial after the rerun returns to the model and does not escalate again
- [x] No tool schema in the registry contains a field that widens the sandbox (schema scan test)
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/sandbox/escalation.test.ts`.

## Docs to update

`packages/harness/README.md`. The plan's todo table in [build-harness.md §4](../../plans/build-harness.md#4-rounds-and-todos).

## Risks and open questions

None beyond the plan's.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [x] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [x] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`escalation({ approvalPolicy, approvals, granular })` is in `packages/harness/src/sandbox/escalation.ts` and exported from `@buildanagent/harness/sandbox`, with the transition table in `sandbox/escalation-table.ts`, the one function that widens a policy in `sandbox/widen.ts`, and the log reader in `session/escalation-log.ts`. The plan's §3.4 and its status line record it.

- **The table is data.** `ESCALATION_TRANSITIONS` lists twelve edges over the six states and nine events, and `nextEscalationState()` throws the new code `invalid_escalation` for any other pair. The machine moves only through it, and each result's `states` lists the path its call took. Only `requested` on `allowed` enters `approved`, only `approved` on `started` enters `rerun`, and `rerun` leads only to `done`.
- **Where a denial goes.** Under `never`, and wherever no request is allowed, a denial goes back as an error result with nothing written. Otherwise `run()` writes a signed `approval_requested` entry for the tool `sandbox.escalation`, whose input records the call, the command, the workspace root, the policy and the denial.
- **What an answer must pass.** The signature, the bound host context, the call and the record's hash are checked before anything is written, and a failure throws `approval_refused`. An allow with no `by`, or a classifier's, is refused the same way. The approvals' quorum policy decides the answer, and the permission pipeline decides the call again, so a deny rule added after the pause wins.
- **The rerun, its crash rule, abort, expiry and trust marks.** The README's escalation section and the plan's §3.4 give these rules.
- **Tests.** `test/sandbox/escalation.test.ts` tests every edge of the table, every illegal pair, and that the machine walks every edge. It covers the four acceptance criteria, a hook's allow against a classifier's, the schema scan, the failure paths (a forged signature, a key the ring lacks, an edited record, the wrong host context, the requester approving, an expiry, a replay, another workspace root), a quorum of two, an abort before the answer is written, the deny entries that close a host and those that don't, the trust mark of each kind of result, a model's call to a tool it named `sandbox.escalation`, and both crash points. `test/sandbox/escalation-second-process.test.ts` asks in this process and allows in a child process with a cleared environment. The rerun runs once there, with no model call, and a replay runs nothing.

Judgement calls, where the spec left a choice:

- **The machine has its own `run()`, `pending()` and `resolve()`.** The SDK pauses a turn for an approval only from the `beforeToolCall` gate, before a tool runs; a tool's own `pause` can only ask a clarification. A denial inside a tool therefore can't pause its turn for an approval. An escalation therefore lives outside the turn, as a code call does. `Approvals.resolve()` would have had to return a third result type, so it keeps refusing an escalation's request (`approval_not_pending`), and `Approvals.pending()` and the dispatcher don't list one.
- **`run()` is host code's to call under the policies that can ask.** It writes the request to the log, and a write from inside a turn's tool step could race the turn's own writes. Under `never` it writes nothing, so a tool's `execute` may call it; the `never` test does so in a real turn.
- **The `approvals` option binds the machine to its harness.** `createApprovals()` now records the harness and quorum policy of each `Approvals` it makes, and `escalation()` refuses any other object. The plan's signature stays, and the machine signs, decides and settles with the same harness the approvals use.
- **A hook's allow is an answer whose `by` is not a classifier's.** Codex's flow lets a prior human or hook approval cover the retry. Here every rerun still needs a signed allow of its own request, so no edge skips `requested` → `approved`. A `by` that is missing or starts with `classifier:` is refused before anything is written, and any other approver, a hook's `hook:<id>` included, can approve.
- **Widening is narrow and can refuse.** A denial is widened by its own target alone. A target of `/`, a relative or untidy path, a host with a wildcard, a scheme or a path, and a host an entry of the policy's `network.deny` closes can't be widened, so their denial goes back with no request. A deny entry closes a host as `srt` matches a denied domain: `*`, `*.name` for the names under `name`, and case ignored. Its port is ignored, so a host closed on one port is never widened on any, and an IPv6 address is never widened while `deny` names any IPv6 address. The address rules are in the last judgement call below.
- **The rerun's policy comes from the signed record.** `resolve()` takes the backend, the workspace, the environment and the signal from the host, but no policy. It refuses a workspace whose root differs from the recorded one with `invalid_escalation`.
- **`granular` is a list of rules.** The plan named the mode but not its shape. Each rule is `{ kind?, tool?, escalate }`, and the first match decides. No match means no request, a granular policy with no rules is refused, and so are rules given with another policy.
- **The rerun is decided as its original tool.** The pipeline sees the recorded tool, input and initiator under the escalation's id, and `initiator` defaults to `model`.
- **The escalation's result is left out of the model's context.** It is a `tool_result` named `sandbox.escalation`. That name breaks the canonical tool-name rule, so no registered tool can carry it. The rebuilt context skips it by its call id, the one its `approval_requested` entry names, as it skips a code call's, and not by the tool's name: a model can still call a tool it names `sandbox.escalation`, and the error result of that call must stay. The host gets the output from `resolve()`.
- **Sticky and grouped answers don't apply.** Every rerun needs a fresh approval, so `resolve()` takes neither option.
- **An allow must name its approver.** `by` is not signed, so the classifier rule holds only as far as the host sets `by` truthfully. An allow with `by` missing, blank or starting with `classifier:` in any case is refused before anything is written, rather than read as a person's. The README and `resolve()`'s TSDoc tell the host to set `by` only after it has authenticated the approver. Every documented call already passes `by`, and `Approvals.resolve()` never sees an escalation, so no other contract changes.
- **Address aliases can't reopen a closed host.** A host is widened only in its canonical form: an IPv4 address as four decimal octets with no leading zero, an IPv6 address that wraps no IPv4 one, and a name whose last label is not a number. A deny entry closes an IPv4 address it names in any `inet_aton()` spelling or wrapped in IPv6. `localhost` and the names under it, and the unspecified, loopback and link-local addresses, are never widened, whatever `deny` says, because refusing them is safer than matching every alias of them.

