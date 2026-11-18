// Shared helpers for the verified OpenAI Agents SDK examples.
import { Runner } from "@openai/agents";

/** A runner with tracing off, so tests make no network requests (guides/testing.mdx). */
export const runner = new Runner({ tracingDisabled: true });

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}
