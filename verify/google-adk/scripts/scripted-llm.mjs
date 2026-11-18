// A request-aware scripted model for ADK doc examples, built on @google/adk's own BaseLlm.
// @google/adk@2.5.0 ships no fake or mock model (its record/replay model lives in the adk-js repo's tests,
// not in the package), so this subclasses BaseLlm, the seam ADK's own tests use.
// Behaviour per call (mirrors the other harnesses):
//   1. If `set_model_response` (ADK's structured-output tool when an agent has tools and an outputSchema)
//      is offered and the last turn is a tool result, or no other tool is offered -> call it with
//      arguments synthesised from its schema.
//   2. Else, after a tool result -> answer with text (schema-shaped JSON when responseSchema is set).
//   3. Else, if a function tool is offered and none has been called since the last user text -> call one,
//      preferring a tool the prompt names.
//   4. Else -> answer with text (schema-shaped JSON when responseSchema is set).
// Tools whose names suggest host, browser or network access are denied by name and never called.
import { BaseLlm } from "@google/adk";

export const HOST_TOOL =
  /bash|shell|exec|command|terminal|write|edit|delete|remove|apply_patch|computer|sandbox|file|script|code|browser|navigate|click|drag|hover|scroll|screenshot|hotkey|key_combination|press_key|type_text|load_web_page|fetch|http|url|download|upload/i;

export function synth(schema = {}, depth = 0) {
  if (!schema || depth > 6) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.example !== undefined) return schema.example;
  if (schema.anyOf || schema.oneOf) return synth((schema.anyOf ?? schema.oneOf)[0], depth + 1);
  const raw = Array.isArray(schema.type) ? schema.type.find((x) => x !== "null") : schema.type;
  switch (String(raw ?? (schema.properties ? "object" : "string")).toLowerCase()) {
    case "string":
      return schema.format === "email"
        ? "user@example.com"
        : schema.format === "date-time"
          ? new Date(0).toISOString()
          : "example";
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return true;
    case "array":
      return [synth(schema.items ?? {}, depth + 1)];
    case "null":
      return null;
    default: {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = synth(v, depth + 1);
      return out;
    }
  }
}

export const stats = { calls: 0, toolCalls: [] };
let seq = 0;

const textOf = (c) => (c?.parts ?? []).map((p) => p.text ?? "").join("");
const declarations = (req) =>
  (req.config?.tools ?? []).flatMap((t) => t.functionDeclarations ?? []).filter((d) => d?.name);

/** The scripted response for one request. Exported so our tests can reuse it. */
export function respond(req) {
  stats.calls++;
  const contents = req.contents ?? [];
  const last = contents.at(-1);
  const afterTool = (last?.parts ?? []).some((p) => p.functionResponse);
  // Function calls the model made since the last plain user text.
  const lastUserText = contents.findLastIndex((c) => c.role === "user" && c.parts?.some((p) => p.text));
  const calledSinceUser = contents.slice(lastUserText + 1).some((c) => c.parts?.some((p) => p.functionCall));
  // ADK hands another agent's tool calls to the next agent as "For context:" user text, so a transfer is
  // visible only as text there. Transfer at most once per history, or two agents bounce forever.
  const transferred = JSON.stringify(contents).includes("transfer_to_agent");
  const decls = declarations(req).filter(
    (d) => !HOST_TOOL.test(d.name) && !(transferred && d.name === "transfer_to_agent"),
  );
  const setResponse = decls.find((d) => d.name === "set_model_response");
  const others = decls.filter((d) => d !== setResponse);
  const said = contents
    .filter((c) => c.role === "user")
    .map(textOf)
    .join("\n");
  const call = (d) => {
    const args = synth(d.parametersJsonSchema ?? d.parameters ?? {}) ?? {};
    stats.toolCalls.push(d.name);
    return {
      content: { role: "model", parts: [{ functionCall: { id: `adk-scripted-${++seq}`, name: d.name, args } }] },
    };
  };
  const answer = () => {
    const schema = req.config?.responseJsonSchema ?? req.config?.responseSchema;
    const text = schema ? JSON.stringify(synth(schema)) : "Scripted model: hello from the offline model.";
    return { content: { role: "model", parts: [{ text }] }, turnComplete: true };
  };
  if (setResponse && (afterTool || others.length === 0)) return call(setResponse);
  if (afterTool || calledSinceUser || others.length === 0) return answer();
  return call(others.find((d) => said.includes(d.name)) ?? others[0]);
}

export class ScriptedLlm extends BaseLlm {
  // Catch-all: the preload also re-registers it for the Gemini, Apigee and Chrome patterns.
  static supportedModels = [/.*/];
  async *generateContentAsync(llmRequest) {
    yield respond(llmRequest);
  }
  async connect() {
    throw new Error("verify harness: live (bidi) connections are not mocked");
  }
}
