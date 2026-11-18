// Preloaded with `node --import` so unmodified doc examples run offline:
// every ModelRuntime gets the faux provider, and model lookups resolve to the faux model.
// Pair with a temp PI_CODING_AGENT_DIR whose settings.json selects provider "faux".
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { createFauxModel } from "./faux-model.mjs";

// Network guard: examples must never reach a real provider. Local addresses stay allowed.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return Promise.reject(new Error(`verify harness: network disabled (blocked ${url.hostname})`));
  }
  return realFetch(input, init);
};

const faux = createFauxModel();
globalThis.__faux = faux;
const create = ModelRuntime.create.bind(ModelRuntime);
ModelRuntime.create = async (options = {}) => {
  const runtime = await create({ ...options, allowModelNetwork: false });
  runtime.registerNativeProvider(faux.provider);
  // Mark faux as configured so settings.defaultProvider "faux" is honoured at startup.
  await runtime.setRuntimeApiKey(faux.provider.id, "faux-key");
  const getModel = runtime.getModel.bind(runtime);
  // Docs pick real models (e.g. anthropic/claude-opus-4-5); substitute the faux model, as the
  // Claude harness substitutes ANTHROPIC_BASE_URL.
  runtime.getModel = (provider, id) => (provider === faux.provider.id ? getModel(provider, id) : faux.getModel());
  return runtime;
};
