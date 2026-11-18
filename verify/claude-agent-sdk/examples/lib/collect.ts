// Shared helpers for the verified examples.
import type { Query, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";

/** Drain a query, returning every message and the final result. Errors thrown after the result are captured. */
export async function collect(q: Query): Promise<{ messages: SDKMessage[]; result?: SDKResultMessage; thrown?: Error }> {
  const messages: SDKMessage[] = [];
  let thrown: Error | undefined;
  try {
    for await (const m of q) messages.push(m);
  } catch (e) {
    thrown = e as Error;
  }
  const result = messages.find((m): m is SDKResultMessage => m.type === "result");
  return { messages, result, thrown };
}

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}
