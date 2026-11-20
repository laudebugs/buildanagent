/**
 * Checks on what an interceptor returned. A hook that returns the wrong shape is a programmer error, so each check
 * throws an `SdkError` with code `invalid_hook_result` rather than failing closed: a typo in a gate must be loud.
 */
import type { AssistantMessage, ContentBlock, Message, Model } from "@buildanagent/gateway";
import { SdkError } from "./errors.js";
import type { GateDecision, ModelCallPatch, StopDecision } from "./hooks.js";
import { isContentList } from "./tools/pipeline.js";

function invalid(hook: string, problem: string): never {
  throw new SdkError("invalid_hook_result", `${hook} ${problem}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMessage(value: unknown): value is Message {
  if (!isObject(value)) return false;
  if (value.role === "tool") return typeof value.callId === "string" && Array.isArray(value.content);
  return (value.role === "user" || value.role === "assistant") && Array.isArray(value.content);
}

/** Checks a list of messages and returns a copy of it. */
export function checkMessages(hook: string, value: unknown): Message[] {
  if (!Array.isArray(value) || !value.every(isMessage)) {
    invalid(hook, "must return a list of messages, each with a role and content");
  }
  return [...value];
}

/** Checks `beforeModelCall`'s return value: nothing, or a patch of well-formed fields. */
export function checkModelPatch(value: unknown): ModelCallPatch | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) invalid("beforeModelCall", "must return a patch object or nothing");
  const { system, messages, activeTools, model, options } = value;
  if (system !== undefined && typeof system !== "string")
    invalid("beforeModelCall", "returned a system that is not a string");
  if (messages !== undefined) checkMessages("beforeModelCall", messages);
  if (activeTools !== undefined && !(Array.isArray(activeTools) && activeTools.every((n) => typeof n === "string"))) {
    invalid("beforeModelCall", "returned activeTools that is not a list of tool names");
  }
  if (model !== undefined && typeof (model as Partial<Model> | null)?.stream !== "function") {
    invalid("beforeModelCall", "returned a model that is not from createModel()");
  }
  if (options !== undefined && !isObject(options))
    invalid("beforeModelCall", "returned options that are not an object");
  return value as ModelCallPatch;
}

/** Checks `afterModelCall`'s return value and returns the replacement message, if there is one. */
export function checkReplacement(value: unknown): AssistantMessage | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) invalid("afterModelCall", "must return { message } or nothing");
  const { message } = value;
  if (message === undefined) return undefined;
  if (!isObject(message) || message.role !== "assistant" || !Array.isArray(message.content)) {
    invalid("afterModelCall", "returned a message that is not an assistant message");
  }
  return message as unknown as AssistantMessage;
}

/**
 * Checks the fields an `ask` adds, so a gate's own mistake is reported as one and not as a signer that failed.
 * `policyVersion` is signed, so it must be a non-empty, well-formed string; `reason` is display text, which the pause
 * leaves out when it is blank.
 */
function checkAsk(value: Record<string, unknown>): void {
  const { reason, policyVersion } = value;
  if (reason !== undefined && typeof reason !== "string") {
    invalid("beforeToolCall", "returned ask with a reason that is not a string");
  }
  if (
    policyVersion !== undefined &&
    (typeof policyVersion !== "string" || policyVersion === "" || !policyVersion.isWellFormed())
  ) {
    invalid("beforeToolCall", "returned ask with a policyVersion that is not a non-empty, well-formed string");
  }
}

/** Checks `beforeToolCall`'s decision. */
export function checkDecision(value: unknown): GateDecision {
  if (!isObject(value)) invalid("beforeToolCall", "must return a decision: allow, deny or ask");
  const { decision, reason } = value;
  if (decision !== "allow" && decision !== "deny" && decision !== "ask") {
    invalid("beforeToolCall", `returned the decision ${JSON.stringify(decision)}; it must be allow, deny or ask`);
  }
  if (decision === "deny" && typeof reason !== "string") invalid("beforeToolCall", "returned deny without a reason");
  if (decision === "ask") checkAsk(value);
  return value as unknown as GateDecision;
}

/** Checks `afterToolCall`'s patch. */
export function checkResultPatch(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) invalid("afterToolCall", "must return a patch object or nothing");
  if ("outcome" in value) invalid("afterToolCall", "returned an outcome; replace content instead");
  for (const flag of ["isError", "terminate"] as const) {
    if (value[flag] !== undefined && typeof value[flag] !== "boolean") {
      invalid("afterToolCall", `returned ${flag} that is not a boolean`);
    }
  }
  return value;
}

/** What the run does after `shouldStop`. */
export type StopVerdict =
  | { readonly kind: "none" }
  | { readonly kind: "stop"; readonly stoppedBy: string }
  | { readonly kind: "no_progress"; readonly reason: string }
  | { readonly kind: "continue"; readonly content: ContentBlock[] };

// The continue content becomes a user message in the transcript, so a malformed block would fail a later request far
// from the hook that returned it.
function continueContent(value: string | readonly ContentBlock[]): ContentBlock[] {
  if (typeof value === "string") return [{ type: "text", text: value }];
  if (!isContentList(value)) {
    invalid("shouldStop", "returned a continue that is neither text nor a list of text and image blocks");
  }
  return [...value];
}

/** Checks `shouldStop`'s decision and turns it into a verdict. */
export function checkStopDecision(value: unknown): StopVerdict {
  if (value === true) return { kind: "stop", stoppedBy: "hook" };
  if (value === false) return { kind: "none" };
  if (!isObject(value)) invalid("shouldStop", "must return a boolean, { continue } or { stop, reason }");
  const decision = value as Exclude<StopDecision, boolean>;
  if ("continue" in decision) return { kind: "continue", content: continueContent(decision.continue) };
  if (typeof decision.reason !== "string" || (decision.stop !== "hook" && decision.stop !== "no_progress")) {
    invalid("shouldStop", 'returned a stop that is not { stop: "hook" | "no_progress", reason }');
  }
  return decision.stop === "hook"
    ? { kind: "stop", stoppedBy: decision.reason }
    : { kind: "no_progress", reason: decision.reason };
}
