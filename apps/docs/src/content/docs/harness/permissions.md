---
title: Permissions decide every tool call
description: How the permission pipeline allows, asks about or denies each tool call, and how a call that asks becomes a signed pause that a person answers later.
---

You will decide which tool calls run, which wait for a person and which never run. You need this when an agent can change something that matters, such as paging an engineer.

The permission pipeline is the harness's one decision point for tool calls. Every call the model makes goes through it before its tool runs, and the pipeline answers allow, ask or deny. An ask pauses the turn until a person answers; [Approvals](/concepts/approvals/) explains the SDK's side of that pause. [Tools](/harness/tools/) explains the registry of tools the pipeline decides about.

## A deny rule beats every mode

A rule names a tool and may add a reason. The pipeline decides in this order, and a deny at any step ends the decision:

1. **Hooks**, functions you write that may deny or ask about a call and never allow it.
2. **Deny rules.**
3. **The `read_only` limit**, which applies only in `read_only` mode.
4. **Ask rules.**
5. **The mode**, a standing setting such as `bypass`.
6. **Allow rules.**
7. **The host callback**, an optional function that decides what no rule settled.

A deny rule therefore wins over every mode, including `bypass`. This pipeline lets a support agent look a customer up, asks a person before it pages an engineer and refuses any `rm` command. The `interactive` setting says whether a person can answer a question:

```ts file="packages/harness/examples/permission-rules.ts" region="rules"
```

Each decision names the rule that made it and writes one `permission_decision` entry to the session's log, allows included. These four calls get four different decisions:

```ts file="packages/harness/examples/permission-rules.ts" region="decide"
```

`lookup_customer` is allowed by `allow[0]`. `escalate` asks, with the reason "An on-call engineer will be paged." The `rm` command is denied by `deny[0]`, with the reason "Deleting files is never allowed." `export_data` matches no rule, so it asks, with the rule name `no_match`.

## A call no rule names asks, or is refused when nobody can answer

With no host callback, a call that no rule settles asks while `interactive` is `true`. When `interactive` is `false`, as in a background job, nobody can answer, so the pipeline denies the call. Its reason reads "No rule covers this call and nobody can be asked, so it is refused". Write an allow rule for every tool a background job needs.

The pipeline fails closed. A hook that throws, an input that cannot be hashed and a log entry that cannot be written all deny the call.

## A mode changes what the rules leave open

Mode `default` adds nothing to the rules. Deny rules apply under every mode, and shadow mode skips ask rules and hook questions, because nothing runs and no person could answer.

- **`read_only`** denies every tool outside its read-only list, before it reads ask rules or allow rules. The list is `read`, `grep` and `glob` unless you set `readOnlyTools`. A listed tool with an ask rule still asks.
- **`accept_edits`** allows the edit tools, `write`, `edit`, `multi_edit` and `apply_patch` unless you set `editTools`.
- **`bypass`** allows whatever no hook, deny rule or ask rule stopped.
- **`shadow`** records each call and returns a fixed result, once you wrap the tools with the pipeline's shadow wrapper, so no tool runs.

## Rules can read paths and shell commands

A rule can add `paths`, globs matched against the path fields of a call's input, and `commandPrefix`, the leading words of a shell command. The pipeline splits a command on `&&`, `||`, `;`, `|`, `|&`, a lone `&`, newlines and parentheses, outside quotes. An allow rule must cover every part, so a rule for `git status` does not allow `git status && rm -rf /`.

The command reader has limits. It does not follow aliases, shell functions, variables, here-documents or a script that the command writes first. A command nested more than three levels deep counts as a match for every deny and ask rule that has a `commandPrefix` for its tool. Run untrusted commands in a [sandbox](/harness/sandbox/) as well.

An allow rule with a `commandPrefix` never covers a command that hides commands in a substitution, because the rule cannot read every part. An allow rule that names a tool alone, with no `commandPrefix`, does not check the command's words, so it allows such a command.

## An ask becomes a signed pause that any process can resume

When a call asks, the turn ends with the stop reason `awaiting_approval`. The harness writes the question to the log as an `approval_requested` entry, signed with a key. It never waits, so a process that restarts loses nothing, and a different process can answer.

The signature comes from the `signer` you give `createHarness()`. The signer holds a key ring, a set of keys kept outside the log and the sandbox, in a file by default. Without a signer, answering a request throws `approval_unavailable`. In this example, `run.app` is the signed-in customer. The harness calls it the host context, the value your app passes to a turn. `limits` holds the example's step cap, budget and output tool. The first process starts the turn:

```ts file="packages/harness/examples/triage-session.ts" region="pause"
```

Later, any process that can open the session and load the same key ring answers with a `Resolution`: the request's id, `allow` or `deny`, and `by`, the name of the approver.

Set `by` yourself, and only after you have authenticated the approver. The harness trusts the name it is given, so a wrong `by` lets anyone approve as anyone.

```ts file="packages/harness/examples/triage-session.ts" region="answer"
```

Two checks protect the answer. A request made with a host context resumes only when the answer passes the same value, so that value acts as the caller's identity. The approved call also goes through the pipeline again, so a deny rule added after the pause turns the approval into a denial.

Next, learn how the [sandbox](/harness/sandbox/) confines commands and keeps credentials out of reach.
