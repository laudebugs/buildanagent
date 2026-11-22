/** The answer the durable effect stores give when their conditional write lost: the record that is already there. */
import type { EffectClaim, EffectRecord } from "../effect-store.js";

/**
 * The claim for a write that lost to another process, given the record read back after the loss. A record that vanished
 * between the failed write and the read would mean that another process won and was then deleted, which no store method
 * does. The claim can't be answered, so this throws.
 */
export function lostClaim(key: string, existing: EffectRecord | undefined): EffectClaim {
  if (existing === undefined) throw new Error(`the effect record ${key} changed while it was being claimed`);
  return { existing };
}
