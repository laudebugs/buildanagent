// Stands in for agents/models/ai-sdk in doc-example bundles: createAI ignores its binding and
// credentials and hands out mock language models, so no request reaches Workers AI or AI Gateway.
import { mockProvider } from "../scripts/mock-model.mjs";

export * from "agents/models/ai-sdk";
export const createAI = () => mockProvider(null, "cloudflare");
