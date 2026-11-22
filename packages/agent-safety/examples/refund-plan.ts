// The refund-then-email plan a person approves once, before its first step. Marking the order can be undone, the
// refund is the pivot that can't, and the email and the closing update run after it and are safe to retry. The state
// lists the two balances the refund amount was computed from, so a change to either stops the plan before the refund.
import type { PlanFields } from "@buildanagent/agent-safety";

const APPROVAL_TTL_MS = 15 * 60 * 1000;
const CENTS_PER_DOLLAR = 100;

/** An order as the plan reads it: what may still be refunded and what already was, in cents. */
export interface Order {
  readonly id: string;
  readonly customerEmail: string;
  readonly refundableCents: number;
  readonly refundedCents: number;
}

// biome-ignore format: one line pair per step keeps the plan readable as a table.
/** The four-step plan that refunds what is left on `order` and tells the customer. */
export function refundPlan(order: Order): PlanFields {
  const { id: orderId, customerEmail: to, refundableCents, refundedCents } = order;
  const amountCents = refundableCents - refundedCents;
  const amount = `$${(amountCents / CENTS_PER_DOLLAR).toFixed(2)}`;
  const subject = "Your refund";
  const body = `We have refunded ${amount} to your card.`;
  return {
    steps: [
      { id: "mark", tool: "order_update", class: "compensable", input: { orderId, status: "refund_pending" },
        summary: `Mark order ${orderId} as refund_pending` },
      { id: "refund", tool: "refund_create", class: "pivot", input: { orderId, amountCents, currency: "usd" },
        businessKey: `refund:${orderId}`, summary: `Refund ${amount} to the card on order ${orderId}` },
      { id: "email", tool: "send_email", class: "retryable", input: { to, subject, body },
        businessKey: `email:${orderId}:refund`, summary: `Tell ${to} the refund is on its way` },
      { id: "close", tool: "order_update", class: "retryable", input: { orderId, status: "refunded" },
        summary: `Mark order ${orderId} as refunded` },
    ],
    state: [
      { source: "orders", key: `order:${orderId}:refundable_cents`, value: refundableCents },
      { source: "payments", key: `order:${orderId}:refunded_cents`, value: refundedCents },
    ],
    expiresInMs: APPROVAL_TTL_MS,
  };
}
