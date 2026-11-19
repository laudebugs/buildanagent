/**
 * The default progress policy (D11), written as a `shouldStop` interceptor: it ends a run with `no_progress` when the
 * model keeps making the same failing call. Two rules fire it:
 *
 * - **Identical failures.** The latest calls are one tool with one canonical input hash, each returned an error, and
 *   there are `maxIdenticalFailures` of them in a row (3 by default).
 * - **One key.** A tool's `progressKey()` gave `maxSameKeyCalls` calls (5 by default) the same key and none of them
 *   succeeded. A successful call with that key starts its count again; calls with other keys don't.
 *
 * The policy reads the transcript, so it holds no state a `continueRun()` would have to restore, and it counts only
 * the calls the run itself made.
 */
import type { Message } from "@buildanagent/gateway";
import { SdkError } from "./errors.js";
import type { Interceptors, StepEvent, StopDecision } from "./hooks.js";
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

/** The defaults (D11), provisional until recorded runs retune them. */
export const DEFAULT_PROGRESS: Required<ProgressPolicy> = { maxIdenticalFailures: 3, maxSameKeyCalls: 5 };

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
async function hashOf(callId: string, input: unknown): Promise<string> {
  try {
    return await canonicalInputHash(input);
  } catch {
    return `unhashable:${callId}`;
  }
}

/** The tool calls in `messages` that have a result, in the order the model made them. */
function resolvedCalls(messages: readonly Message[]): { call: ToolCall; failed: boolean }[] {
  const failedBy = new Map<string, boolean>();
  for (const message of messages) {
    if (message.role === "tool") failedBy.set(message.callId, message.isError === true);
  }
  const calls: { call: ToolCall; failed: boolean }[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.content.filter((block): block is ToolCall => block.type === "tool_call")) {
      const failed = failedBy.get(call.callId);
      if (failed !== undefined) calls.push({ call, failed });
    }
  }
  return calls;
}

/** The calls in `messages` that have a result, each with its input hash, key and outcome. */
async function attemptsOf(
  messages: readonly Message[],
  tools: ReadonlyMap<string, AnyTool>,
  hashes: Map<string, Promise<string>>,
): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  for (const { call, failed } of resolvedCalls(messages)) {
    const hash = hashes.get(call.callId) ?? hashOf(call.callId, call.input);
    hashes.set(call.callId, hash);
    attempts.push({ tool: call.name, hash: await hash, key: keyOf(tools.get(call.name), call.input), failed });
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

/**
 * The default progress policy as an interceptor object. `skip` is how many messages came before this run's own, so a
 * run continued from a context that ended in a loop is not stopped by the old calls.
 */
export function progressInterceptors(
  tools: readonly AnyTool[],
  policy: Required<ProgressPolicy>,
  skip: number,
): Interceptors {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const hashes = new Map<string, Promise<string>>();
  const shouldStop = async (e: StepEvent): Promise<StopDecision> => {
    const attempts = await attemptsOf(e.messages.slice(skip), byName, hashes);
    const reason =
      identicalFailures(attempts, policy.maxIdenticalFailures) ?? repeatedKey(attempts, policy.maxSameKeyCalls);
    return reason === undefined ? false : { stop: "no_progress", reason };
  };
  return { shouldStop };
}
