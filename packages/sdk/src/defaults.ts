/**
 * Every default value, built-in prompt and tool description the SDK uses, in one frozen object, and the hash that
 * `run_start` carries for it (agent-SDK guide §10). A default that changes without notice looks to a user like a model
 * change. So each change must update `DEFAULTS_HASH` and ship with a changeset that releases the package.
 * test/defaults.test.ts fails while the hash is stale, and CI's changeset gate fails a hash change whose changesets
 * release nothing.
 *
 * Templates mark the parts filled in at run time with `{name}`, so the hash covers the fixed text and not one run's
 * values. The write-outcome sentences belong to the vendored safety package, so they stay in its files, and
 * `hashedDefaults()` renders one outcome for every kind and retry rule to cover them too.
 */
import { DEFAULT_INITIAL_RETRY_DELAY_MS } from "@buildanagent/gateway";
import {
  ALLOWED_RETRIES,
  OUTCOME_KINDS,
  type OutcomeKind,
  type Retry,
  type WriteOutcomeInit,
  writeOutcome,
} from "./vendor/agent-safety/outcome.js";
import { renderOutcome } from "./vendor/agent-safety/render.js";

type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };

function deepFreeze<T extends object>(value: T): DeepReadonly<T> {
  for (const item of Object.values(value)) if (typeof item === "object" && item !== null) deepFreeze(item);
  return Object.freeze(value) as DeepReadonly<T>;
}

/** The SDK's defaults, prompts and tool descriptions, frozen. The modules that use one read it from here. */
export const SDK_DEFAULTS = deepFreeze({
  run: {
    /** The step cap, counted in model calls. */
    maxSteps: 20,
    /** The depth cap (D11): a top-level run, its subagents and their subagents may run, and no deeper. */
    maxDepth: 2,
    /** How long a run waits for an observer to catch up before it drops it. */
    observerTimeoutMs: 10_000,
    /** What a hook that throws does (D6). */
    onFailure: "fail_closed",
    /** How many times the loop re-issues a call that ended with a `retryable` error: none, so the run ends `error`. */
    turnRetries: 0,
    /** The wait before the first turn retry, the same as the gateway's before its first retry. */
    turnRetryDelayMs: DEFAULT_INITIAL_RETRY_DELAY_MS,
  },
  /** The default progress policy's thresholds (D11), provisional until recorded runs retune them. */
  progress: { maxIdenticalFailures: 3, maxSameKeyCalls: 5 },
  /** The error text the model reads for a failed tool call (agent-SDK guide §4). */
  toolErrors: {
    /** Received arguments are shown up to this many characters, so one huge argument can't flood the context. */
    maxArgumentsLength: 2000,
    unknownTool: 'There is no tool named "{tool}". The available tools are: {tools}.',
    noTools: "none",
    invalidInput: 'The arguments for tool "{tool}" are invalid:',
    wholeInput: "(the whole input)",
    /** The one issue the model reads when a schema library's validator throws instead of returning issues. */
    validatorThrew: "the schema's validator threw: {message}",
    executionError: 'Tool "{tool}" failed: {message}',
    redactedMessage: "its error message is hidden.",
    truncated:
      'Tool "{tool}" was not run, because the response was cut off at the output limit before the call\'s ' +
      "arguments were complete. Re-issue the call with complete arguments, in a shorter response.",
    notRun: {
      run_aborted: 'Tool "{tool}" was not run, because the run was cancelled.',
      sibling_failed:
        'Tool "{tool}" was not run, because another call in the same step failed with an error in the tool itself.',
      response_error:
        'Tool "{tool}" was not run, because the response ended with an error before it was complete. Re-issue the ' +
        "call if it is still needed.",
      response_aborted:
        'Tool "{tool}" was not run, because the response was stopped before it was complete. Re-issue the call if ' +
        "it is still needed.",
    },
    receivedArguments: "Received arguments: {arguments}",
    /** Ends received arguments cut at `maxArgumentsLength`. */
    moreCharacters: "… ({count} more characters)",
    doNotSubstitute:
      "Do not substitute a mock, a placeholder or invented data for this tool's result. Fix the call, try another " +
      "approach, or tell the user what failed.",
  },
  /** The text the model reads for a call a gate or a person denied. */
  approvals: {
    deniedByApprover: 'Tool call "{tool}" was denied by the approver.',
    denied: 'Tool call "{tool}" was denied: {reason}',
    policyDenied: 'Tool call "{tool}" was approved, but current policy now denies it: {reason}',
    /** The reason a request carries when `continueRun()` asks again for a call whose earlier request failed its check. */
    reissuedReason: "The earlier request for this call could not be verified, so it needs a new answer.",
    gateFailed: 'Tool call "{tool}" was not run, because its permission check failed.',
    /** A blocking approval that failed: `{why}` is `handlerFailed` or `unverified`. */
    refused: 'Tool call "{tool}" was not run, because {why}.',
    handlerFailed: "its approval handler failed",
    unverified: "its approval could not be verified",
    abortedWhileWaiting: 'Tool call "{tool}" was not run, because the run was aborted while it waited for approval.',
    unsigned: 'Tool call "{tool}" needs approval, but its approval request could not be signed, so it was not run.',
    resultWithheld: 'Tool call "{tool}" ran, but its result was withheld, because its result check failed.',
  },
  /** The built-in tools' descriptions and results. */
  tools: {
    output: {
      description: "Submit your final answer as this tool's input. Call it once, when the task is done.",
      accepted: "The final answer was accepted.",
    },
    clarification: {
      name: "ask_user",
      description: "Ask the user a question when you cannot continue without their answer.",
      /** The tool's input schema, which the model reads as well as its description. */
      inputSchema: {
        type: "object",
        properties: { question: { type: "string", minLength: 1, description: "The question to ask the user." } },
        required: ["question"],
        additionalProperties: false,
      },
      sent: "The question was sent to the user.",
    },
  },
});

// A literal, so `run_start` carries it without an async digest; test/defaults.test.ts fails when it goes stale.
/**
 * A hash of every default value, built-in prompt and tool description this SDK release uses: 64 lowercase hex digits,
 * the SHA-256 of their canonical JSON. Every `run_start` event carries it as `defaultsHash`. It changes whenever a
 * default does, and each such change is named in the changelog, so a stored run shows whether new behaviour came with
 * new defaults or from the model.
 */
export const DEFAULTS_HASH = "1a5120b72e65ecc26d78fc9a23b19f3914a5d9f836e1e663d1524b4497c8a044";

/**
 * Fills a template's `{name}` slots in one pass, so a value that itself holds `{name}` is copied, not filled again.
 * A slot with no value stays as written.
 */
export function fillTemplate(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (slot, name: string) => values[name] ?? slot);
}

type OutcomeProbe = Omit<WriteOutcomeInit, "kind" | "operation" | "next">;

function rendered(kind: OutcomeKind, probe: OutcomeProbe): string {
  // A probe's retry is one of ALLOWED_RETRIES[kind], which the generic list type can't carry.
  const init = { kind, operation: "{op}", next: "{next}", ...probe } as WriteOutcomeInit;
  const { text, payload } = renderOutcome(writeOutcome(init));
  // The payload's JSON follows the sentence in the tool result, so its field names reach the model too.
  return `${text}\n${JSON.stringify({ outcome: payload })}`;
}

function outcomeTexts(kind: OutcomeKind): string[] {
  const retries: readonly Retry[] = ALLOWED_RETRIES[kind];
  const probes: OutcomeProbe[] = retries.map((retry) => ({ retry, effectKey: "{key}" }));
  // A not_applied write may retry with the same key and no key at all, which has a sentence of its own.
  if (kind === "not_applied") probes.push({ retry: "same_key" });
  return probes.map((probe) => rendered(kind, probe));
}

/**
 * What `DEFAULTS_HASH` hashes: `SDK_DEFAULTS`, and the write-outcome sentences and payloads for every kind and retry
 * rule, with `{op}`, `{next}` and `{key}` in place of a call's values. A `partial` outcome may also list every effect,
 * a current state and what to avoid, so one more sample outcome covers those sentences.
 */
export function hashedDefaults(): unknown {
  const outcomes = Object.fromEntries(OUTCOME_KINDS.map((kind) => [kind, outcomeTexts(kind)]));
  const effects = rendered("partial", {
    retry: "never",
    applied: ["{applied}"],
    reverted: ["{reverted}"],
    notReversible: ["{notReversible}"],
    currentState: "{state}",
    avoid: "{avoid}",
  });
  return { defaults: SDK_DEFAULTS, outcomes: { ...outcomes, effects } };
}
