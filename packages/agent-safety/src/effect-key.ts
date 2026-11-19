/**
 * `effectKey()`: the identity of one write, fixed before the write runs. A tool that declares a business key, such as
 * `refund:{orderId}`, gets one key per tenant and business key, so a regenerated model turn, which carries a fresh
 * tool call id, or a new session maps to the same effect. Without a business key the identity falls back to the tool
 * call: tenant, session, branch and call id, the scope the server rollback report asks for. The owner chose the
 * business key's scope on 2026-11-18: one tenant, which is one user, and never the session (close-sdk-gaps SG3).
 *
 * The key is a hash, not the joined fields, because an external API may cap its length and should never see the
 * business key's own text, which can hold an email address or an order number.
 */
import { SafetyError } from "./errors.js";
import { canonicalInputHash } from "./hash.js";

/** Where a write was asked for: the tenant, the session and branch of the conversation, and the model's tool call. */
export interface EffectScope {
  /** The tenant the write acts for. One tenant is one user, so a business key never spans two users. */
  readonly tenant: string;
  /** The session the tool call belongs to. */
  readonly session: string;
  /** The branch of the session's tree, so a forked or rewound branch that replays a call id gets its own key. */
  readonly branch: string;
  /** The model's id for this tool call. */
  readonly toolCallId: string;
}

// Domain separation, so an effect key never equals the hash of some tool input that happens to hold the same fields.
const DOMAIN = "buildanagent.effect-key.v1";

function invalid(message: string): SafetyError {
  return new SafetyError("invalid_effect", message);
}

function requireField(value: unknown, field: string): void {
  if (typeof value !== "string" || value.trim() === "") throw invalid(`an effect scope's ${field} must be non-empty`);
}

/** Throws a `SafetyError`, code `invalid_effect`, unless every scope field and the business key are non-empty text. */
export function checkEffectScope(scope: EffectScope, businessKey?: string): void {
  if (typeof scope !== "object" || scope === null) throw invalid("an effect scope must be an object");
  for (const field of ["tenant", "session", "branch", "toolCallId"] as const) requireField(scope[field], field);
  if (businessKey !== undefined && (typeof businessKey !== "string" || businessKey.trim() === "")) {
    throw invalid("a business key must be non-empty when it is set");
  }
}

/**
 * Returns the effect key of a write, as 64 lowercase hex digits.
 *
 * With a business key, the key depends only on the tenant and the business key, so every call for the same business
 * object, from any session, branch or turn, shares one key. Declare a business key for every tool that sends,
 * submits, pays or deletes, such as `email:{threadId}:{draftId}` or `refund:{orderId}`: without one, a regenerated
 * turn carries a fresh call id, gets a fresh key, and can repeat the write. Without a business key, the key depends on
 * all four scope fields.
 *
 * The key is async, because Web Crypto's digest is. It rejects with a `SafetyError`, code `invalid_effect`, for an
 * empty scope field or business key, and with code `invalid_input` for text holding a lone surrogate.
 *
 * @example
 * ```ts
 * const key = await effectKey(scope, `refund:${input.orderId}`);
 * ```
 */
export async function effectKey(scope: EffectScope, businessKey?: string): Promise<string> {
  checkEffectScope(scope, businessKey);
  return canonicalInputHash(
    businessKey === undefined
      ? {
          domain: DOMAIN,
          tenant: scope.tenant,
          session: scope.session,
          branch: scope.branch,
          toolCallId: scope.toolCallId,
        }
      : { domain: DOMAIN, tenant: scope.tenant, businessKey },
  );
}
