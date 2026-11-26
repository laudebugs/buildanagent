// A refund tool that tells the model exactly what happened and can't refund an order twice. Every write gets a typed
// outcome, and the write gets its identity before it runs, so a regenerated turn finds the first refund instead of
// sending a second one.
import {
  type EffectStore,
  guardedWrite,
  type RenderedOutcome,
  renderOutcome,
  writeOutcome,
} from "@buildanagent/agent-safety";

/** What the model asks the refund tool for. */
export interface RefundInput {
  readonly orderId: string;
  readonly amountCents: number;
}

/** What the payment API throws when the card issuer declines a refund. */
export class RefundDeclined extends Error {}

/** The part of a payment API the tool uses: create a refund, deduped by an idempotency key. */
export interface Payments {
  refund(input: RefundInput, idempotencyKey: string): Promise<{ id: string }>;
}

// #region tool
/** Issues the refund at most once and returns what the model reads: a sentence, a payload and an error flag. */
export async function refundTool(
  store: EffectStore,
  payments: Payments,
  toolCallId: string,
  input: RefundInput,
): Promise<RenderedOutcome> {
  const outcome = await guardedWrite({
    store,
    scope: { tenant: "ada", session: "chat-1", branch: "main", toolCallId },
    businessKey: `refund:${input.orderId}`,
    operation: "refund_create",
    input,
    dedupe: "idempotency_key",
    run: (key) => payments.refund(input, key),
    toOutcome: (refund) =>
      writeOutcome({
        kind: "applied",
        operation: "refund_create",
        next: `Tell the user refund ${refund.id} is issued`,
      }),
    onError: (error) => {
      if (!(error instanceof RefundDeclined)) throw error;
      return writeOutcome({
        kind: "not_applied",
        operation: "refund_create",
        reason: "CARD_DECLINED",
        next: "Ask the requester for another payment method",
      });
    },
  });
  return renderOutcome(outcome);
}
// #endregion
