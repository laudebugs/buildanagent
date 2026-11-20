/**
 * `planCard()`: the payload an approval card shows before a person approves a plan. It lists every step's exact
 * input beside the hash that `signPlan()` will sign, marks the pivot, and shows the state the plan was computed from.
 * Drawing the card is each product's job; this file only builds the data.
 */
import { copyState, hashSteps, type PlanFields, type StateValue, type StepClass, stateHash } from "./plan-approval.js";

/** One step as the approval card shows it. */
export interface PlanCardStep {
  /** The step's place in the plan, from 1. */
  readonly position: number;
  readonly id: string;
  readonly tool: string;
  readonly class: StepClass;
  /** True for the pivot, the step that can't be undone. */
  readonly isPivot: boolean;
  readonly summary: string;
  /** The step's exact input, as JSON data: a copy, so later changes to the plan's objects don't reach the card. */
  readonly input: unknown;
  /** `canonicalInputHash()` of `input`, the hash `signPlan()` signs for this step. */
  readonly inputHash: string;
  readonly businessKey?: string;
}

/** The approval card's payload: the steps in the order they run, the pivot's id, and the state the plan read. */
export interface PlanCard {
  readonly steps: readonly PlanCardStep[];
  /** The id of the pivot, or `null` for a plan whose steps can all be undone. */
  readonly pivot: string | null;
  /** Every value the plan was computed from, as JSON data. */
  readonly state: readonly StateValue[];
}

// Inputs and state values have a canonical JSON form by the time they get here, so a JSON round trip copies exactly
// what the hash covers, with `undefined` properties dropped as the hash drops them.
function jsonCopy(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Builds the approval card for a plan, from the same fields you will pass to `signPlan()` once the person approves.
 * Each step carries its exact input and the input's hash, and `isPivot` marks the step that can't be undone. The
 * card is plain JSON data, ready to send to a UI.
 *
 * Throws a `SafetyError`, code `invalid_plan`, for the cases `signPlan()` throws it for, except `expiresInMs`, which a
 * card doesn't use, and code `invalid_input` for an input or state value with no canonical JSON form.
 */
export async function planCard(fields: Pick<PlanFields, "steps" | "state">): Promise<PlanCard> {
  const { inits, signed } = await hashSteps(fields?.steps);
  const state = copyState(fields?.state);
  // The state hash isn't shown, but computing it rejects a value with no canonical form, as signPlan() would.
  await stateHash(state);
  const steps = signed.map((step, index): PlanCardStep => {
    const card = {
      position: index + 1,
      id: step.id,
      tool: step.tool,
      class: step.class,
      isPivot: step.class === "pivot",
      summary: step.summary,
      input: jsonCopy(inits[index]?.input),
      inputHash: step.inputHash,
    };
    return step.businessKey === undefined ? card : { ...card, businessKey: step.businessKey };
  });
  return {
    steps,
    pivot: signed.find((step) => step.class === "pivot")?.id ?? null,
    state: state.map(({ source, key, value }) => ({ source, key, value: jsonCopy(value) })),
  };
}
