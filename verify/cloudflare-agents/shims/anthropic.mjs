// Stands in for @ai-sdk/anthropic in doc-example bundles: same exports, mock language models.
import * as real from "@ai-sdk/anthropic";
import { mockProvider } from "../scripts/mock-model.mjs";

export * from "@ai-sdk/anthropic";
export const anthropic = mockProvider(real.anthropic, "anthropic");
export const createAnthropic = (...args) => mockProvider(real.createAnthropic(...args), "anthropic");
