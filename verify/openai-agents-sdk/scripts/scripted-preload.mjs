// Preloaded with `node --import` so unmodified doc examples run offline:
//   - after @openai/agents installs its OpenAI provider, replace it with a scripted one;
//   - reject any non-local fetch, so no example can reach a real API;
//   - tracing is disabled through OPENAI_AGENTS_DISABLE_TRACING in the runner's environment.
import "@openai/agents";
import { writeFileSync } from "node:fs";
import { setDefaultModelProvider } from "@openai/agents-core";
import { createScriptedProvider } from "./scripted-model.mjs";

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return Promise.reject(new Error(`verify harness: network disabled (blocked ${url.hostname})`));
  }
  return realFetch(input, init);
};

const provider = createScriptedProvider();
setDefaultModelProvider(provider);

// Record how many model calls the run made, for the runner's report.
if (process.env.SCRIPTED_LOG) {
  process.on("exit", () => writeFileSync(process.env.SCRIPTED_LOG, String(provider.model.calls.length)));
}
