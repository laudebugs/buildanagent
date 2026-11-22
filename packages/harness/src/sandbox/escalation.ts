/**
 * `escalation()`: what the host does when a sandbox denies a command. Under `never` the denial goes back to the caller
 * and nothing is written. Under `on-request`, and under `granular` where a rule allows it, the denial becomes a signed
 * `approval_requested` entry, and once a person or a hook allows it, the command runs once more under the policy
 * widened by exactly what the denial named. The widened policy is built here, on the host, from the signed record and
 * the verified answer; no tool input or model output reaches it, and it lasts for that one rerun.
 */
import {
  canonicalInputHash,
  createPendingRequest,
  type Resolution,
  type SignedPendingRequest,
  type ToolResult,
  verifyResolution,
} from "@buildanagent/sdk";
import type { Clock } from "@buildanagent/sdk/testing";
import { HarnessError } from "../errors.js";
import type { Harness } from "../harness.js";
import {
  type Approvals,
  answersByRequest,
  approvalsBinding,
  checkAnswers,
  type QuorumPolicy,
  settled,
} from "../session/approvals.js";
import { type Io, inCodeCallQueue, ioOf } from "../session/code-call.js";
import {
  ESCALATION_TOOL,
  type EscalationLogRecord,
  type EscalationRecord,
  escalationsOf,
  isEscalationRecord,
  waitingEscalations,
} from "../session/escalation-log.js";
import { recordSessionStart } from "../session/runner.js";
import type { Session } from "../session/session.js";
import {
  ESCALATION_TRANSITIONS,
  type EscalationEvent,
  type EscalationState,
  type EscalationTransition,
  nextEscalationState,
} from "./escalation-table.js";
import type {
  ApprovalPolicy,
  ExecResult,
  Sandbox,
  SandboxClient,
  SandboxDenial,
  SandboxPolicy,
  WorkspaceManifest,
} from "./types.js";
import { widenPolicy } from "./widen.js";

/**
 * One rule of a `granular` policy: a denial of `kind` for `tool` may be asked about (`on-request`) or goes back to the
 * caller (`never`). A rule with no `kind` or no `tool` matches every kind or every tool. The first rule that matches
 * decides, and a denial no rule matches goes back to the caller.
 */
export interface EscalationRule {
  /** The kind of denial the rule covers. Left out, every kind. */
  readonly kind?: SandboxDenial["kind"];
  /** A tool's canonical name or alias, as the registry knows it. */
  readonly tool?: string;
  /** Whether a matching denial may become a request. */
  readonly escalate: "on-request" | "never";
}

/** The options of `escalation()`. */
export interface EscalationOptions<H = unknown> {
  /** When a denial may become a request: `on-request`, `granular` (by `granular`'s rules) or `never`. */
  readonly approvalPolicy: ApprovalPolicy;
  /**
   * The approvals from `createApprovals()`. The escalation signs with their harness's signer, decides the rerun with
   * their harness's permission pipeline, and settles answers with their quorum policy.
   */
  readonly approvals: Approvals<H>;
  /** The rules a `granular` policy needs, and that any other policy refuses. */
  readonly granular?: readonly EscalationRule[];
}

/** One command to run in a sandbox, for one tool call, and what the host provisions the sandbox with. */
export interface EscalationRun<H = unknown> {
  /** The tool the command runs for, which the permission pipeline decides again before a rerun. */
  readonly tool: string;
  /** That tool call's input, as the pipeline sees it. It is recorded, so it needs a canonical JSON form. */
  readonly input: unknown;
  /** Who chose the call. Default `model`. */
  readonly initiator?: "model" | "code";
  /** The tool call's own id, recorded for the approver to see. */
  readonly toolCallId?: string;
  /** The executable and its arguments, with no shell. */
  readonly command: readonly string[];
  /** The working directory, relative to the workspace root. */
  readonly cwd?: string;
  /** Stops the command, and its rerun, after this long, as `Sandbox.exec()` does. */
  readonly timeoutMs?: number;
  /** The most bytes of each output stream to keep, as `Sandbox.exec()` does. */
  readonly maxOutputBytes?: number;
  /** The command's whole environment, from `spawnEnv()`. It is never recorded. */
  readonly env: Readonly<Record<string, string>>;
  /** Aborts the command. */
  readonly signal: AbortSignal;
  /** The backend `run()` provisions from when it is given no `sandbox`. */
  readonly client: SandboxClient;
  /** The workspace. Its root is recorded, and a rerun needs the same root. */
  readonly manifest: WorkspaceManifest;
  /** The policy the command runs under. It is recorded, and a rerun widens this record of it. */
  readonly policy: SandboxPolicy;
  /** A sandbox already provisioned with `policy`. Left out, `run()` provisions one and disposes it. */
  readonly sandbox?: Sandbox;
  /** The caller's identity. A request binds a MAC of it, so only the same value can resolve it. */
  readonly hostContext?: H;
  /** The clock of the entries and the signed request. Default the system clock. */
  readonly clock?: Clock;
  /** Makes the escalation's id and the ids of its entries and request. Default `crypto.randomUUID()`. */
  readonly newId?: () => string;
}

/** The options of `EscalationMachine.resolve()`: where the rerun runs, which the log does not hold. */
export interface EscalationResolveOptions<H = unknown> {
  /** The backend the rerun provisions a fresh sandbox from. */
  readonly client: SandboxClient;
  /** The workspace, whose root must be the recorded one. */
  readonly manifest: WorkspaceManifest;
  /** The rerun's whole environment, from `spawnEnv()`. */
  readonly env: Readonly<Record<string, string>>;
  /** Aborts the rerun. An aborted signal before the answer is written writes nothing. */
  readonly signal: AbortSignal;
  /** The same host context the request was made with, when it bound one. */
  readonly hostContext?: H;
  /** Who asked. An approver equal to it is refused. */
  readonly requesterId?: string;
  /** The clock of the entries. Default the system clock. */
  readonly clock?: Clock;
  /** Makes the ids of the entries. Default `crypto.randomUUID()`. */
  readonly newId?: () => string;
}

/**
 * How an escalation call ended. `states` is the path it took through the transition table in this call, and `result`
 * is what the model reads: the command's output, or why it did not run.
 *
 * - `ran`: the command finished without a denial. `rerun` is true when it was the approved rerun.
 * - `denied`: the command did not run to an end the caller can use: a denial that went back with no request, a refused
 *   answer, the pipeline's deny, or a second denial on the rerun.
 * - `awaiting_approval`: `pending` waits for an answer through `resolve()`. `widened` is the policy the rerun would get.
 *
 * `escalationId` names the escalation once it has a request; a denial that went back with no request has none.
 * `denial` is what the backend refused, and `reason` is the sentence the model reads.
 */
export type EscalationResult =
  | {
      readonly status: "ran";
      readonly exec: Extract<ExecResult, { exitCode: number }>;
      readonly rerun: boolean;
      readonly escalationId?: string;
      readonly states: readonly EscalationState[];
      readonly result: ToolResult<unknown>;
    }
  | {
      readonly status: "denied";
      readonly reason: string;
      readonly denial?: SandboxDenial;
      readonly rerun: boolean;
      readonly escalationId?: string;
      readonly states: readonly EscalationState[];
      readonly result: ToolResult<unknown>;
    }
  | {
      readonly status: "awaiting_approval";
      readonly escalationId: string;
      readonly pending: SignedPendingRequest;
      readonly denial: SandboxDenial;
      readonly widened: SandboxPolicy;
      readonly states: readonly EscalationState[];
      readonly result: ToolResult<unknown>;
    };

/** An escalation that waits for an answer: its id, its signed request and the record the request signs. */
export interface PendingEscalation {
  /** The escalation's id, which its request names as its call id. */
  readonly escalationId: string;
  /** The signed request, to show the approver with the record. */
  readonly request: SignedPendingRequest;
  /** What the request signs: the command, the policy it ran under and the denial. */
  readonly record: EscalationRecord;
}

/** The machine `escalation()` returns. */
export interface EscalationMachine<H = unknown> {
  /** The approval policy the machine was made with. */
  readonly approvalPolicy: ApprovalPolicy;
  /** The table every move follows. */
  readonly transitions: readonly EscalationTransition[];
  /**
   * Runs a command in the sandbox. A command the backend does not deny ends `ran`, and nothing is written. A denial
   * ends `denied`, with nothing written, unless the policy allows a request and the denial names one path or host that
   * can be widened; then a signed `approval_requested` entry is written and the call ends `awaiting_approval`.
   *
   * Writing a request appends to the session, so under `on-request` and `granular` call it from host code outside a
   * turn's tool step, as `invokeTool()` runs. Throws `invalid_escalation` for an input or host context with no
   * canonical JSON form, before anything is written.
   */
  run(session: Session, run: EscalationRun<H>): Promise<EscalationResult>;
  /** The escalations of the session that wait for an answer. */
  pending(session: Session): Promise<PendingEscalation[]>;
  /**
   * Answers one waiting escalation. The answer is checked before anything is written: the signature under a key in the
   * ring, the bound host context, the call and the record. A classifier's allow (`by: "classifier:…"`) never approves a
   * rerun. The answer is written, the quorum policy decides, and an allow then goes through the permission pipeline
   * again, so a deny rule added since the pause wins. The rerun runs once in a fresh sandbox under the recorded policy
   * widened by exactly the recorded denial, and that sandbox is disposed after it. A second denial is the rerun's result.
   *
   * It first settles every escalation a crash left open: a rerun that started and has no result is never run again.
   * Throws `approval_not_pending` for a request that does not wait, `approval_refused` for one that fails its check or a
   * classifier's allow, `approver_is_requester`, and `invalid_escalation` for a workspace with another root.
   */
  resolve(session: Session, resolution: Resolution, options: EscalationResolveOptions<H>): Promise<EscalationResult>;
}

const POLICIES: readonly string[] = ["on-request", "granular", "never"];
const KINDS: readonly string[] = ["filesystem_read", "filesystem_write", "network"];
// Each stream the log keeps of a rerun's output, so the entry stays under the store's bound.
const STORED_BYTES = 16 * 1024;

const invalid = (message: string, cause?: unknown) =>
  new HarnessError("invalid_escalation", message, cause === undefined ? {} : { cause });

function checkRules(rules: unknown): void {
  if (!Array.isArray(rules) || rules.length === 0) {
    throw invalid("a granular approval policy needs a non-empty list of escalation rules");
  }
  for (const rule of rules as EscalationRule[]) {
    const ok =
      (rule?.escalate === "on-request" || rule?.escalate === "never") &&
      (rule.kind === undefined || KINDS.includes(rule.kind)) &&
      (rule.tool === undefined || (typeof rule.tool === "string" && rule.tool !== ""));
    if (!ok) throw invalid(`an escalation rule is unusable: ${JSON.stringify(rule)}`);
  }
}

/** Checks the options and returns the harness and quorum policy the approvals were made with. */
function bindingOf<H>(options: EscalationOptions<H>): { harness: Harness<H>; quorum: QuorumPolicy } {
  if (!POLICIES.includes(options?.approvalPolicy)) {
    throw invalid(`the approval policy must be on-request, granular or never, got ${String(options?.approvalPolicy)}`);
  }
  if (options.approvalPolicy === "granular") checkRules(options.granular);
  else if (options.granular !== undefined) throw invalid("escalation rules apply only to a granular approval policy");
  const binding = options.approvals === undefined ? undefined : approvalsBinding(options.approvals);
  if (binding === undefined) throw invalid("escalation() needs the approvals createApprovals() made");
  if (options.approvalPolicy !== "never") {
    if (binding.harness.signer === undefined) {
      throw new HarnessError("approval_unavailable", "the harness has no signer, so no escalation could be asked");
    }
    if (binding.harness.pipeline === undefined) {
      throw invalid("the harness has no permission pipeline, so no rerun could be decided again");
    }
  }
  return binding;
}

const text = (body: string, isError: boolean, details?: unknown): ToolResult<unknown> => ({
  content: [{ type: "text", text: body }],
  isError,
  ...(details === undefined ? {} : { details }),
});

/** The moves of one call: each goes through the table, so an edge it does not list throws. */
interface Walker {
  readonly states: EscalationState[];
  step(event: EscalationEvent): void;
  /** The states so far and an error result with `body`, for a call that ends without the command's output. */
  end(body: string): { readonly states: readonly EscalationState[]; readonly result: ToolResult<unknown> };
}

function walker(start: EscalationState): Walker {
  const states: EscalationState[] = [start];
  return {
    states,
    step(event) {
      states.push(nextEscalationState(states.at(-1) as EscalationState, event));
    },
    end: (body) => ({ states, result: text(body, true) }),
  };
}

const what = (denial: SandboxDenial): string =>
  `The sandbox refused a ${denial.kind.replace("_", " ")} of ${denial.target}: ${denial.reason}.`;

function clip(value: string): string {
  return value.length <= STORED_BYTES ? value : `${value.slice(0, STORED_BYTES)}\n[output cut]`;
}

function execText(exec: Extract<ExecResult, { exitCode: number }>, keep: (value: string) => string): string {
  const signal = exec.signal === undefined ? "" : ` (${exec.signal})`;
  return [`exit code ${exec.exitCode}${signal}`, keep(exec.stdout), keep(exec.stderr)].join("\n");
}

const ranResult = (exec: Extract<ExecResult, { exitCode: number }>, keep = (value: string) => value) =>
  text(execText(exec, keep), exec.exitCode !== 0, {
    exitCode: exec.exitCode,
    ...(exec.signal === undefined ? {} : { signal: exec.signal }),
  });

/** Writes the escalation's result, which ends it: the model never reads it, and the host gets it back. */
async function writeResult(io: Io, id: string, result: ToolResult<unknown>, fromCommand: boolean): Promise<void> {
  const first = result.content[0];
  const body = first?.type === "text" ? clip(first.text) : "";
  await io.write(fromCommand ? "tool" : "harness", {
    type: "tool_result",
    callId: id,
    tool: ESCALATION_TOOL,
    content: [{ type: "text", text: body }],
    isError: result.isError === true,
    ...(result.details === undefined ? {} : { details: result.details }),
    // A command's output can carry instructions an attacker wrote; the harness's own sentences can't.
    trust: fromCommand ? "untrusted" : "trusted",
  });
}

const INTERRUPTED = "The rerun stopped before its result was recorded, so it may have run. It is not run again.";
const NEVER_RAN = "The escalation stopped after its answer was written and before its rerun started, so it never ran.";

/** Settles each escalation a crash left open, by the crash rule: a started rerun is never run again. */
async function settleOpen(path: readonly EscalationLogRecord[], io: Io): Promise<void> {
  for (const record of path) {
    if (record.result !== undefined || !(record.answered || record.started)) continue;
    nextEscalationState(record.started ? "rerun" : "requested", "settled");
    await writeResult(io, record.id, text(record.started ? INTERRUPTED : NEVER_RAN, true), false);
  }
}

async function hashable(value: unknown, what: string): Promise<void> {
  try {
    await canonicalInputHash(value);
  } catch (error) {
    throw invalid(`the escalation's ${what} has no canonical JSON form`, error);
  }
}

/** The fields of `fields` that are set, so an optional field left out is not written as `undefined`. */
function present<T extends object>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Runs one command in a sandbox provisioned for it, and disposes that sandbox whatever happens. */
async function execIn(
  where: { readonly client: SandboxClient; readonly manifest: WorkspaceManifest; readonly sandbox?: Sandbox },
  policy: SandboxPolicy,
  command: Pick<EscalationRecord, "command" | "cwd" | "timeoutMs" | "maxOutputBytes">,
  run: { readonly env: Readonly<Record<string, string>>; readonly signal: AbortSignal },
): Promise<ExecResult> {
  const used = where.sandbox ?? (await where.client.provision(where.manifest, policy));
  const { cwd, timeoutMs, maxOutputBytes } = command;
  try {
    return await used.exec(command.command, {
      env: run.env,
      signal: run.signal,
      ...present({ cwd, timeoutMs, maxOutputBytes }),
    });
  } finally {
    // A sandbox the caller provisioned is the caller's to dispose.
    if (where.sandbox === undefined) await used.dispose();
  }
}

/** What every call of one machine shares: the harness, its quorum policy, the approval policy and its rules. */
interface Machine<H> {
  readonly harness: Harness<H>;
  readonly quorum: QuorumPolicy;
  readonly approvalPolicy: ApprovalPolicy;
  readonly rules: readonly EscalationRule[];
}

const nameOf = <H>(machine: Machine<H>, tool: string): string =>
  machine.harness.registry.get(tool)?.canonicalName ?? tool;

/** Why a denial goes back with no request, or `undefined` when the policy allows one. */
function refusal<H>(machine: Machine<H>, denial: SandboxDenial, tool: string): string | undefined {
  if (machine.approvalPolicy === "never") return "The approval policy is never, so no one was asked.";
  if (machine.approvalPolicy !== "granular") return undefined;
  const rule = machine.rules.find(
    (each) =>
      (each.kind === undefined || each.kind === denial.kind) &&
      (each.tool === undefined || nameOf(machine, each.tool) === nameOf(machine, tool)),
  );
  return rule?.escalate === "on-request"
    ? undefined
    : "No escalation rule lets the host ask about this, so no one was asked.";
}

/** The record a request signs, from the run and the denial: the host's facts, never the tool's input alone. */
function recordOf<H>(machine: Machine<H>, call: EscalationRun<H>, denial: SandboxDenial): EscalationRecord {
  const { toolCallId, cwd, timeoutMs, maxOutputBytes } = call;
  return {
    tool: nameOf(machine, call.tool),
    input: call.input,
    initiator: call.initiator ?? "model",
    command: [...call.command],
    ...present({ toolCallId, cwd, timeoutMs, maxOutputBytes }),
    root: call.manifest.root,
    policy: call.policy,
    denial: { kind: denial.kind, target: denial.target, reason: denial.reason },
  };
}

/** Writes the session's start if it lacks one, settles what a crash left open, then signs and writes the request. */
async function ask<H>(
  machine: Machine<H>,
  session: Session,
  call: EscalationRun<H>,
  asked: { readonly record: EscalationRecord; readonly widened: SandboxPolicy; readonly walk: Walker },
): Promise<EscalationResult> {
  const { harness } = machine;
  const { record, widened, walk } = asked;
  const io = ioOf(session, call);
  const id = io.newId();
  await recordSessionStart(harness, (origin, body) => io.write(origin, body), harness.model, await session.path());
  await settleOpen([...escalationsOf(await session.path()).values()], io);
  const reason = what(record.denial);
  const pending = await createPendingRequest(
    {
      kind: "approval",
      callId: id,
      tool: ESCALATION_TOOL,
      input: record,
      reason,
      ...present({ app: call.hostContext }),
    },
    harness.signer as NonNullable<Harness<H>["signer"]>,
    { generateId: io.newId, now: () => new Date(io.clock.now()) },
  );
  await io.write("harness", { type: "approval_requested", request: pending, input: record });
  walk.step("asked");
  const body = `${reason} A person was asked to allow it once (request ${pending.id}).`;
  return { status: "awaiting_approval", escalationId: id, pending, denial: record.denial, widened, ...walk.end(body) };
}

async function runCommand<H>(machine: Machine<H>, session: Session, call: EscalationRun<H>): Promise<EscalationResult> {
  if (typeof call?.tool !== "string" || call.tool === "") throw invalid("an escalation run needs the tool's name");
  const walk = walker("sandboxed");
  const exec = await execIn(call, call.policy, call, call);
  if (!("denied" in exec)) {
    walk.step("ran");
    return { status: "ran", exec, rerun: false, states: walk.states, result: ranResult(exec) };
  }
  walk.step("denied");
  const denial = exec.denied;
  const widened = widenPolicy(call.policy, denial);
  const why =
    refusal(machine, denial, call.tool) ??
    (widened === undefined ? "The policy can't be widened to that, so no one was asked." : undefined);
  if (why !== undefined || widened === undefined) {
    walk.step("returned");
    const reason = `${what(denial)} ${why}`;
    return { status: "denied", reason, denial, rerun: false, ...walk.end(reason) };
  }
  const record = recordOf(machine, call, denial);
  await hashable(record, "record");
  if (call.hostContext !== undefined) await hashable(call.hostContext, "host context");
  return inCodeCallQueue(session, () => ask(machine, session, call, { record, widened, walk }));
}

/** What an answer resolves once it passed its checks: the escalation, its verified record and the rerun's policy. */
interface Checked {
  readonly found: EscalationLogRecord;
  readonly record: EscalationRecord;
  readonly widened: SandboxPolicy;
}

/** Checks an answer against the waiting request before anything is written, and returns the escalation it answers. */
async function check<H>(
  machine: Machine<H>,
  path: readonly EscalationLogRecord[],
  resolution: Resolution,
  options: EscalationResolveOptions<H>,
): Promise<Checked> {
  const { harness } = machine;
  const waiting = path.filter((record) => record.result === undefined && !record.answered && !record.started);
  const byRequest = new Map(waiting.map((record) => [record.requested.request.id, record]));
  checkAnswers(harness, byRequest, [resolution], options.requesterId);
  const found = byRequest.get(resolution.requestId) as EscalationLogRecord;
  const refuse = (cause: string) =>
    new HarnessError(
      "approval_refused",
      `the request for escalation ${found.id} failed its check (${cause}), so nothing ran and nothing was written`,
    );
  if ("decision" in resolution && resolution.decision === "allow" && resolution.by?.startsWith("classifier:")) {
    throw refuse("a classifier's allow does not cover a sandbox rerun");
  }
  const verified = await verifyResolution(found.requested.request, resolution, {
    signer: harness.signer as NonNullable<Harness<H>["signer"]>,
    call: { callId: found.id, tool: ESCALATION_TOOL, input: found.requested.input },
    ...present({ app: options.hostContext }),
  });
  if (!verified.ok) throw refuse(verified.cause);
  const record = found.requested.input;
  if (!isEscalationRecord(record)) throw refuse("malformed");
  const widened = widenPolicy(record.policy, record.denial);
  if (widened === undefined) throw refuse("not_widenable");
  if (options.manifest?.root !== record.root) {
    throw invalid("the rerun's workspace must have the root the escalation recorded");
  }
  return { found, record, widened };
}

/** Decides the call again with the pipeline, which writes the `permission_decision` the rerun starts after. */
async function decideAgain<H>(machine: Machine<H>, io: Io, id: string, record: EscalationRecord, hostContext?: H) {
  // bindingOf() refused a harness without a pipeline for every policy that can ask.
  const pipeline = machine.harness.pipeline as NonNullable<Harness<H>["pipeline"]>;
  return pipeline.decide(
    { callId: id, tool: record.tool, input: record.input, initiator: record.initiator },
    { session: { append: (entry) => io.write("harness", entry) }, hostContext, entries: await io.session.path() },
  );
}

/** Ends an escalation that will not rerun: writes the reason as its result and returns the denial. */
async function refuseRerun(io: Io, checked: Checked, walk: Walker, reason: string): Promise<EscalationResult> {
  walk.step("refused");
  const ended = walk.end(reason);
  await writeResult(io, checked.found.id, ended.result, false);
  return {
    status: "denied",
    reason,
    denial: checked.record.denial,
    rerun: false,
    escalationId: checked.found.id,
    ...ended,
  };
}

async function resolveQueued<H>(
  machine: Machine<H>,
  session: Session,
  resolution: Resolution,
  options: EscalationResolveOptions<H>,
): Promise<EscalationResult> {
  options.signal?.throwIfAborted();
  const io = ioOf(session, options);
  await settleOpen([...escalationsOf(await session.path()).values()], io);
  const path = await session.path();
  const checked = await check(machine, [...escalationsOf(path).values()], resolution, options);
  const { found, record, widened } = checked;
  const walk = walker("requested");
  const outcome = await settled(machine.quorum, [found.requested], answersByRequest(path), [{ resolution }]);
  for (const entry of outcome.records) await io.write("user", { type: "approval_resolved", ...entry });
  const answer = outcome.forRun[0];
  if (answer === undefined) {
    walk.step("waiting");
    const body = `${what(record.denial)} The request waits for more answers.`;
    const pending = found.requested.request;
    return {
      status: "awaiting_approval",
      escalationId: found.id,
      pending,
      denial: record.denial,
      widened,
      ...walk.end(body),
    };
  }
  if (!("decision" in answer) || answer.decision !== "allow") {
    const why = ("reason" in answer ? answer.reason : undefined) ?? "denied";
    return refuseRerun(io, checked, walk, `The rerun was not allowed: ${why}.`);
  }
  walk.step("allowed");
  const decision = await decideAgain(machine, io, found.id, record, options.hostContext);
  // A person allowed the rerun, so a question the pipeline would ask again doesn't stop it; a deny does.
  if (decision.decision === "deny") {
    return refuseRerun(io, checked, walk, `The permission policy now denies the call: ${decision.reason}`);
  }
  walk.step("started");
  return rerun(io, checked, options, walk);
}

/** Runs the one rerun in a fresh sandbox under the widened policy, and writes its result. */
async function rerun<H>(
  io: Io,
  checked: Checked,
  options: EscalationResolveOptions<H>,
  walk: Walker,
): Promise<EscalationResult> {
  const id = checked.found.id;
  let exec: ExecResult;
  try {
    exec = await execIn(options, checked.widened, checked.record, options);
  } catch (error) {
    // The rerun started, so it gets a result and is never run again, and the caller still sees why it failed.
    const reason = `The rerun failed: ${error instanceof Error ? error.message : String(error)}`;
    await writeResult(io, id, text(reason, true), false);
    throw error;
  }
  walk.step("ran");
  if ("denied" in exec) {
    const reason = `${what(exec.denied)} This was the approved rerun, so no one is asked again.`;
    const ended = walk.end(reason);
    await writeResult(io, id, ended.result, false);
    return { status: "denied", reason, denial: exec.denied, rerun: true, escalationId: id, ...ended };
  }
  await writeResult(io, id, ranResult(exec, clip), true);
  return { status: "ran", exec, rerun: true, escalationId: id, states: walk.states, result: ranResult(exec) };
}

/**
 * Creates the escalation machine for a harness's approvals. Throws `invalid_escalation` for unusable options, and
 * `approval_unavailable` when a policy that can ask has a harness with no signer.
 */
export function escalation<H = unknown>(options: EscalationOptions<H>): EscalationMachine<H> {
  const { harness, quorum } = bindingOf(options);
  const machine: Machine<H> = {
    harness,
    quorum,
    approvalPolicy: options.approvalPolicy,
    rules: options.granular ?? [],
  };
  return {
    approvalPolicy: options.approvalPolicy,
    transitions: ESCALATION_TRANSITIONS,
    run: (session, call) => runCommand(machine, session, call),
    async pending(session) {
      return waitingEscalations(await session.path()).flatMap(({ id, requested }) =>
        isEscalationRecord(requested.input)
          ? [{ escalationId: id, request: requested.request, record: requested.input }]
          : [],
      );
    },
    resolve(session, resolution, resolveOptions) {
      return inCodeCallQueue(session, () => resolveQueued(machine, session, resolution, resolveOptions));
    },
  };
}
