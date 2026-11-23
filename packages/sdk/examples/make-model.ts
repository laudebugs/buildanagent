// The model the order agent runs on: one of the gateway's adapters, made with your own key, bound to one model id.
import { createModel, type Model } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { openaiChat } from "@buildanagent/gateway/openai-chat";

// #region model
/** Binds the Anthropic adapter, made with a key from your secret store, to one model id. */
export function makeModel(apiKey: string): Model {
  return createModel({ adapter: anthropic({ apiKey }), id: "claude-opus-5-5" });
}
// #endregion

// #region openai
/** Binds the OpenAI adapter, made with a key from your secret store, to one model id. */
export function makeOpenAiModel(apiKey: string): Model {
  return createModel({ adapter: openaiChat({ apiKey }), id: "gpt-5.4-mini" });
}
// #endregion
