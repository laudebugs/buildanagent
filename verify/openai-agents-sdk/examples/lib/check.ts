// Shared helpers for the verified OpenAI Agents SDK examples.
import { Runner } from "@openai/agents";
import { record } from "./transcript.ts";

/** A runner with tracing off, so tests make no network requests (guides/testing.mdx). */
export const runner = new Runner({ tracingDisabled: true });

export function check(cond: unknown, msg: string): asserts cond {
  record({ kind: "check", message: msg, pass: Boolean(cond) });
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}
