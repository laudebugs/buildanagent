/**
 * `composeInterceptors()`: joins several interceptor objects into one, so a context policy, a permission pipeline and
 * an audit can each be written and tested alone. A run takes one `Interceptors` object, and the joined one is it.
 */
import type { Message, ModelContext } from "@buildanagent/gateway";
import type {
  GateDecision,
  Interceptors,
  ModelCallEvent,
  ModelCallPatch,
  StepEvent,
  StopDecision,
  ToolResultPatch,
} from "./hooks.js";

type Hook<K extends keyof Interceptors> = NonNullable<Interceptors[K]>;

function hooksOf<K extends Exclude<keyof Interceptors, "onFailure">>(sets: readonly Interceptors[], name: K) {
  return sets.flatMap((set) => (set[name] === undefined ? [] : [set[name] as Hook<K>]));
}

/** Passes the messages through each `transformContext` in turn: the second sees the first's view. */
const transform =
  (hooks: readonly Hook<"transformContext">[]): Hook<"transformContext"> =>
  async (e) => {
    let messages: readonly Message[] = e.messages;
    for (const hook of hooks) messages = await hook({ ...e, messages });
    return messages;
  };

/** Merges the patches in order: a later field wins, and each hook sees the system and messages set before it. */
const before =
  (hooks: readonly Hook<"beforeModelCall">[]): Hook<"beforeModelCall"> =>
  async (e) => {
    let event: ModelCallEvent = e;
    let merged: ModelCallPatch | undefined;
    for (const hook of hooks) {
      const patch = await hook(event);
      if (patch === undefined) continue;
      merged = { ...merged, ...patch };
      event = { ...event, context: contextAfter(event.context, patch) };
    }
    return merged;
  };

function contextAfter(context: ModelContext, patch: ModelCallPatch): ModelContext {
  return {
    ...context,
    system: patch.system ?? context.system,
    messages: patch.messages === undefined ? context.messages : [...patch.messages],
  };
}

/** Chains the replacements: each hook sees the message the one before it returned. */
const after =
  (hooks: readonly Hook<"afterModelCall">[]): Hook<"afterModelCall"> =>
  async (e) => {
    let message = e.message;
    for (const hook of hooks) message = (await hook({ ...e, message }))?.message ?? message;
    return { message };
  };

/**
 * Asks each gate in turn and keeps the strictest answer: the first `deny` wins at once, an `ask` outranks an `allow`,
 * and a replacement input from one gate is what the later gates see. A gate that throws makes the whole check fail.
 */
const gate =
  (hooks: readonly Hook<"beforeToolCall">[]): Hook<"beforeToolCall"> =>
  async (e) => {
    let input = e.input;
    let asked: GateDecision | undefined;
    for (const hook of hooks) {
      const decision = await hook({ ...e, input });
      if (decision?.decision === "deny") return decision;
      if (decision?.decision === "ask") asked ??= decision;
      else if (decision?.decision === "allow" && decision.input !== undefined) input = decision.input;
    }
    return asked ?? { decision: "allow", ...(input === e.input ? {} : { input }) };
  };

/** Applies the patches in order: each hook sees the result with the earlier patches applied. */
const afterTool =
  (hooks: readonly Hook<"afterToolCall">[]): Hook<"afterToolCall"> =>
  async (e) => {
    let result = e.result;
    let merged: ToolResultPatch | undefined;
    for (const hook of hooks) {
      const patch = await hook({ ...e, result });
      if (patch === undefined) continue;
      merged = { ...merged, ...patch };
      result = { ...result, ...patch };
    }
    return merged;
  };

/** The first `stop` wins at once; otherwise the first `continue` stands; otherwise the run decides. */
const stop =
  (hooks: readonly Hook<"shouldStop">[]): Hook<"shouldStop"> =>
  async (e: StepEvent) => {
    let keepGoing: StopDecision = false;
    for (const hook of hooks) {
      const decision = await hook(e);
      if (typeof decision === "object" && "continue" in decision) {
        if (keepGoing === false) keepGoing = decision;
      } else if (decision !== false) return decision;
    }
    return keepGoing;
  };

/**
 * Joins interceptor objects into one. For a moment that several objects define, the hooks run in the order given,
 * and the result is:
 *
 * - `transformContext`: the messages pass through each hook in turn.
 * - `beforeModelCall`: the patches are merged in order, a later field replacing an earlier one, and each hook sees
 *   the system prompt and messages the earlier ones set.
 * - `afterModelCall`: each hook sees the message the one before returned.
 * - `beforeToolCall`: the strictest decision wins. The first `deny` ends the check, an `ask` beats `allow`, and an
 *   input one gate replaces is the input the next gate sees.
 * - `afterToolCall`: the patches are applied in order, each hook seeing the result so far.
 * - `shouldStop`: the first `stop` wins; failing that, the first `continue`.
 *
 * A hook that throws fails the moment it belongs to, because the joined hook is one function. The joined `onFailure` is
 * `"continue"` only when every object that sets it says so; otherwise the run fails closed.
 */
export function composeInterceptors(...sets: readonly Interceptors[]): Interceptors {
  const lenient = sets.every((set) => (set.onFailure ?? "fail_closed") === "continue");
  const hooks = {
    transformContext: hooksOf(sets, "transformContext"),
    beforeModelCall: hooksOf(sets, "beforeModelCall"),
    afterModelCall: hooksOf(sets, "afterModelCall"),
    beforeToolCall: hooksOf(sets, "beforeToolCall"),
    afterToolCall: hooksOf(sets, "afterToolCall"),
    shouldStop: hooksOf(sets, "shouldStop"),
  };
  return {
    ...(hooks.transformContext.length === 0 ? {} : { transformContext: transform(hooks.transformContext) }),
    ...(hooks.beforeModelCall.length === 0 ? {} : { beforeModelCall: before(hooks.beforeModelCall) }),
    ...(hooks.afterModelCall.length === 0 ? {} : { afterModelCall: after(hooks.afterModelCall) }),
    ...(hooks.beforeToolCall.length === 0 ? {} : { beforeToolCall: gate(hooks.beforeToolCall) }),
    ...(hooks.afterToolCall.length === 0 ? {} : { afterToolCall: afterTool(hooks.afterToolCall) }),
    ...(hooks.shouldStop.length === 0 ? {} : { shouldStop: stop(hooks.shouldStop) }),
    onFailure: lenient && sets.length > 0 ? "continue" : "fail_closed",
  };
}
