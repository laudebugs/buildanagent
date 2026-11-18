// Shared helpers for the verified LangChain examples.
import type { BaseMessage } from "@langchain/core/messages";

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

/** A message's type ("human", "ai", "tool", "system"). */
export const kind = (m?: BaseMessage) => m?.getType();

/** A message's text, whether its content is a string or content blocks. */
export const text = (m?: BaseMessage) =>
  !m ? "" : typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join("");
