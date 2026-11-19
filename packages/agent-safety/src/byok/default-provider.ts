/**
 * `assertNoDefaultProvider()`: makes a string model id fail. In `ai` 7.0.162, `generateText`, `streamText` and the
 * other calls resolve a string model id through `globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway`, and the gateway is
 * Vercel AI Gateway, which authenticates with `AI_GATEWAY_API_KEY` or a Vercel OIDC token from the environment. Setting
 * the global to a provider that refuses every model closes that path before any request is built.
 */
import { SafetyError } from "../errors.js";

// A registered symbol, so a second copy of the package recognises the refusing provider as its own.
const REFUSING_PROVIDER = Symbol.for("buildanagent.agent-safety.RefusingDefaultProvider");

// Every model factory `ai` 7.0.162 looks up on the default provider, in resolve-model.ts and batch.ts.
const MODEL_FACTORIES = [
  "languageModel",
  "embeddingModel",
  "imageModel",
  "transcriptionModel",
  "speechModel",
  "rerankingModel",
  "videoModel",
  "speechTranslationModel",
  "decisionModel",
  "evaluationModel",
  "experimental_batch",
] as const;

type DefaultProviderGlobal = { AI_SDK_DEFAULT_PROVIDER?: unknown };

function refusal(kind: string, modelId: unknown): SafetyError {
  const id = typeof modelId === "string" ? ` "${modelId}"` : "";
  return new SafetyError(
    "default_provider",
    `A string model id${id} was resolved for a ${kind}; string ids route through a default provider, which may use a credential nobody configured. Pass a model built with explicitProvider() instead.`,
  );
}

function refusingProvider(): object {
  const provider: Record<string | symbol, unknown> = { specificationVersion: "v4" };
  for (const kind of MODEL_FACTORIES) {
    provider[kind] = (modelId: unknown) => {
      throw refusal(kind, modelId);
    };
  }
  Object.defineProperty(provider, REFUSING_PROVIDER, { value: true });
  return Object.freeze(provider);
}

function isRefusingProvider(value: unknown): boolean {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[REFUSING_PROVIDER] === true;
}

/**
 * Makes every string model id fail with a `SafetyError`, code `default_provider`, before any request. It sets the AI
 * SDK's `globalThis.AI_SDK_DEFAULT_PROVIDER` to a provider whose model factories all throw, so a string id can never
 * fall through to Vercel AI Gateway and an ambient gateway key or OIDC token. Call it once at startup, before the
 * agent's first model call. Calling it again does nothing. The global is left read-only, so later code that assigns
 * another default provider throws a `TypeError` in strict mode rather than reopening the path.
 *
 * Throws a `SafetyError`, code `default_provider`, when another default provider is already set, because string ids
 * would then reach a provider whose credentials this package can't see. Clear that setting and pass models built with
 * `explicitProvider()` instead.
 */
export function assertNoDefaultProvider(): void {
  const global = globalThis as DefaultProviderGlobal;
  const current = global.AI_SDK_DEFAULT_PROVIDER;
  if (isRefusingProvider(current)) return;
  // `ai` reads the global with `??`, so null means "unset" there too and falls through to Vercel AI Gateway.
  if (current !== undefined && current !== null) {
    throw new SafetyError(
      "default_provider",
      "globalThis.AI_SDK_DEFAULT_PROVIDER is already set, so string model ids would reach a provider whose credential nobody checked. Remove it and pass models built with explicitProvider().",
    );
  }
  // Read-only, so a later plain assignment throws in strict code instead of quietly reopening the path. It stays
  // configurable, so a test can delete it.
  Object.defineProperty(global, "AI_SDK_DEFAULT_PROVIDER", {
    value: refusingProvider(),
    writable: false,
    enumerable: true,
    configurable: true,
  });
}
