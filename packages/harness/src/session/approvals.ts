/**
 * `createApprovals()`: the pause and resume of a call that waits for a person. A gate `ask` ends a turn
 * `awaiting_approval` with the signed request in the log, as an `approval_requested` entry written before the harness's
 * own observers hear of it. `pending()` reads the requests that still wait, and `resolve()` answers them from any
 * process that can open the session and load the key ring, because the log holds everything the resume needs. An answer
 * may also cover more than its own call (sticky and grouped answers), and a quorum policy may need several answers
 * before a call runs.
 */
import type { SessionEntry } from "@buildanagent/protocol";
import type { Resolution, SignedPendingRequest } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import type { Harness } from "../harness.js";
import type { ApprovalReuse } from "../tools/types.js";
import { type PendingApproval, pendingApprovals } from "./rebuild.js";
import { type ResolutionRecord, type ResumeOptions, resumeTurn, type TurnResult } from "./runner.js";
import type { Session } from "./session.js";
import { checkReuse, checkSticky, groupIdOf } from "./sticky.js";

/** What a quorum policy says about one request: its answers are enough, not yet, a refusal, or too old. */
export type QuorumVerdict = "met" | "pending" | "rejected" | "expired";

/**
 * Decides when a request has enough answers. `resolutions` are every answer written for the request so far, oldest
 * first. The policy keeps its own clock, so it can expire a request by age or because the policy changed. `met` runs
 * the call, `rejected` and `expired` turn it into a denial, and `pending` leaves it waiting.
 */
export interface QuorumPolicy {
  evaluate(request: SignedPendingRequest, resolutions: readonly Resolution[]): Promise<QuorumVerdict> | QuorumVerdict;
}

const isDeny = (resolution: Resolution): boolean => "decision" in resolution && resolution.decision === "deny";

/** The default policy: the first answer decides, an allow or an answer runs the call and a deny refuses it. */
export const oneResolution: QuorumPolicy = {
  evaluate: (_request, resolutions) =>
    resolutions.length === 0 ? "pending" : resolutions.some(isDeny) ? "rejected" : "met",
};

/**
 * A policy that needs `needed` allows from distinct approvers, named by `Resolution.by`. A deny from anyone refuses the
 * call. An allow with no `by` counts as one anonymous approver, so a quorum above one needs the host to name them.
 */
export function quorumOf(needed: number): QuorumPolicy {
  return {
    evaluate(_request, resolutions) {
      if (resolutions.some(isDeny)) return "rejected";
      const approvers = new Set(resolutions.map((resolution) => resolution.by ?? "(unnamed)"));
      return approvers.size >= needed ? "met" : "pending";
    },
  };
}

/** The settings a resume takes besides the answers: a turn's settings, and what the answers cover. */
export interface ResolveOptions<H = unknown> extends Omit<ResumeOptions<H>, "resolutions" | "records"> {
  /** Make each `allow` cover the same call again, for this run or for this session. */
  readonly sticky?: "run" | "session";
  /** For a shell tool, cover every command that starts with these words, not only the one approved. */
  readonly commandPrefix?: readonly string[];
  /** Apply each answer to every pending request of the step that has the same tool and the same input. */
  readonly group?: boolean;
  /** Who asked. An approver equal to it is refused: nobody approves their own request. */
  readonly requesterId?: string;
}

/** The options of `createApprovals()`. */
export interface ApprovalsOptions {
  /** When a request has enough answers. Default `oneResolution`. */
  readonly quorum?: QuorumPolicy;
  /** The secret values the host's credential store knows. A sticky allowance that covers one is refused. */
  readonly secrets?: () => readonly string[] | Promise<readonly string[]>;
}

/** The approvals of one harness. */
export interface Approvals<H = unknown> {
  /** The requests of the session that still wait, each with the input its call would run with once approved. */
  pending(session: Session): Promise<PendingApproval[]>;
  /**
   * Answers waiting requests and resumes the turn. Each answer is written as an `approval_resolved` entry first. The
   * quorum policy then decides each request: `met` goes to the SDK, which verifies the request's signature, call and
   * input, so a tampered request runs nothing and is asked again; `rejected` and `expired` become denials; `pending`
   * leaves the call waiting, and the turn ends `awaiting_approval` again. Each approved call goes through the permission
   * pipeline again, and a deny now turns the approval into a denial. Calling it with no answers evaluates the policy
   * for every waiting request, which is how an expired request is refused.
   *
   * Throws `approval_not_pending` for a request that does not wait, `approval_unavailable` without a signer,
   * `approver_is_requester` when an approver is the requester, `approval_reuse_refused` when a tool's `approvalReuse`
   * forbids a sticky or grouped answer, and `sticky_refused` for an interpreter prefix or a secret. The host fills
   * `Resolution.by` only after it has authenticated the approver; the harness trusts what it is given.
   */
  resolve(session: Session, resolutions: readonly Resolution[], options?: ResolveOptions<H>): Promise<TurnResult>;
}

const decisionOf = (resolution: Resolution): "allow" | "deny" | undefined =>
  "decision" in resolution ? resolution.decision : undefined;

/** Copies an answer to the other requests of its group, each with the same decision, reason and approver. */
function expandGroup(
  resolutions: readonly Resolution[],
  groups: ReadonlyMap<string, string[]>,
  groupOf: ReadonlyMap<string, string>,
): Resolution[] {
  const out = new Map<string, Resolution>(resolutions.map((resolution) => [resolution.requestId, resolution]));
  for (const resolution of resolutions) {
    for (const other of groups.get(groupOf.get(resolution.requestId) ?? "") ?? []) {
      if (!out.has(other)) out.set(other, { ...resolution, requestId: other });
    }
  }
  return [...out.values()];
}

/** The answers already written for each request, oldest first. */
function answersByRequest(path: readonly SessionEntry[]): Map<string, Resolution[]> {
  const answers = new Map<string, Resolution[]>();
  for (const entry of path) {
    if (entry.type === "approval_resolved") {
      answers.set(entry.resolution.requestId, [...(answers.get(entry.resolution.requestId) ?? []), entry.resolution]);
    }
  }
  return answers;
}

/** Refuses an answer set that can't be applied: no signer, an answer twice, a request that doesn't wait, a self-approval. */
function checkAnswers<H>(
  harness: Harness<H>,
  waiting: ReadonlyMap<string, PendingApproval>,
  resolutions: readonly Resolution[],
  requesterId: string | undefined,
): void {
  if (harness.signer === undefined) {
    throw new HarnessError("approval_unavailable", "the harness has no signer, so no approval can be checked");
  }
  const named = new Set<string>();
  for (const resolution of resolutions) {
    if (named.has(resolution.requestId)) {
      throw new HarnessError("approval_not_pending", `request ${resolution.requestId} is answered twice in one resume`);
    }
    named.add(resolution.requestId);
    if (!waiting.has(resolution.requestId)) {
      throw new HarnessError("approval_not_pending", `no request ${resolution.requestId} is waiting in this session`);
    }
    if (requesterId !== undefined && resolution.by === requesterId) {
      throw new HarnessError("approver_is_requester", `the approver ${resolution.by} is the one who asked`);
    }
  }
}

/** The answer the SDK applies to each waiting request the policy has decided, with a denial for a refused or expired one. */
async function settled(
  policy: QuorumPolicy,
  waiting: readonly PendingApproval[],
  earlier: ReadonlyMap<string, Resolution[]>,
  records: readonly ResolutionRecord[],
): Promise<Resolution[]> {
  const forRun: Resolution[] = [];
  for (const { request } of waiting) {
    const fresh = records
      .filter((record) => record.resolution.requestId === request.id)
      .map((record) => record.resolution);
    const answers = [...(earlier.get(request.id) ?? []), ...fresh];
    const verdict = await policy.evaluate(request, answers);
    if (verdict === "met") forRun.push(answers.findLast((answer) => !isDeny(answer)) ?? (answers.at(-1) as Resolution));
    if (verdict === "rejected" || verdict === "expired") {
      const reason = verdict === "expired" ? "the approval expired" : "the approval was rejected";
      forRun.push({ requestId: request.id, decision: "deny", reason });
    }
  }
  return forRun;
}

/** Creates the approvals of `harness`, which needs a `signer` to check the requests it resumes. */
export function createApprovals<H = unknown>(harness: Harness<H>, settings: ApprovalsOptions = {}): Approvals<H> {
  const policy = settings.quorum ?? oneResolution;
  return {
    async pending(session) {
      return pendingApprovals(await session.path());
    },
    async resolve(session, resolutions, options = {}) {
      const path = await session.path();
      const waiting = pendingApprovals(path);
      checkAnswers(
        harness,
        new Map(waiting.map((entry) => [entry.request.id, entry])),
        resolutions,
        options.requesterId,
      );
      const records = await recordsFor(harness, waiting, resolutions, options, await (settings.secrets?.() ?? []));
      const forRun = await settled(policy, waiting, answersByRequest(path), records);
      return resumeTurn(session, harness, { ...options, resolutions: forRun, records });
    },
  };
}

const nameOf = <H>(harness: Harness<H>, tool: string): string => harness.registry.get(tool)?.canonicalName ?? tool;
const reuseOf = <H>(harness: Harness<H>, tool: string): ApprovalReuse =>
  harness.registry.get(tool)?.approvalReuse ?? "both";

/** The group each waiting request belongs to: its requests, and the id each request's group has. */
async function groupsOf<H>(harness: Harness<H>, waiting: readonly PendingApproval[]) {
  const groups = new Map<string, string[]>();
  const groupOf = new Map<string, string>();
  for (const { request, input } of waiting) {
    checkReuse(request.tool, reuseOf(harness, request.tool), "group");
    const id = await groupIdOf(nameOf(harness, request.tool), input, request.inputHash);
    groupOf.set(request.id, id);
    groups.set(id, [...(groups.get(id) ?? []), request.id]);
  }
  return { groups, groupOf };
}

/** One entry to write: the answer, and, for an allow that is sticky, what it covers once the refusals have passed. */
function recordOf<H>(
  harness: Harness<H>,
  pending: PendingApproval,
  resolution: Resolution,
  groupId: string | undefined,
  options: ResolveOptions<H>,
  secrets: readonly string[],
): ResolutionRecord {
  const grouped = groupId === undefined ? {} : { groupId };
  if (decisionOf(resolution) !== "allow" || options.sticky === undefined) return { resolution, ...grouped };
  const { request, input } = pending;
  checkReuse(request.tool, reuseOf(harness, request.tool), "sticky");
  checkSticky(input, options.commandPrefix, secrets);
  const match =
    options.commandPrefix === undefined
      ? { inputHash: request.inputHash }
      : { commandPrefix: [...options.commandPrefix] };
  return {
    resolution,
    sticky: options.sticky,
    allowance: { tool: nameOf(harness, request.tool), ...match },
    ...grouped,
  };
}

/** The entries to write: each answer, expanded to its group, with what it covers beyond its own call. */
async function recordsFor<H>(
  harness: Harness<H>,
  waiting: readonly PendingApproval[],
  resolutions: readonly Resolution[],
  options: ResolveOptions<H>,
  secrets: readonly string[],
): Promise<ResolutionRecord[]> {
  const { groups, groupOf } =
    options.group === true ? await groupsOf(harness, waiting) : { groups: new Map(), groupOf: new Map() };
  const expanded = options.group === true ? expandGroup(resolutions, groups, groupOf) : [...resolutions];
  const byId = new Map(waiting.map((entry) => [entry.request.id, entry]));
  return expanded.map((resolution) =>
    recordOf(
      harness,
      byId.get(resolution.requestId) as PendingApproval,
      resolution,
      groupOf.get(resolution.requestId),
      options,
      secrets,
    ),
  );
}
