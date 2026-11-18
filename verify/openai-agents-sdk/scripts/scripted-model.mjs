// A request-aware model for the OpenAI Agents SDK, built on its first-party ScriptedModel.
// Behaviour per request (mirrors the Claude and Pi harnesses):
//   1. After a function-call result -> answer (schema-shaped JSON when an output type is set).
//   2. Else, if a function tool is offered and none has been called -> call one with arguments
//      synthesised from its JSON Schema, preferring a tool the input names.
//   3. Else -> answer.
// Only function tools are ever called; hosted, computer, shell and apply-patch tools never are.
// Sandbox agents expose their capabilities as *function* tools (exec_command, write_stdin, …),
// so those are denied by name. Running docs code therefore cannot change the host.
import { assistantMessage, functionCall, modelResponder, ScriptedModel } from "@openai/agents/testing";

export function synth(schema = {}, depth = 0) {
  if (depth > 6) return null;
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.anyOf || schema.oneOf) return synth((schema.anyOf ?? schema.oneOf)[0], depth + 1);
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== "null") : schema.type;
  switch (t) {
    case "string":
      return schema.format === "email" ? "user@example.com" : "example";
    case "number":
    case "integer":
      return schema.minimum ?? 1;
    case "boolean":
      return false;
    case "array":
      return [synth(schema.items ?? {}, depth + 1)];
    default: {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {})) out[k] = synth(v, depth + 1);
      return out;
    }
  }
}

// Sandbox capability tools from @openai/agents-core/dist/sandbox (0.21.0).
const NEVER = new Set(["exec_command", "write_stdin", "apply_patch", "view_image", "load_skill"]);

const answer = (request) =>
  request.outputType && request.outputType !== "text"
    ? assistantMessage(JSON.stringify(synth(request.outputType.schema)))
    : assistantMessage("Scripted model: hello from the offline model.");

let seq = 0;
export function respond({ request }) {
  const items = Array.isArray(request.input) ? request.input : [];
  if (items.at(-1)?.type === "function_call_result") return [answer(request)];
  const called = items.some((i) => i.type === "function_call");
  const tools = (request.tools ?? []).filter((t) => t.type === "function" && !NEVER.has(t.name));
  const text = JSON.stringify(
    typeof request.input === "string" ? request.input : items.filter((i) => i.role === "user"),
  );
  const tool = tools.find((t) => text.includes(t.name)) ?? tools[0];
  if (tool && !called) {
    return [functionCall(tool.name, synth(tool.parameters), { callId: `call_scripted_${++seq}` })];
  }
  return [answer(request)];
}

/** A ScriptedModel that answers every request with respond(). */
// ScriptedModel copies its steps into an array, so the script must be finite; 500 steps is far
// more than any example uses.
export function createScriptedModel(steps = 500) {
  return new ScriptedModel(Array.from({ length: steps }, () => modelResponder(respond)));
}

/** A ModelProvider that hands the same scripted model to every model name. */
export function createScriptedProvider() {
  const model = createScriptedModel();
  return { model, getModel: async () => model };
}
