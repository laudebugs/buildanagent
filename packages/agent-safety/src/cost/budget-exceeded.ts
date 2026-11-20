/**
 * `BudgetExceeded`: the refusal of a model call before it is sent. The AI SDK's retry wrapper retries only a provider
 * error marked retryable, so this error ends the call on its first attempt and reaches the caller as a stop.
 */
import { SafetyError } from "../errors.js";

// A registered symbol, so `budgetRefusal()` still recognises the error when two copies of the package are bundled.
const BUDGET_EXCEEDED = Symbol.for("buildanagent.agent-safety.BudgetExceeded");

/** Why a call was refused: its projection would pass the cap, or its price is unknown, so the cap can't be checked. */
export type BudgetRefusalCode = "budget_exceeded" | "unknown_price";

/** What a refusal reports. */
export interface BudgetRefusalInit {
  readonly code: BudgetRefusalCode;
  readonly message: string;
  readonly capUsd: number;
  readonly spentUsd: number;
  readonly projectedUsd: number | null;
  readonly provider: string;
  readonly modelId: string;
}

/**
 * Thrown by a cost guard instead of sending a model call. `spentUsd` is what the run or session had spent, together
 * with what calls still in flight may cost, and `projectedUsd` is the most the refused call could have cost, or `null`
 * when its price is unknown.
 */
export class BudgetExceeded extends SafetyError {
  override readonly name = "BudgetExceeded";
  declare readonly code: BudgetRefusalCode;
  readonly capUsd: number;
  readonly spentUsd: number;
  readonly projectedUsd: number | null;
  /** The `provider` of the refused model, as the AI SDK names it, such as `anthropic.messages`. */
  readonly provider: string;
  readonly modelId: string;

  constructor(init: BudgetRefusalInit) {
    super(init.code, init.message);
    this.capUsd = init.capUsd;
    this.spentUsd = init.spentUsd;
    this.projectedUsd = init.projectedUsd;
    this.provider = init.provider;
    this.modelId = init.modelId;
    Object.defineProperty(this, BUDGET_EXCEEDED, { value: true });
  }
}

function isBudgetExceeded(error: unknown): error is BudgetExceeded {
  return typeof error === "object" && error !== null && (error as Record<symbol, unknown>)[BUDGET_EXCEEDED] === true;
}

/**
 * The `BudgetExceeded` behind an error from `generateText`, `streamText` or an agent, or `undefined` when the error
 * isn't a budget refusal. A refusal on a retry reaches the caller inside the AI SDK's `RetryError`, as the last of its
 * `errors`, so this looks there and in `cause` as well as at the error itself.
 */
export function budgetRefusal(error: unknown): BudgetExceeded | undefined {
  if (isBudgetExceeded(error)) return error;
  if (typeof error !== "object" || error === null) return undefined;
  const { errors, cause } = error as { errors?: unknown; cause?: unknown };
  if (Array.isArray(errors) && isBudgetExceeded(errors.at(-1))) return errors.at(-1) as BudgetExceeded;
  return isBudgetExceeded(cause) ? cause : undefined;
}
