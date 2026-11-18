// A request-aware scripted chat model for LangChain doc examples, built on BaseChatModel.
// Behaviour per call (mirrors the other harnesses):
//   1. If a structured-output tool (createAgent's "extract-N", or the only tool bound by
//      withStructuredOutput) is offered and the last message is a tool result, or no other tool
//      is offered -> call it with arguments synthesised from its JSON Schema.
//   2. Else, after a tool result -> answer with text.
//   3. Else, if a function tool is offered and none has been called -> call one, preferring a tool
//      the prompt names.
//   4. Else -> answer with text.
// Tools whose names suggest host access (bash, shell, exec, write, edit, delete, …) are denied.
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage } from "@langchain/core/messages";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";

const HOST_TOOL =
  /bash|shell|exec|command|terminal|write|edit|delete|remove|apply_patch|computer|sandbox|file_?system/i;

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

export const stats = { calls: 0 };
let seq = 0;
const kind = (m) => m._getType?.() ?? m.type;

export class ScriptedChatModel extends BaseChatModel {
  constructor(fields = {}) {
    super(fields);
    this.fields = fields;
    this.boundTools = fields.boundTools ?? [];
  }
  _llmType() {
    return "scripted";
  }
  bindTools(tools, kwargs = {}) {
    const specs = tools.map((t) => (t?.type === "function" && t.function ? t : convertToOpenAITool(t)));
    return new this.constructor({ ...this.fields, boundTools: specs, boundKwargs: kwargs });
  }
  async _generate(messages, options = {}) {
    stats.calls++;
    const tools = this.boundTools.map((t) => t.function).filter((f) => f && !HOST_TOOL.test(f.name));
    const last = messages.at(-1);
    const afterTool = last && kind(last) === "tool";
    const called = messages.some((m) => kind(m) === "ai" && m.tool_calls?.length);
    const extract = tools.find((f) => f.name.startsWith("extract-"));
    const others = tools.filter((f) => f !== extract);
    const said = messages
      .filter((m) => kind(m) === "human")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");
    const call = (f) =>
      new AIMessage({
        content: "",
        tool_calls: [{ id: `call_${++seq}`, name: f.name, args: synth(f.parameters), type: "tool_call" }],
      });
    // providerStrategy asks for native JSON through response_format: answer with schema-shaped JSON.
    const jsonSchema = (options.response_format ?? this.fields.boundKwargs?.response_format)?.json_schema?.schema;
    let message;
    if (jsonSchema && (afterTool || others.length === 0)) message = new AIMessage(JSON.stringify(synth(jsonSchema)));
    else if (extract && (afterTool || others.length === 0)) message = call(extract);
    else if (afterTool || called || others.length === 0)
      message = new AIMessage("Scripted model: hello from the offline model.");
    else message = call(others.find((f) => said.includes(f.name)) ?? others[0]);
    return { generations: [{ text: typeof message.content === "string" ? message.content : "", message }] };
  }
}
