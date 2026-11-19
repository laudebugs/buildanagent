// One outcome of each kind, for a refund tool. The rendered wording is recorded in fixtures/rendered-outcomes.json, so
// a change to it shows up in review and later evals can measure it.
import { type WriteOutcomeInit, writeOutcome } from "@buildanagent/agent-safety";

export const SAMPLE_INITS: readonly WriteOutcomeInit[] = [
  {
    kind: "applied",
    operation: "refund_create",
    effectKey: "refund:order-4417",
    applied: ["refund of $20 to the card ending 4242"],
    currentState: "Order 4417 is refunded",
    next: "Tell the requester the refund was issued",
  },
  {
    kind: "not_applied",
    operation: "refund_create",
    currentState: "Order 4417 has no refund",
    next: "Ask the requester for the order's payment method",
    reason: "PAYMENT_METHOD_MISSING",
  },
  {
    kind: "compensated",
    operation: "refund_create",
    reverted: ["refund"],
    notReversible: ["customer email sent"],
    currentState: "Order 4417 has no refund; its status is unchanged",
    next: "Tell the requester the refund did not go through",
    avoid: "Do not say it was issued",
    reason: "PAYMENT_PROVIDER_DECLINED",
  },
  {
    kind: "partial",
    operation: "refund_create",
    applied: ["refund of $20 to the card ending 4242"],
    notReversible: ["store credit of $5 issued"],
    next: "Hand the ticket to a person in billing",
    reason: "COMPENSATION_FAILED",
  },
  {
    kind: "unknown",
    operation: "refund_create",
    effectKey: "refund:order-4417",
    next: "Look up order 4417's refunds before you do anything else",
    reason: "PROVIDER_TIMEOUT",
  },
];

export const SAMPLES = SAMPLE_INITS.map(writeOutcome);
