/**
 * The OpenTelemetry GenAI names the observer writes, in one place. The GenAI semantic conventions are at Development
 * stability, so a rename upstream is a one-line change here, and the harness's log projection imports the same names.
 */

/**
 * The commit of `open-telemetry/semantic-conventions-genai` whose attribute and span names this module follows. A
 * harness that exports spans can stamp it on its resource, so a reader knows which revision of the conventions the
 * names come from.
 */
export const SEMCONV_GENAI_COMMIT = "d28355d" as const;

/** The `gen_ai.*` and `error.*` attribute names the observer writes, keyed by what each holds. */
export const GEN_AI_ATTRIBUTES = Object.freeze({
  operationName: "gen_ai.operation.name",
  providerName: "gen_ai.provider.name",
  agentName: "gen_ai.agent.name",
  requestModel: "gen_ai.request.model",
  requestMaxTokens: "gen_ai.request.max_tokens",
  requestTemperature: "gen_ai.request.temperature",
  responseModel: "gen_ai.response.model",
  responseFinishReasons: "gen_ai.response.finish_reasons",
  usageInputTokens: "gen_ai.usage.input_tokens",
  usageOutputTokens: "gen_ai.usage.output_tokens",
  usageCacheReadInputTokens: "gen_ai.usage.cache_read.input_tokens",
  usageCacheWriteInputTokens: "gen_ai.usage.cache_write.input_tokens",
  usageReasoningOutputTokens: "gen_ai.usage.reasoning.output_tokens",
  toolName: "gen_ai.tool.name",
  toolType: "gen_ai.tool.type",
  toolCallId: "gen_ai.tool.call.id",
  errorType: "error.type",
  /** Content: written only when `captureContent` is on. */
  systemInstructions: "gen_ai.system_instructions",
  inputMessages: "gen_ai.input.messages",
  outputMessages: "gen_ai.output.messages",
  toolCallArguments: "gen_ai.tool.call.arguments",
  toolCallResult: "gen_ai.tool.call.result",
} as const);

/** The names of the attributes that hold content: what the model and the tools read and wrote. */
export const GEN_AI_CONTENT_ATTRIBUTES: readonly string[] = Object.freeze([
  GEN_AI_ATTRIBUTES.systemInstructions,
  GEN_AI_ATTRIBUTES.inputMessages,
  GEN_AI_ATTRIBUTES.outputMessages,
  GEN_AI_ATTRIBUTES.toolCallArguments,
  GEN_AI_ATTRIBUTES.toolCallResult,
]);

/** The `gen_ai.operation.name` values the observer writes. */
export const GEN_AI_OPERATIONS = Object.freeze({
  invokeAgent: "invoke_agent",
  chat: "chat",
  executeTool: "execute_tool",
} as const);
