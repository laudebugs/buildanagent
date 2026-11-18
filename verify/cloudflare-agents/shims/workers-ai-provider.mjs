// Stands in for workers-ai-provider in doc-example bundles: createWorkersAI ignores its binding and
// hands out mock language models, so no request reaches Workers AI.
import { mockProvider } from "../scripts/mock-model.mjs";

export * from "workers-ai-provider";
export const createWorkersAI = () => mockProvider(null, "workers-ai");
