// Model calls that run on one user's own key and can't spend more than 50 cents of it in all. The provider is built from
// the key and address the caller passes and never reads a key from the environment. The guard and its spend live as
// long as the answerer does, so every call on the key counts against the one cap, and the guard refuses the call that
// could pass the cap before anything is sent.
import { assertNoDefaultProvider, explicitProvider } from "@buildanagent/agent-safety/byok";
import { budgetRefusal, costGuard, guardedProvider, memorySpend } from "@buildanagent/agent-safety/cost";
import { generateText } from "ai";

const BASE_URL = "https://api.anthropic.com/v1";
const CAP_USD = 0.5;

// #region provider
// Once, at startup: from here a string model id throws instead of reaching a key nobody chose.
assertNoDefaultProvider();

/**
 * Builds the answerer for one user's key. Make it once per key and keep it, because its spend is what the cap counts.
 * `send` replaces the network fetch; leave it out to call Anthropic.
 */
export function answererForKey(userKey: string, send?: typeof fetch) {
  const anthropic = explicitProvider({
    provider: "anthropic",
    apiKey: userKey,
    baseURL: BASE_URL,
    ...(send === undefined ? {} : { fetch: send }),
  });
  const models = guardedProvider(anthropic, costGuard({ capUsd: CAP_USD, spend: memorySpend() }));
  // #endregion
  // #region call
  /** Answers `prompt` on `modelId`, or says why the cap stopped the call. */
  return async function answer(modelId: string, prompt: string): Promise<string> {
    try {
      const { text } = await generateText({ model: models.languageModel(modelId), prompt });
      return text;
    } catch (error) {
      const refused = budgetRefusal(error);
      if (refused === undefined) throw error;
      return `Stopped at the cap of ${refused.capUsd} USD: ${refused.spentUsd} spent, ${refused.projectedUsd} more projected`;
    }
  };
  // #endregion
}
