// A refund tool whose every result is a typed outcome the model can read. The write gets its effect key before it runs,
// so a regenerated turn finds the first refund instead of sending a second one.
import {
  type EffectScope,
  type EffectStore,
  guardedWrite,
  type RenderedOutcome,
  renderOutcome,
  writeOutcome,
} from "@buildanagent/agent-safety";

/** What the model asks the refund tool for. */
export interface RefundRequest {
  readonly orderId: string;
  readonly amountCents: number;
}

/** What the payment API throws when the card issuer declines a refund. */
export class RefundDeclined extends Error {}

/** The part of a payment API the tool uses: create a refund, deduped by an idempotency key. */
export interface RefundApi {
  refund(input: RefundRequest, idempotencyKey: string): Promise<{ id: string }>;
}

// #region tool
/**
 * Issues the refund at most once and returns what the model reads: a sentence, a payload and an error flag.
 * `scope` says who asked: the tenant, the session, the branch and the model's tool call.
 */
export async function refundTool(
  store: EffectStore,
  scope: EffectScope,
  payments: RefundApi,
  input: RefundRequest,
): Promise<RenderedOutcome> {
  const outcome = await guardedWrite({
    store,
    scope,
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
