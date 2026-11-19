/**
 * `composeInterceptors()`: joins several interceptor objects into one, so a context policy, a permission pipeline and
 * an audit can each be written and tested alone. A run takes one `Interceptors` object, and the joined one is it.
 */
import type { Message, ModelContext } from "@buildanagent/gateway";
import {
  checkDecision,
  checkMessages,
  checkModelPatch,
  checkReplacement,
  checkResultPatch,
  checkStopDecision,
} from "./hook-checks.js";
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

// Each joined hook checks what every one of its hooks returns, as the run checks a hook used alone, so a hook's wrong
// return shape is never hidden by the hooks around it. The checks throw `invalid_hook_result`, which the run rethrows
// whatever `onFailure` says.

/** The fields of `patch` that are set: a field set to `undefined` doesn't erase what an earlier hook set. */
function definedFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** Passes the messages through each `transformContext` in turn: the second sees the first's view. */
const transform =
  (hooks: readonly Hook<"transformContext">[]): Hook<"transformContext"> =>
  async (e) => {
    let messages: readonly Message[] = e.messages;
    for (const hook of hooks) messages = checkMessages("transformContext", await hook({ ...e, messages }));
    return messages;
  };

/**
 * Merges the patches in order: a later field wins, and each hook sees the system prompt, messages and options set
 * before it. `context.tools` stays the list the run would send, because only the run can lower a tool it activates.
 */
const before =
  (hooks: readonly Hook<"beforeModelCall">[]): Hook<"beforeModelCall"> =>
  async (e) => {
    let event: ModelCallEvent = e;
    let merged: ModelCallPatch | undefined;
    for (const hook of hooks) {
      const patch = checkModelPatch(await hook(event));
      if (patch === undefined) continue;
      const fields = definedFields(patch);
      merged = { ...merged, ...fields };
      event = { ...event, context: contextAfter(event.context, fields), options: fields.options ?? event.options };
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
    for (const hook of hooks) message = checkReplacement(await hook({ ...e, message })) ?? message;
    return { message };
  };

/**
 * Asks each gate in turn and keeps the strictest answer: the first `deny` wins at once, an `ask` outranks an `allow`,
 * and a replacement input from one gate is what the later gates see. The answer carries the last replacement, an
 * `ask`'s included, so a pause signs the input the call would run with. A gate that throws makes the whole check fail.
 */
const gate =
  (hooks: readonly Hook<"beforeToolCall">[]): Hook<"beforeToolCall"> =>
  async (e) => {
    let input = e.input;
    let asked: GateDecision | undefined;
    for (const hook of hooks) {
      const decision = checkDecision(await hook({ ...e, input }));
      if (decision.decision === "deny") return decision;
      if (decision.decision === "ask") asked ??= decision;
      if (decision.input !== undefined) input = decision.input;
    }
    const replaced = input === e.input ? {} : { input };
    // An ask carries the input the later gates saw, so the pause is signed over the input the call would run with.
    if (asked !== undefined) return { ...asked, ...replaced };
    return { decision: "allow", ...replaced };
  };

/** Applies the patches in order: each hook sees the result with the earlier patches applied. */
const afterTool =
  (hooks: readonly Hook<"afterToolCall">[]): Hook<"afterToolCall"> =>
  async (e) => {
    let result = e.result;
    let merged: ToolResultPatch | undefined;
    for (const hook of hooks) {
      const patch = checkResultPatch(await hook({ ...e, result }));
      if (patch === undefined) continue;
      const fields = definedFields(patch) as ToolResultPatch;
      merged = { ...merged, ...fields };
      result = { ...result, ...fields };
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
      checkStopDecision(decision);
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
 *   the system prompt, messages and options the earlier ones set. A field left `undefined` keeps the earlier value.
 * - `afterModelCall`: each hook sees the message the one before returned.
 * - `beforeToolCall`: the strictest decision wins. The first `deny` ends the check, an `ask` beats `allow`, and an
 *   input one gate replaces is the input the next gate sees. When a gate asks, the `ask` carries the last
 *   replacement, so the pending request is signed over the input the call would run with.
 * - `afterToolCall`: the patches are applied in order, each hook seeing the result so far.
 * - `shouldStop`: the first `stop` wins; failing that, the first `continue`.
 *
 * Each hook's return value is checked as if the hook ran alone, so a wrong shape, such as a gate that returns nothing,
 * throws an `SdkError` with code `invalid_hook_result` whatever the other hooks return. A hook that throws fails the
 * moment it belongs to, because the joined hook is one function. The joined `onFailure` is
 * `"continue"` only when every object sets it to `"continue"`; an object that leaves it unset counts as
 * `"fail_closed"`. One lenient object therefore never loosens the others, and a join of a gate with a lenient audit
 * hook fails closed. Set `"continue"` on all of them, and the gate then fails open too.
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
