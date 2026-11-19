/**
 * The default progress policy (D11): it ends a run with `no_progress` when the model keeps making the same failing
 * call. Two rules fire it:
 *
 * - **Identical failures.** The latest calls are one tool with one canonical input hash, each returned an error, and
 *   there are `maxIdenticalFailures` of them in a row (3 by default).
 * - **One key.** A tool's `progressKey()` gave `maxSameKeyCalls` calls (5 by default) the same key and none of them
 *   succeeded. A successful call with that key starts its count again; calls with other keys don't.
 *
 * The policy reads the transcript, so it holds no state a `continueRun()` would have to restore, and it counts only
 * the calls the run itself made. The loop runs it after the caller's `shouldStop`, outside the hook runner, so a
 * caller's hook that throws can't switch it off.
 */
import type { AssistantMessage, Message } from "@buildanagent/gateway";
import { SdkError } from "./errors.js";
import type { AnyTool } from "./tools/pipeline.js";
import type { ToolCall } from "./tools/types.js";
import { canonicalInputHash } from "./vendor/agent-safety/hash.js";

/** The thresholds of the default progress policy. Pass `progress: false` to `run()` to turn the policy off. */
export interface ProgressPolicy {
  /** How many identical failing calls in a row end the run. Default 3. */
  readonly maxIdenticalFailures?: number;
  /** How many calls with one `progressKey` and no success between them end the run. Default 5. */
  readonly maxSameKeyCalls?: number;
}

/** The defaults, provisional until recorded runs retune them. The object is frozen, so no caller can change them. */
export const DEFAULT_PROGRESS: Readonly<Required<ProgressPolicy>> = Object.freeze({
  maxIdenticalFailures: 3,
  maxSameKeyCalls: 5,
});

/** Checks a `progress` option and fills in its defaults. */
export function resolveProgress(progress: ProgressPolicy | false | undefined): Required<ProgressPolicy> | undefined {
  if (progress === false) return undefined;
  const policy = { ...DEFAULT_PROGRESS, ...definedFields(progress ?? {}) };
  for (const [name, value] of Object.entries(policy)) {
    if (!Number.isInteger(value) || value < 1) {
      throw new SdkError("invalid_run_options", `progress.${name} must be a positive integer, got ${String(value)}`);
    }
  }
  return policy;
}

function definedFields(policy: ProgressPolicy): ProgressPolicy {
  return Object.fromEntries(Object.entries(policy).filter(([, value]) => value !== undefined));
}

/** One tool call of the run, with the result it got. */
interface Attempt {
  readonly tool: string;
  readonly hash: string;
  readonly key: string | undefined;
  readonly failed: boolean;
}

/** What the policy works out once for each call: its input hash and its key. */
interface CallFacts {
  readonly hash: Promise<string>;
  readonly key: string | undefined;
}

function keyOf(tool: AnyTool | undefined, input: unknown): string | undefined {
  if (tool?.progressKey === undefined) return undefined;
  try {
    const key: unknown = tool.progressKey(input);
    return typeof key === "string" ? key : undefined;
  } catch {
    // A key function that can't read the model's input leaves the call unkeyed, so only the identical-failure rule
    // sees it.
    return undefined;
  }
}

/** The hash of a call's input, or a value no other call shares when the input has no canonical form. */
async function hashOf(position: string, input: unknown): Promise<string> {
  try {
    return await canonicalInputHash(input);
  } catch {
    return `unhashable:${position}`;
  }
}

/** A call waiting for its result, named by its place in the transcript. */
interface Pending {
  readonly call: ToolCall;
  readonly position: string;
  readonly turn: number;
  failed?: boolean;
}

/** The calls of one assistant message, each named by its place in the transcript. */
function callsOf(message: AssistantMessage, turn: number): Pending[] {
  const calls: Pending[] = [];
  message.content.forEach((block, at) => {
    if (block.type === "tool_call") calls.push({ call: block, position: `${turn}:${at}`, turn });
  });
  return calls;
}

/** The unanswered call with `callId` in the newest turn, the first such call within it. */
function callFor(calls: readonly Pending[], callId: string): Pending | undefined {
  let best: Pending | undefined;
  for (const pending of calls) {
    if (pending.failed !== undefined || pending.call.callId !== callId) continue;
    if (best === undefined || pending.turn > best.turn) best = pending;
  }
  return best;
}

/**
 * The tool calls in `messages` that have a result, in the order the model made them. Call ids need not be unique:
 * a provider may repeat one or send none, so a result goes to the unanswered call with its id in the newest turn,
 * the first such call within it, the order the gateway pairs them in.
 */
function resolvedCalls(messages: readonly Message[]): Pending[] {
  const calls: Pending[] = [];
  messages.forEach((message, index) => {
    if (message.role === "assistant") calls.push(...callsOf(message, index));
    if (message.role !== "tool") return;
    const pending = callFor(calls, message.callId);
    if (pending !== undefined) pending.failed = message.isError === true;
  });
  return calls.filter((pending) => pending.failed !== undefined);
}

/** The calls in `messages` that have a result, each with its input hash, key and outcome. */
async function attemptsOf(
  messages: readonly Message[],
  tools: ReadonlyMap<string, AnyTool>,
  facts: Map<string, CallFacts>,
): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  for (const { call, position, failed } of resolvedCalls(messages)) {
    let known = facts.get(position);
    if (known === undefined) {
      known = { hash: hashOf(position, call.input), key: keyOf(tools.get(call.name), call.input) };
      facts.set(position, known);
    }
    attempts.push({ tool: call.name, hash: await known.hash, key: known.key, failed: failed === true });
  }
  return attempts;
}

/** The reason when the latest calls are `limit` identical failures, or `undefined`. */
function identicalFailures(attempts: readonly Attempt[], limit: number): string | undefined {
  const last = attempts.at(-1);
  if (last === undefined || !last.failed) return undefined;
  let streak = 0;
  for (let i = attempts.length - 1; i >= 0; i--) {
    const attempt = attempts[i];
    if (attempt === undefined || !attempt.failed || attempt.tool !== last.tool || attempt.hash !== last.hash) break;
    streak += 1;
  }
  if (streak < limit) return undefined;
  return `the model made ${streak} identical failing calls to ${last.tool} in a row`;
}

/** The reason when some key has `limit` calls and no success since its first, or `undefined`. */
function repeatedKey(attempts: readonly Attempt[], limit: number): string | undefined {
  const counts = new Map<string, number>();
  for (const { tool, key, failed } of attempts) {
    if (key === undefined) continue;
    const id = JSON.stringify([tool, key]);
    const count = failed ? (counts.get(id) ?? 0) + 1 : 0;
    counts.set(id, count);
    if (count >= limit)
      return `the model called ${tool} ${count} times with the key ${JSON.stringify(key)} and none succeeded`;
  }
  return undefined;
}

/** The progress check the loop runs after each step: the reason the run is stuck, or `undefined`. */
export type ProgressCheck = (messages: readonly Message[]) => Promise<string | undefined>;

/**
 * The default progress policy as a check over the transcript. `skip` is how many messages came before this run's
 * own, so a run continued from a context that ended in a loop is not stopped by the old calls. The transcript only
 * grows, so each call's hash and key are worked out once and kept by its place in it.
 */
export function progressCheck(
  tools: readonly AnyTool[],
  policy: Required<ProgressPolicy>,
  skip: number,
): ProgressCheck {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const facts = new Map<string, CallFacts>();
  return async (messages) => {
    const attempts = await attemptsOf(messages.slice(skip), byName, facts);
    return identicalFailures(attempts, policy.maxIdenticalFailures) ?? repeatedKey(attempts, policy.maxSameKeyCalls);
  };
}
