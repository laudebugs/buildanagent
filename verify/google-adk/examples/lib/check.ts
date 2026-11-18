// Shared helpers for the verified ADK examples: assertions, a scripted model and a run helper.
// @google/adk@2.5.0 ships no fake model, so ScriptedLlm subclasses its BaseLlm, the seam ADK's own
// tests use. Each test passes a script: a function from the request (and call number) to the response.
import type { BaseLlmConnection, Event, LlmRequest, LlmResponse, Runner } from "@google/adk";
import { BaseLlm } from "@google/adk";
import type { Content, Part } from "@google/genai";

export function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`ok - ${msg}`);
}

export type Script = (req: LlmRequest, call: number) => LlmResponse | Promise<LlmResponse>;

export class ScriptedLlm extends BaseLlm {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly script: Script) {
    super({ model: "scripted" });
  }
  override async *generateContentAsync(req: LlmRequest): AsyncGenerator<LlmResponse, void> {
    // Keep a copy: ADK reuses and mutates request objects between steps.
    this.requests.push(
      structuredClone({ contents: req.contents, config: { ...req.config, abortSignal: undefined } }) as LlmRequest,
    );
    yield await this.script(req, this.requests.length);
  }
  override async connect(): Promise<BaseLlmConnection> {
    throw new Error("live connections are not scripted");
  }
}

let seq = 0;
/** A model turn that calls one function. */
export const callTool = (name: string, args: Record<string, unknown> = {}): LlmResponse => ({
  content: { role: "model", parts: [{ functionCall: { id: `call-${++seq}`, name, args } }] },
});
/** A model turn that answers with text. */
export const say = (text: string): LlmResponse => ({
  content: { role: "model", parts: [{ text }] },
  turnComplete: true,
});

/** The parts of a request's last content (what the model is answering). */
export const lastParts = (req: LlmRequest): Part[] => req.contents.at(-1)?.parts ?? [];
/** True when the request's last content is a tool result. */
export const afterTool = (req: LlmRequest) => lastParts(req).some((p) => p.functionResponse);
/** The function names a request offers the model. */
export const offered = (req: LlmRequest) =>
  (req.config?.tools ?? [])
    .flatMap((t) => ("functionDeclarations" in t ? (t.functionDeclarations ?? []) : []))
    .map((d) => d.name);

export const userText = (text: string): Content => ({ role: "user", parts: [{ text }] });

/** Run one turn and collect its events. */
export async function turn(runner: Runner, sessionId: string, message: string | Content, userId = "u1") {
  const events: Event[] = [];
  for await (const e of runner.runAsync({
    userId,
    sessionId,
    newMessage: typeof message === "string" ? userText(message) : message,
  })) {
    events.push(e);
  }
  return events;
}

/** The text of every event's content, joined. */
export const texts = (events: Event[]) =>
  events.flatMap((e) => e.content?.parts ?? []).flatMap((p) => (p.text ? [p.text] : []));
/** Function calls in the events, by name. */
export const calls = (events: Event[]) =>
  events.flatMap((e) => e.content?.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
/** Function responses in the events. */
export const responses = (events: Event[]) =>
  events.flatMap((e) => e.content?.parts ?? []).flatMap((p) => (p.functionResponse ? [p.functionResponse] : []));
