---
title: Permissions decide every tool call
description: How the permission pipeline allows, asks about or denies each tool call, and how a call that asks becomes a signed pause that a person answers later.
---

You will decide which tool calls run, which wait for a person and which never run. You need this when an agent can change something that matters, such as paging an engineer.

The permission pipeline is the harness's one decision point for tool calls. Every call the model makes goes through it before its tool runs, and it answers allow, ask or deny. An ask pauses the turn until a person answers. [Tools](/harness/tools/) explains the registry of tools it decides about. This page also uses the SDK's approvals, explained in [Approvals](/concepts/approvals/).

## A deny rule beats every mode

A rule names a tool and may add a reason. The pipeline checks hooks first, then deny rules, then the `read_only` limit, then ask rules, the mode, allow rules and a callback you supply. A deny at any step ends the decision, so a deny rule wins over every mode, including `bypass`, which allows whatever no hook or rule stopped.

This pipeline lets a support agent look a customer up, asks a person before it pages an engineer and refuses any `rm` command. The `interactive` setting says whether a person can answer a question:

```ts file="packages/harness/examples/permission-rules.ts" region="rules"
```

Each decision names the rule that made it and writes one `permission_decision` entry to the session's log, allows included. These four calls get four different decisions:

```ts file="packages/harness/examples/permission-rules.ts" region="decide"
```

`lookup_customer` is allowed by `allow[0]`. `escalate` asks, with the reason "An on-call engineer will be paged." The `rm` command is denied by `deny[0]`, with the reason "Deleting files is never allowed." `export_data` matches no rule, so it asks, with the rule name `no_match`.

## A call no rule names asks, or is refused when nobody can answer

With no callback you supply, a call that no rule settles asks while `interactive` is `true`. When `interactive` is `false`, as in a background job, nobody can answer, so the pipeline denies the call. Its reason reads "No rule covers this call and nobody can be asked, so it is refused". Write an allow rule for every tool a background job needs.

The pipeline fails closed. A hook that throws, an input that cannot be hashed and a log entry that cannot be written all deny the call.

## A mode changes what the rules leave open

A mode is a standing setting for the whole pipeline. Deny rules apply under every mode. Shadow mode skips ask rules and hook questions, because nothing runs and no person could answer.

- **`default`** adds nothing.
- **`accept_edits`** allows the edit tools: `write`, `edit`, `multi_edit` and `apply_patch`.
- **`read_only`** allows `read`, `grep` and `glob` and denies every other tool. It decides before ask rules and allow rules, so a tool with either is still denied.
- **`bypass`** allows whatever no hook, deny rule or ask rule stopped.
- **`shadow`** records each call and returns a fixed result, once you wrap the tools with the pipeline's shadow wrapper, so no tool runs.

## Rules can read paths and shell commands

A rule can add `paths`, globs matched against the path fields of a call's input, and `commandPrefix`, the leading words of a shell command. The pipeline splits a command on `&&`, `||`, `;`, `|`, `|&`, a lone `&`, newlines and parentheses, outside quotes. An allow rule must cover every part, so a rule for `git status` does not allow `git status && rm -rf /`.

The command reader has limits. It does not follow aliases, shell functions, variables, here-documents or a script that the command writes first. An allow rule with a `commandPrefix` never covers a command that hides commands in a substitution, because the rule cannot read all of its parts. An allow rule for the whole tool, with no `commandPrefix`, still allows it. A command nested more than three levels deep counts as a match for every deny and ask rule that has a `commandPrefix` for its tool. Run untrusted commands in a [sandbox](/harness/sandbox/) as well.

## An ask becomes a signed pause that any process can resume

When a call asks, the turn ends with the stop reason `awaiting_approval`. The harness writes the question to the log as an `approval_requested` entry, signed with a key. It never waits, so a process that restarts loses nothing, and a different process can answer.

The signature comes from the `signer` you give `createHarness()`. The signer holds a key ring, a file of keys that stays outside the log and the sandbox. Without a signer, answering a request throws `approval_unavailable`. In this example, `run.app` is the signed-in customer, which the harness calls the host context, and `limits` holds the example's step cap, budget and output tool. The first process starts the turn:

```ts file="packages/harness/examples/triage-session.ts" region="pause"
```

Later, any process that can open the session and load the same key ring answers with a `Resolution`: the request's id, `allow` or `deny`, and `by`, the name of the approver. Fill in `by` only after you have authenticated the approver, because the harness trusts what it is given.

```ts file="packages/harness/examples/triage-session.ts" region="answer"
```

Two checks protect the answer. A request made with a host context resumes only when the answer passes the same value, so that value acts as the caller's identity. The approved call also goes through the pipeline again, so a deny rule added after the pause turns the approval into a denial.

Next, learn how the [sandbox](/harness/sandbox/) confines commands and keeps credentials out of reach.
