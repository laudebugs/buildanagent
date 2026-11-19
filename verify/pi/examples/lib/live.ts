// Pi's live mode (scripts/live/). Only scripts/live/run.mjs turns it on; otherwise fauxSession() in faux.ts plays its
// scripted steps. In a live run, fauxSession() keeps the faux provider but gives it steps that each send the request
// to the real provider through pi-ai's own Anthropic Messages or OpenAI Responses API, so the session, the faux
// provider's call count and the transcript recorder (transcript.ts) work as they do against the script.
//
// Each call passes the key explicitly, caps the output at the run's maxTokens, refuses a request that offers one of
// Pi's built-in tools, which read, write and run commands on the host, and runs under the cost guard. The answer keeps
// only its content, stop reason and usage, without the provider's response id.
import type { AssistantMessage, FauxResponseStep, Model, Message as PiMessage } from "@earendil-works/pi-ai";
import { streamSimple as streamAnthropic } from "@earendil-works/pi-ai/api/anthropic-messages";
import { streamSimple as streamOpenAI } from "@earendil-works/pi-ai/api/openai-responses";
import { denyHostTools, guardedCall, type LiveConfig, live } from "../../../../scripts/live/live.ts";

export { live };

/** The most calls one live session may make; the cost guard stops a run well before this matters. */
const MAX_LIVE_STEPS = 24;

function providerModel(config: LiveConfig): Model<"anthropic-messages"> | Model<"openai-responses"> {
  const common = {
    id: config.model,
    name: config.model,
    input: ["text" as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: config.maxTokens,
  };
  return config.provider === "anthropic"
    ? {
        ...common,
        api: "anthropic-messages",
        provider: "anthropic",
        baseUrl: config.baseURL ?? "https://api.anthropic.com",
        reasoning: false,
      }
    : {
        ...common,
        api: "openai-responses",
        provider: "openai",
        baseUrl: config.baseURL === undefined ? "https://api.openai.com/v1" : `${config.baseURL}/v1`,
        reasoning: true,
      };
}

/** The tools a request offers: those its system messages add, by name. */
const toolNames = (messages: readonly PiMessage[]): string[] =>
  messages.flatMap((message) => (message.role === "system" ? (message.toolsAdded ?? []).map((tool) => tool.name) : []));

/** Faux steps that each answer with the live provider's message. */
export function liveSteps(config: LiveConfig): FauxResponseStep[] {
  const model = providerModel(config);
  const step: FauxResponseStep = async (context, options) => {
    denyHostTools(toolNames(context.messages).map((name) => ({ name })));
    const sent = { ...options, apiKey: config.apiKey, maxTokens: config.maxTokens };
    const answer: AssistantMessage = await guardedCall(
      config,
      context.messages,
      () =>
        model.api === "anthropic-messages"
          ? streamAnthropic(model, context, sent).result()
          : streamOpenAI(model as Model<"openai-responses">, context, sent).result(),
      (result) => ({
        uncachedInput: result.usage.input,
        output: result.usage.output,
        cacheRead: result.usage.cacheRead,
        cacheWrite: result.usage.cacheWrite,
      }),
    );
    const { responseId: _id, ...kept } = answer;
    return kept;
  };
  return Array.from({ length: MAX_LIVE_STEPS }, () => step);
}
