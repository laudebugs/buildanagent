// Stands in for @ai-sdk/openai during doc-example runs: same exports, mock language models.
import * as real from "@ai-sdk/openai";
import { mockProvider } from "../scripts/mock-model.mjs";

export * from "@ai-sdk/openai";
export const openai = mockProvider(real.openai, "openai");
export const createOpenAI = (...args) => mockProvider(real.createOpenAI(...args), "openai");
