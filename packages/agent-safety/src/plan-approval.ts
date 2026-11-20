/**
 * The plan approval: one signed record that lets a person approve a whole multi-step plan once, before its first
 * step, when one step can't be undone. The record binds every step's tool and input hash, the order of the steps and
 * a hash of the state the plan was computed from, under a payload of its own whose fixed tag differs from the pending
 * request's, so a plan signature never verifies as a tool approval and a tool approval never verifies as a plan.
 *
 * The rules for which step checks what are our synthesis of the sagas report in docs/research/reversible-actions, not
 * a vendor design: steps up to and including the pivot check the clock and re-read the state, and steps after it
 * check only that they are the signed step, because the pivot itself changes the state and nothing after it may wait
 * on a person or a clock.
 */
import { constantTimeEqual } from "./bytes.js";
import { SafetyError } from "./errors.js";
import { canonicalInputHash, canonicalJson, canonicalTextHash } from "./hash.js";
import type { ApprovalSigner } from "./signer.js";

/**
 * How a step behaves if the plan fails. `compensable`: a later step's failure can undo it. `pivot`: the point of no
 * return, which can't be undone; once it runs, every later step must run. `retryable`: runs after the pivot and is
 * safe to retry, because it is idempotent.
 */
export type StepClass = "compensable" | "pivot" | "retryable";

/** One signed step of a plan: its tool and the hash of its exact input, with a summary for the approval card. */
export interface PlanStep {
  /** The step's id, unique within the plan. */
  readonly id: string;
  /** The name of the tool the step calls. */
  readonly tool: string;
  /** How the step behaves if the plan fails. */
  readonly class: StepClass;
  /** `canonicalInputHash()` of the step's input. */
  readonly inputHash: string;
  /** The business key the step's write runs under, if it has one. */
  readonly businessKey?: string;
  /** One line that tells the approver what the step does. */
  readonly summary: string;
}

/** A value the plan was computed from: where to read it, and under which key. */
export interface StateRead {
  /** The system that holds the value, such as `orders`. */
  readonly source: string;
  /** The value's key in that system, such as `order:4417:refunded`. */
  readonly key: string;
}

/** A value the plan read, with where it was read from. Use `null` for a value that was absent. */
export interface StateValue extends StateRead {
  /** The value as read. It must have a canonical JSON form. */
  readonly value: unknown;
}

/**
 * A signed plan approval. `signature` covers `planId`, `expiresAt`, `stateHash`, `stateReads` and every field of
 * every step, in order, under the key `keyId` names. Store it as JSON and pass it back to `verifyPlanBeforeStep()`
 * before each step.
 */
export interface PlanApproval {
  /** The plan's own id, which the step ledger records claims under. */
  readonly planId: string;
  /** The steps, in the order they run. */
  readonly steps: readonly PlanStep[];
  /** `stateHash()` of the values the plan was computed from, as they were when the person approved it. */
  readonly stateHash: string;
  /** What to re-read before each step up to and including the pivot, in the order `stateHash` covers them. */
  readonly stateReads: readonly StateRead[];
  /** When the approval lapses for steps up to and including the pivot, as an ISO 8601 timestamp. */
  readonly expiresAt: string;
  /** The id of the key that made `signature`. */
  readonly keyId: string;
  /** The signature, as base64url. */
  readonly signature: string;
}

/** What `lintPlan()` returns: `ok`, or every problem it found with the order of the steps. */
export type PlanLint = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

/** A step as the host plans it, with its input in place of the input's hash. */
export interface PlanStepInit {
  readonly id: string;
  readonly tool: string;
  readonly class: StepClass;
  /** The step's exact input. `signPlan()` stores its `canonicalInputHash()`, never the input itself. */
  readonly input: unknown;
  readonly businessKey?: string;
  readonly summary: string;
}

/** The plan a person approved: its steps, the state it was computed from, and how long the approval lasts. */
export interface PlanFields {
  /** The steps, in the order they run. */
  readonly steps: readonly PlanStepInit[];
  /** Every value the steps' inputs were computed from, as read when the plan was made. */
  readonly state: readonly StateValue[];
  /** How long the approval lasts for steps up to and including the pivot, in milliseconds. */
  readonly expiresInMs: number;
}

/** Where `signPlan()` takes its plan id and time from. Tests pass fixed ones. */
export interface SignPlanOptions {
  /**
   * Returns a fresh plan id. Defaults to `crypto.randomUUID()`. Each approval needs its own id: the ledger tracks
   * progress by id, so a second approval with a repeated id is refused as `"replayed"` or `"out_of_order"`.
   */
  readonly generateId?: () => string;
  /** Returns the current time. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

/** The step a host is about to run, as it has the step now, not as the approval records it. */
export interface PlanStepCall {
  readonly stepId: string;
  readonly tool: string;
  readonly input: unknown;
}

/**
 * Records which steps of each plan have passed verification. `claim()` must be atomic: it records step `stepIndex`
 * of `planId` only when every earlier step is recorded and this one isn't, and answers `replayed` when this step is
 * already recorded and `out_of_order` when an earlier one isn't. Two claims of one step that arrive together must
 * get one `claimed` between them.
 */
export interface PlanLedger {
  claim(planId: string, stepIndex: number): Promise<"claimed" | "replayed" | "out_of_order">;
}

/** The options of `verifyPlanBeforeStep()`. */
export interface VerifyPlanStepOptions {
  /** A signer that holds the key the approval names. */
  readonly signer: ApprovalSigner;
  /** Where each step's claim is recorded, so no step passes twice and none passes before the steps ahead of it. */
  readonly ledger: PlanLedger;
  /**
   * Re-reads the approval's `stateReads` now and returns their values in the same order. Return `null` for an absent
   * value, as the plan recorded it: `undefined` has no canonical form, so it counts as a changed value.
   */
  readonly readState: (reads: readonly StateRead[]) => Promise<readonly unknown[]>;
  /** Returns the current time. Defaults to `new Date()`. */
  readonly now?: () => Date;
}

/**
 * What `verifyPlanBeforeStep()` found. `ok`: run the step. `stale_approval`: a value the plan was computed from has
 * changed. `expired`: the approval has lapsed. `tampered`: the record is malformed, its signature fails or names an
 * unknown key, or the step's tool or input differs from the signed one. `step_not_in_plan`: no signed step has the
 * id. `replayed`: the step already passed once. `out_of_order`: a step ahead of it hasn't passed yet.
 */
export type PlanStepCheck =
  | "ok"
  | "stale_approval"
  | "expired"
  | "tampered"
  | "step_not_in_plan"
  | "replayed"
  | "out_of_order";

// Ties a signature to this record and its layout. The pending request's tag is "buildanagent.pending.v1", so the two
// payloads differ in their first element and no byte string is both.
const PLAN_TAG = "buildanagent.plan-approval.v1";
// Keeps the state hash apart from any tool input hash, which shares canonicalInputHash().
const STATE_TAG = "buildanagent.plan-state.v1";
const CLASSES: readonly string[] = ["compensable", "pivot", "retryable"];
const HASH = /^[0-9a-f]{64}$/;
const ENCODER = new TextEncoder();

function isText(value: unknown): value is string {
  return typeof value === "string" && value !== "" && value.isWellFormed();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function invalidPlan(message: string): SafetyError {
  return new SafetyError("invalid_plan", message);
}

// Names a class without converting it to a string, which throws for an object with no prototype.
function describeClass(stepClass: unknown): string {
  if (stepClass === undefined) return "no class";
  return typeof stepClass === "string"
    ? `the class ${JSON.stringify(stepClass)}`
    : `a class that is a ${typeof stepClass}`;
}

function orderProblem(
  id: string,
  stepClass: unknown,
  pivot: string | undefined,
  hasPivot: boolean,
): string | undefined {
  if (typeof stepClass !== "string" || !CLASSES.includes(stepClass))
    return `step ${id} has ${describeClass(stepClass)}`;
  if (stepClass === "compensable" && pivot !== undefined) return `step ${id} is compensable but comes after the pivot`;
  if (stepClass === "retryable" && pivot === undefined) {
    return hasPivot
      ? `step ${id} is retryable but comes before the pivot`
      : `step ${id} is retryable but the plan has no pivot`;
  }
  return undefined;
}

function checkId(id: unknown, name: string, seen: Set<string>): string | undefined {
  if (!isText(id)) return `step ${name} needs a non-empty, well-formed id`;
  if (seen.has(id)) return `two steps share the id ${name}`;
  seen.add(id);
  return undefined;
}

/**
 * Checks the order of a plan's steps: every compensable step comes before the pivot, a plan has at most one pivot,
 * and every retryable step comes after it, so a plan without a pivot holds compensable steps only. It also needs at
 * least one step and unique, non-empty step ids. Returns `ok: true`, or `ok: false` with every problem it found.
 */
export function lintPlan(steps: readonly Pick<PlanStep, "id" | "class">[]): PlanLint {
  if (!Array.isArray(steps) || steps.length === 0) return { ok: false, problems: ["a plan needs at least one step"] };
  // Each step's id and class are read once, so a getter can't answer one check differently from the next.
  const list = Array.from(steps as readonly unknown[], (step) => {
    const { id, class: stepClass } = isRecord(step) ? step : {};
    return { id, stepClass };
  });
  const hasPivot = list.some(({ stepClass }) => stepClass === "pivot");
  const problems: string[] = [];
  const seen = new Set<string>();
  let pivot: string | undefined;
  for (const [index, { id, stepClass }] of list.entries()) {
    const name = isText(id) ? JSON.stringify(id) : `${index + 1}`;
    const idProblem = checkId(id, name, seen);
    if (idProblem !== undefined) problems.push(idProblem);
    const problem = orderProblem(name, stepClass, pivot, hasPivot);
    if (problem !== undefined) problems.push(problem);
    if (stepClass === "pivot") {
      if (pivot !== undefined) problems.push(`the plan has two pivots: ${pivot} and ${name}`);
      pivot ??= name;
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

function copyStateValue(value: unknown, index: number): StateValue {
  const { source, key, value: read } = isRecord(value) ? value : {};
  if (!isText(source) || !isText(key)) {
    throw invalidPlan(`state value ${index + 1} needs a non-empty, well-formed source and key`);
  }
  return { source, key, value: read };
}

/**
 * Copies a state list once and checks it: every entry has a source and a key, and no read appears twice. `planCard()`
 * shares it. Not exported from the package.
 */
export function copyState(state: unknown): StateValue[] {
  if (!Array.isArray(state)) throw invalidPlan("a plan's state must be an array of { source, key, value }");
  const copies = Array.from(state as readonly unknown[], copyStateValue);
  const seen = new Set<string>();
  for (const { source, key } of copies) {
    const id = JSON.stringify([source, key]);
    if (seen.has(id)) throw invalidPlan(`the state reads ${source} ${JSON.stringify(key)} twice`);
    seen.add(id);
  }
  return copies;
}

/**
 * Hashes the values a plan was computed from: the SHA-256 of the canonical JSON (RFC 8785) of each value with its
 * source and key, in order, under a fixed tag, as 64 lowercase hex digits. Any changed value, read or order gives a
 * different hash.
 *
 * Rejects with a `SafetyError`, code `invalid_plan`, for an entry without a source or key or a read listed twice, and
 * code `invalid_input` for a value with no canonical JSON form, `undefined` included: write an absent value as `null`.
 */
export async function stateHash(state: readonly StateValue[]): Promise<string> {
  const copies = copyState(state);
  return canonicalInputHash([STATE_TAG, copies.map(({ source, key, value }) => [source, key, value])]);
}

/** The bytes a plan signature covers: a JSON array of fixed shape whose every string is well formed. */
function planPayload(signed: Omit<PlanApproval, "keyId" | "signature">): Uint8Array {
  const reads = signed.stateReads.map(({ source, key }) => [source, key]);
  const steps = signed.steps.map((s) => [s.id, s.tool, s.class, s.inputHash, s.businessKey ?? null, s.summary]);
  return ENCODER.encode(JSON.stringify([PLAN_TAG, signed.planId, signed.expiresAt, signed.stateHash, reads, steps]));
}

function copyStepInit(step: unknown, index: number): PlanStepInit {
  const { id, tool, class: stepClass, input, businessKey, summary } = isRecord(step) ? step : {};
  const bad = (what: string) => invalidPlan(`step ${index + 1}'s ${what}`);
  if (!isText(id) || !isText(tool) || !isText(summary)) throw bad("id, tool and summary must be non-empty strings");
  if (businessKey !== undefined && !isText(businessKey)) throw bad("businessKey must be a non-empty string when set");
  if (!CLASSES.includes(stepClass as string)) throw bad(`class must be "compensable", "pivot" or "retryable"`);
  const copy = { id, tool, class: stepClass as StepClass, input, summary };
  return businessKey === undefined ? copy : { ...copy, businessKey };
}

/**
 * Copies a plan's steps once, checks each field and the order, and hashes each input. Each input is read once, into
 * canonical JSON text: the hash covers that text, and `inputs` holds it parsed back, so `planCard()`, which shares this
 * with `signPlan()`, shows exactly the input each hash covers. Not exported from the package.
 */
export async function hashSteps(steps: unknown): Promise<{ inputs: unknown[]; signed: PlanStep[] }> {
  if (!Array.isArray(steps)) throw invalidPlan("a plan's steps must be an array");
  const inits = Array.from(steps as readonly unknown[], copyStepInit);
  const lint = lintPlan(inits);
  if (!lint.ok) throw invalidPlan(`the plan's steps fail lintPlan(): ${lint.problems.join("; ")}`);
  const texts = inits.map(({ input }) => canonicalJson(input));
  const signed = await Promise.all(
    inits.map(
      async ({ input: _input, ...step }, index): Promise<PlanStep> => ({
        ...step,
        inputHash: await canonicalTextHash(texts[index] as string),
      }),
    ),
  );
  return { inputs: texts.map((text) => JSON.parse(text) as unknown), signed };
}

function expiryOf(now: Date, expiresInMs: unknown): string {
  if (typeof expiresInMs !== "number" || !Number.isFinite(expiresInMs) || expiresInMs < 1) {
    // Dates hold whole milliseconds, so anything under 1 would sign an approval that is expired when issued.
    throw invalidPlan("expiresInMs must be a finite number of milliseconds, at least 1");
  }
  const at = new Date(now.getTime() + expiresInMs);
  if (Number.isNaN(at.getTime())) throw invalidPlan("now() plus expiresInMs must be a valid time");
  return at.toISOString();
}

/**
 * Signs a plan approval. Call it once the person has approved the plan's card, with the steps and state you built
 * the card from and kept on your server, never with fields the client sends back. It checks the steps with
 * `lintPlan()`, hashes each input with `canonicalInputHash()` and the state with `stateHash()`, signs the result with
 * the signer's current key, and returns the record to store. The inputs and state values themselves aren't stored.
 *
 * Throws a `SafetyError`, code `invalid_plan`, for a blank or malformed field, steps out of order, a read listed
 * twice or an `expiresInMs` that isn't a finite number of at least 1, and code `invalid_input` for an input or state value with no
 * canonical JSON form.
 */
export async function signPlan(
  fields: PlanFields,
  signer: ApprovalSigner,
  options: SignPlanOptions = {},
): Promise<PlanApproval> {
  const planId = (options.generateId ?? (() => crypto.randomUUID()))();
  if (!isText(planId)) throw invalidPlan("a plan's id must be a non-empty, well-formed string");
  const { steps, state, expiresInMs } = isRecord(fields) ? fields : ({} as Record<string, unknown>);
  // Copy the steps and the state before the first await, as `planCard()` does, so a change made while the hashes are
  // pending can't give the signature a state the person never saw on the card.
  const hashing = hashSteps(steps);
  const reads = copyState(state);
  const { signed: signedSteps } = await hashing;
  const signed = {
    planId,
    steps: signedSteps,
    stateHash: await stateHash(reads),
    stateReads: reads.map(({ source, key }) => ({ source, key })),
    expiresAt: expiryOf((options.now ?? (() => new Date()))(), expiresInMs),
  };
  const signature = await signer.sign(planPayload(signed));
  return { ...signed, keyId: signer.keyId, signature };
}

function isTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function copySignedStep(step: unknown): PlanStep | undefined {
  const { id, tool, class: stepClass, inputHash, businessKey, summary } = isRecord(step) ? step : {};
  if (![id, tool, summary].every(isText) || !CLASSES.includes(stepClass as string)) return undefined;
  if (typeof inputHash !== "string" || !HASH.test(inputHash)) return undefined;
  if (businessKey !== undefined && !isText(businessKey)) return undefined;
  const copy = { id, tool, class: stepClass, inputHash, summary } as PlanStep;
  return businessKey === undefined ? copy : { ...copy, businessKey };
}

function copyRead(read: unknown): StateRead | undefined {
  const { source, key } = isRecord(read) ? read : {};
  return isText(source) && isText(key) ? { source, key } : undefined;
}

function copyList<T>(value: unknown, copy: (item: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = Array.from(value as readonly unknown[], copy);
  return items.every((item) => item !== undefined) ? (items as T[]) : undefined;
}

/**
 * Reads each field of an untrusted record once into a plain copy, or returns `undefined` if any field is malformed.
 * Every later check reads the copy, so a getter or a Proxy can't show the signature one value and the checks another.
 */
function copyApproval(value: unknown): PlanApproval | undefined {
  if (!isRecord(value)) return undefined;
  const { planId, steps, stateHash: hash, stateReads, expiresAt, keyId, signature } = value;
  if (![planId, keyId, signature].every(isText) || typeof hash !== "string" || !HASH.test(hash)) return undefined;
  if (!isTimestamp(expiresAt)) return undefined;
  const stepCopies = copyList(steps, copySignedStep);
  const readCopies = copyList(stateReads, copyRead);
  if (stepCopies === undefined || readCopies === undefined) return undefined;
  return {
    planId: planId as string,
    steps: stepCopies,
    stateHash: hash,
    stateReads: readCopies,
    expiresAt,
    keyId: keyId as string,
    signature: signature as string,
  };
}

function hashesEqual(a: string, b: string): boolean {
  return constantTimeEqual(ENCODER.encode(a), ENCODER.encode(b));
}

async function inputMatches(inputHash: string, input: unknown): Promise<boolean> {
  try {
    return hashesEqual(await canonicalInputHash(input), inputHash);
  } catch {
    // An input with no canonical form can't be the one that was signed, which had one.
    return false;
  }
}

async function stateMatches(approval: PlanApproval, values: unknown): Promise<boolean> {
  if (!Array.isArray(values) || values.length !== approval.stateReads.length) return false;
  const read = Array.from(values as readonly unknown[]);
  try {
    const fresh = await stateHash(approval.stateReads.map((r, index) => ({ ...r, value: read[index] })));
    return hashesEqual(fresh, approval.stateHash);
  } catch {
    // A value with no canonical form can't equal one that had one, so the state counts as changed.
    return false;
  }
}

async function checkFreshness(approval: PlanApproval, options: VerifyPlanStepOptions): Promise<PlanStepCheck> {
  const now = (options.now ?? (() => new Date()))().getTime();
  // Written as "not before", so an invalid clock reading (NaN) counts as expired.
  if (!(now < Date.parse(approval.expiresAt))) return "expired";
  const values = await options.readState(approval.stateReads.map(({ source, key }) => ({ source, key })));
  return (await stateMatches(approval, values)) ? "ok" : "stale_approval";
}

async function signatureHolds(signer: ApprovalSigner, record: PlanApproval): Promise<boolean> {
  try {
    return (await signer.verify(record.keyId, planPayload(record), record.signature)) === true;
  } catch {
    return false;
  }
}

/**
 * Checks a plan approval before one of its steps runs, failing closed. Run the step only when it resolves to `"ok"`.
 *
 * For every step, the record must be well formed and its signature must verify under a key the signer holds; the
 * step's id must be in the plan; and its tool and input must match the signed tool and input hash. For steps up to
 * and including the pivot, the approval must not have expired, and `readState` must return values whose
 * `stateHash()` equals the signed one. Steps after the pivot skip the clock and the state, because the pivot itself
 * changes the state and nothing after it may stop on a person or a clock. Last, the step's claim goes to the ledger,
 * so no step passes twice and none passes before the steps ahead of it. A failed check claims nothing.
 *
 * The ledger records that a step passed this check, not that it ran. So `"ok"` for a step after the pivot means the
 * pivot passed, not that its write succeeded. A second check of a step up to the pivot can also return
 * `"stale_approval"` or `"expired"` before the ledger can answer `"replayed"`. Track which steps ran yourself, run the
 * next step only after the last one succeeded, and never compensate once the pivot has run.
 *
 * It returns the first failure it finds. It never throws for a bad record or call, and a signer that throws counts as
 * `"tampered"`. It rejects only when `readState` or the ledger rejects, and then the step must not run either.
 */
export async function verifyPlanBeforeStep(
  approval: unknown,
  call: PlanStepCall,
  options: VerifyPlanStepOptions,
): Promise<PlanStepCheck> {
  const record = copyApproval(approval);
  if (record === undefined) return "tampered";
  // The signature comes first: until it verifies, no other field of the stored record is trusted.
  // A signer that throws (a malformed signature, a key-store error) refuses the step instead of rejecting the call.
  if (!(await signatureHolds(options.signer, record))) return "tampered";
  if (!lintPlan(record.steps).ok) return "tampered";
  const { stepId, tool, input } = isRecord(call) ? call : ({} as Record<string, unknown>);
  const index = record.steps.findIndex((step) => step.id === stepId);
  const step = record.steps[index];
  if (step === undefined) return "step_not_in_plan";
  if (tool !== step.tool || !(await inputMatches(step.inputHash, input))) return "tampered";
  if (step.class !== "retryable") {
    const fresh = await checkFreshness(record, options);
    if (fresh !== "ok") return fresh;
  }
  const claim = await options.ledger.claim(record.planId, index);
  if (claim === "claimed") return "ok";
  // Anything else a ledger answers, even a value outside its type, counts as a refusal.
  return claim === "replayed" ? "replayed" : "out_of_order";
}
