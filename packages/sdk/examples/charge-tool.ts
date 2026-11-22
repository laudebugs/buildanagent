// A charge tool that changes the world, on our SDK and @buildanagent/agent-safety. guardedWrite() stores a record of the
// write before the server is asked and settles it with the outcome afterwards, so a crash in between leaves a record
// that says "started" and the tool answers `unknown`, never "failed". The book's Chapter 16 lists the regions beside the
// same step in the Vercel AI SDK.
import {
  type EffectRecord,
  type EffectStore,
  guardedWrite,
  type WriteOutcome,
  writeOutcome,
} from "@buildanagent/agent-safety";
import { defineTool } from "@buildanagent/sdk";
import { z } from "zod";

/** What the tool needs: where the server is, where the records live and a clock. */
export interface ChargeDeps {
  readonly base: string;
  readonly store: EffectStore;
  readonly now?: () => number;
}

/** The caller the example's effect keys are scoped to; a tool call id joins it for each call. */
export const SCOPE = { tenant: "user-1", session: "session-1", branch: "main" };
/** The business key of a charge: one charge for one order, however many attempts or call ids it takes. */
export const chargeKey = (order: number): string => `charge:${order}`;
const LEASE_MS = 60_000;
const OK = 200;
const DECLINED = 402;
const NOT_FOUND = 404;

/** Sends one charge to the server under the effect key and returns the status it answered. */
async function send(base: string, key: string, order: number): Promise<number> {
  const request = { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ order }) };
  return (await fetch(base, request)).status;
}

/** Turns the server's status into the outcome the model reads: only a 402 proves nothing was written. */
function outcomeOf(status: number, key: string): WriteOutcome {
  const base = { operation: "charge", effectKey: key };
  if (status === OK) return writeOutcome({ ...base, kind: "applied", next: "Tell the user the charge went through." });
  if (status === DECLINED) {
    const next = "Tell the user the card was declined.";
    return writeOutcome({ ...base, kind: "not_applied", retry: "never", reason: "CARD_DECLINED", next });
  }
  const next = "Check the charge before you do anything else.";
  return writeOutcome({ ...base, kind: "unknown", retry: "reconcile_first", reason: "SERVER_ERROR", next });
}

// #region write-tool
/** The charge tool: the record is stored first, the server is asked once, and the record is settled last. */
export function chargeTool({ base, store, now = Date.now }: ChargeDeps) {
  return defineTool({
    name: "charge",
    description: "Charge the customer for an order.",
    inputSchema: z.object({ order: z.number().int().positive() }),
    effect: { kind: "write" },
    async execute(input, { callId }) {
      const outcome = await guardedWrite({
        store,
        now,
        leaseMs: LEASE_MS,
        scope: { ...SCOPE, toolCallId: callId },
        businessKey: chargeKey(input.order), // book:note key
        operation: "charge",
        input,
        dedupe: "idempotency_key",
        run: (key) => send(base, key, input.order), // book:note persist
        toOutcome: outcomeOf,
        // A started record whose lease has lapsed sends the tool to the server's records, before it writes again.
        reconcile: async (key) => {
          const found = await fetch(`${base}/${key}`); // book:note reconcile
          if (found.status === OK) return outcomeOf(OK, key);
          if (found.status === NOT_FOUND) return "not_found";
          throw new Error(`the lookup answered ${found.status}`); // book:note unclear
        },
      });
      return { content: [], outcome };
    },
  });
}
// #endregion

// #region effect-log
/** The state of one operation: its record's outcome, or `unknown` when the record says the write started. */
export async function stateOf(store: EffectStore, key: string): Promise<"none" | WriteOutcome["kind"]> {
  const record: EffectRecord | undefined = await store.get(key);
  if (record === undefined) return "none";
  return record.state === "settled" ? (record.outcome?.kind ?? "unknown") : "unknown"; // book:note state
}
// #endregion
