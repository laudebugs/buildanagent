// The same model binding as make-model.ts, with the gateway's OpenAI adapter in place of the Anthropic one.
import { createModel, type Model } from "@buildanagent/gateway";
import { openaiChat } from "@buildanagent/gateway/openai-chat";

// #region model
/** Binds the OpenAI adapter, made with a key from your secret store, to one model id. */
export function makeOpenAiModel(apiKey: string): Model {
  return createModel({ adapter: openaiChat({ apiKey }), id: "gpt-5.4-mini" });
}
// #endregion
