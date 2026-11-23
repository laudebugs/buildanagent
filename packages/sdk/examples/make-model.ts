// The model the order agent runs on: the gateway's Anthropic adapter, made with your own key, bound to one model id.
import { createModel, type Model } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";

// #region model
/** Binds the Anthropic adapter, made with a key from your secret store, to one model id. */
export function makeModel(apiKey: string): Model {
  return createModel({ adapter: anthropic({ apiKey }), id: "claude-opus-5-5" });
}
// #endregion
