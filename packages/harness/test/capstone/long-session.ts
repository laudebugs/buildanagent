// The capstone's long session: the triage agent answers ticket after ticket in one session, and each lookup returns a
// long customer history, so the context policy masks older results in the request view and, once the log outgrows its
// budget, writes a summary between turns. The model answers from the request it gets, so the script needs no count.
import { createContextPolicy, memorySpillStore } from "@buildanagent/harness/context";
import { openSession, type SessionEntry } from "@buildanagent/harness/session";
import type { RecordedRequest } from "@buildanagent/sdk/testing";
import { SYSTEM_PROMPT, startTriage, triageHarness } from "../../examples/triage-session.js";
import { triageRegistry } from "../../examples/triage-tools.js";
import { BUG, CUSTOMER, determinism, type Files, KEY, recordedModel, signer, world } from "./triage-fixture.js";

export const SUMMARY = "## Goal\nTriage checkout tickets for user@example.com, a pro customer with a long history.";
const HISTORY = "Ticket history: checkout, invoices and refunds for a pro customer. ".repeat(40);
const BUDGET_TOKENS = 3_000;
const TAIL_TOKENS = 800;
const MASK = { keepChars: 120, stepMessages: 4 };

const usage = { uncachedInput: 200, output: 50 };

/** The model's answer to one request: a summary, a lookup for a new ticket, or the triage once it has looked. */
function answer(request: RecordedRequest, calls: { n: number }) {
  if (request.context.system !== SYSTEM_PROMPT) return { content: [{ type: "text" as const, text: SUMMARY }], usage };
  calls.n += 1;
  const looked = request.context.messages.at(-1)?.role === "tool";
  const [name, input] = looked ? ["submit_triage", BUG] : ["lookup_customer", {}];
  return { content: [{ type: "tool_call" as const, callId: `long-${calls.n}`, name, input }], usage };
}

/** Runs `tickets` turns in one session and returns its entries and every request the model received. */
export async function longSession(files: Files, tickets: number) {
  const { clock, newId } = determinism();
  const { deps } = world();
  const calls = { n: 0 };
  const steps = Array.from({ length: tickets * 3 }, () => (request: RecordedRequest) => answer(request, calls));
  const model = recordedModel(steps);
  const registry = triageRegistry({ ...deps, findCustomer: async () => ({ plan: "pro", openTickets: 2, HISTORY }) });
  const context = createContextPolicy({
    spill: memorySpillStore(),
    budgetTokens: BUDGET_TOKENS,
    mask: MASK,
    summarize: { tailTokens: TAIL_TOKENS },
  });
  const harness = triageHarness({ model: model.model, signer: signer(), registry, policy: { version: "t" }, context });
  const session = await openSession({ ...files, key: KEY, now: () => new Date(clock.now()), newId });
  for (let ticket = 1; ticket <= tickets; ticket += 1) {
    const result = await startTriage({ session, harness, app: CUSTOMER }, `Ticket ${ticket}: checkout fails.`, {
      clock,
      newId,
    });
    if (result.stopReason !== "done") {
      throw new Error(`ticket ${ticket} ended ${result.stopReason}`);
    }
  }
  const entries: SessionEntry[] = [];
  for await (const entry of session.playback()) entries.push(entry);
  await session.close();
  return { entries, requests: model.adapter.calls };
}
