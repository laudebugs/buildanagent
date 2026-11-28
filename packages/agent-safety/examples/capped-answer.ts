// A run that can't spend more than 50 cents. The guard projects each model call's cost before it is sent and refuses
// the call that could pass the cap, so the run stops at the cap instead of overshooting it by one call.
import {
  budgetRefusal,
  costGuard,
  type GuardableProvider,
  guardedProvider,
  memorySpend,
} from "@buildanagent/agent-safety/cost";
import { generateText, isStepCount } from "ai";

const CAP_USD = 0.5;
const MAX_STEPS = 20;

// #region answer
/** Answers `prompt` on `modelId` from `provider`, or says why the cap stopped the run. */
export async function cappedAnswer(provider: GuardableProvider, modelId: string, prompt: string): Promise<string> {
  const guard = costGuard({ capUsd: CAP_USD, spend: memorySpend() });
  const models = guardedProvider(provider, guard);
  try {
    const { text } = await generateText({
      model: models.languageModel(modelId),
      prompt,
      stopWhen: isStepCount(MAX_STEPS),
    });
    return text;
  } catch (error) {
    const refused = budgetRefusal(error);
    if (refused === undefined) throw error;
    return `Stopped at the cap of ${refused.capUsd} USD: ${refused.spentUsd} spent, ${refused.projectedUsd} more projected`;
  }
}
// #endregion
