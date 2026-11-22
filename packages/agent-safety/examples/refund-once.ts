// A refund tool that can't refund an order twice. The write gets its effect key before it runs, so a crash or a
// regenerated turn finds the first attempt instead of sending a second refund, and the payment API dedupes by the key.
import {
  type EffectScope,
  type EffectStore,
  guardedWrite,
  type WriteOutcome,
  writeOutcome,
} from "@buildanagent/agent-safety";

/** What the model asks the refund tool for. */
export interface RefundInput {
  readonly orderId: string;
  readonly amountCents: number;
}

/** The part of a payment API the tool uses: create a refund under an idempotency key, or find one by its key. */
export interface Payments {
  readonly refunds: {
    create(input: RefundInput, options: { idempotencyKey: string }): Promise<{ id: string }>;
    findByKey(key: string): Promise<{ id: string } | undefined>;
  };
}

/** Issues the refund at most once, whatever crashes or repeats around it, and returns the outcome the model reads. */
export function refundOnce(store: EffectStore, scope: EffectScope, payments: Payments, input: RefundInput) {
  const issued = (id: string): WriteOutcome =>
    writeOutcome({ kind: "applied", operation: "refund_create", next: `Tell the user refund ${id} is issued` });
  return guardedWrite({
    store,
    scope,
    businessKey: `refund:${input.orderId}`,
    operation: "refund_create",
    input,
    dedupe: "idempotency_key",
    run: (key) => payments.refunds.create(input, { idempotencyKey: key }),
    toOutcome: (refund) => issued(refund.id),
    reconcile: async (key) => {
      const found = await payments.refunds.findByKey(key);
      return found === undefined ? "not_found" : issued(found.id);
    },
  });
}
