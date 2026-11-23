// A model call that runs on the user's own key and can't spend more than 50 cents of it. The provider is built from the
// key and address the caller passes and never reads a key from the environment, and the guard refuses the call that
// could pass the cap before anything is sent.
import { assertNoDefaultProvider, explicitProvider } from "@buildanagent/agent-safety/byok";
import { budgetRefusal, costGuard, guardedProvider, memorySpend } from "@buildanagent/agent-safety/cost";
import { generateText } from "ai";

const BASE_URL = "https://api.anthropic.com/v1";
const CAP_USD = 0.5;

/**
 * Answers `prompt` on `modelId` with `userKey`, or says why the cap stopped the call. `send` replaces the network
 * fetch; leave it out to call Anthropic.
 */
export async function answerOnUserKey(
  userKey: string,
  modelId: string,
  prompt: string,
  send?: typeof fetch,
): Promise<string> {
  // #region provider
  assertNoDefaultProvider(); // A string model id now throws instead of reaching a key nobody chose.
  const anthropic = explicitProvider({
    provider: "anthropic",
    apiKey: userKey,
    baseURL: BASE_URL,
    ...(send === undefined ? {} : { fetch: send }),
  });
  const models = guardedProvider(anthropic, costGuard({ capUsd: CAP_USD, spend: memorySpend() }));
  // #endregion
  // #region call
  try {
    const { text } = await generateText({ model: models.languageModel(modelId), prompt });
    return text;
  } catch (error) {
    const refused = budgetRefusal(error);
    if (refused === undefined) throw error;
    return `Stopped at the cap of ${refused.capUsd} USD: ${refused.spentUsd} spent, ${refused.projectedUsd} more projected`;
  }
  // #endregion
}
