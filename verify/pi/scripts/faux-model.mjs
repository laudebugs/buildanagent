// A scripted model for Pi built on pi-ai's first-party fauxProvider().
// Behaviour per request (mirrors verify/claude-agent-sdk/scripts/mock-anthropic.mjs):
//   1. After a tool result -> answer with text.
//   2. Else, if a custom (non built-in) tool is declared -> call it once with schema-synthesised args,
//      preferring a tool whose name appears in the conversation.
//   3. Else, if `read` is declared and FAUX_READ_FILE is set -> read that file (read-only, temp cwd).
//   4. Else -> plain text.
// It never calls bash, edit or write, so running docs code cannot change the host.
// Tool declarations reach providers inside the transcript's system messages (`toolsAdded`).
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";

const BUILTINS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);
const NEVER = new Set(["bash", "edit", "write"]);

export function synth(schema = {}, depth = 0) {
  if (depth > 6) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.anyOf || schema.oneOf) return synth((schema.anyOf ?? schema.oneOf)[0], depth + 1);
  const t = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (t) {
    case "string":
      return schema.format === "email" ? "user@example.com" : "example";
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return true;
    case "array":
      return [synth(schema.items ?? {}, depth + 1)];
    default: {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = synth(v, depth + 1);
      return out;
    }
  }
}

/** Tools currently declared to the model: replay toolsAdded/toolsRemoved across system messages. */
export function declaredTools(messages) {
  const tools = new Map();
  for (const m of messages) {
    if (m.role !== "system") continue;
    for (const t of m.toolsAdded ?? []) tools.set(t.name, t);
    for (const r of m.toolsRemoved ?? []) tools.delete(typeof r === "string" ? r : r.name);
  }
  return [...tools.values()];
}

export function respond(ctx) {
  const msgs = ctx.messages;
  const last = msgs.at(-1);
  if (last?.role === "toolResult")
    return fauxAssistantMessage(fauxText("Faux model: received the tool result, task complete."));
  const called = new Set(
    msgs
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.content)
      .filter((b) => b.type === "toolCall")
      .map((b) => b.name),
  );
  const tools = declaredTools(msgs).filter((t) => !NEVER.has(t.name));
  const convo = JSON.stringify(msgs.filter((m) => m.role === "user"));
  const customs = tools.filter((t) => !BUILTINS.has(t.name) && !called.has(t.name));
  const custom = customs.find((t) => convo.includes(t.name)) ?? customs[0];
  if (custom && called.size === 0) {
    return fauxAssistantMessage([fauxToolCall(custom.name, synth(custom.parameters))], { stopReason: "toolUse" });
  }
  if (process.env.FAUX_READ_FILE && tools.some((t) => t.name === "read") && called.size === 0) {
    return fauxAssistantMessage([fauxToolCall("read", { path: process.env.FAUX_READ_FILE })], {
      stopReason: "toolUse",
    });
  }
  return fauxAssistantMessage(fauxText("Faux model: hello from the offline model."));
}

/** A faux provider that answers every request with respond(). */
export function createFauxModel(options = {}) {
  const faux = fauxProvider(options);
  const refill = () => faux.setResponses(Array.from({ length: 200 }, () => respond));
  refill();
  return { ...faux, refill };
}
