// Preloaded with `node --import` so unmodified ADK doc examples run offline:
//   - every model id resolves to the scripted BaseLlm: it is registered with LLMRegistry under the same
//     pattern objects Gemini, ApigeeLlm and ChromeBuiltInLlm use (which replaces their entries), plus a
//     catch-all; and `new Gemini(...)`-style instances get the scripted generateContentAsync too;
//   - any non-local fetch, http or https request is rejected;
//   - the number of model calls is written to $MOCK_LOG on exit.
import { writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import { ApigeeLlm, ChromeBuiltInLlm, Gemini, LLMRegistry, LogLevel, setLogLevel } from "@google/adk";
import { respond, ScriptedLlm, stats } from "./scripted-llm.mjs";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const blocked = (host) => new Error(`verify harness: network disabled (blocked ${host})`);

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!LOCAL.has(url.hostname)) return Promise.reject(blocked(url.hostname));
  return realFetch(input, init);
};
for (const mod of [http, https]) {
  for (const fn of ["request", "get"]) {
    const real = mod[fn];
    mod[fn] = (...args) => {
      const a = args[0];
      const host =
        typeof a === "string" || a instanceof URL ? new URL(a).hostname : (a?.hostname ?? a?.host ?? "localhost");
      if (!LOCAL.has(String(host).replace(/:\d+$/, ""))) throw blocked(host);
      return real.apply(mod, args);
    };
  }
}

// ESM imports of node:http(s) read named exports, which only follow the patched default export after a sync.
syncBuiltinESMExports();

// Re-registering logs each replaced class source at INFO; keep that out of the run output.
setLogLevel(LogLevel.WARN);
for (const cls of [Gemini, ApigeeLlm, ChromeBuiltInLlm]) {
  LLMRegistry.register(
    class extends ScriptedLlm {
      static supportedModels = cls.supportedModels;
    },
  );
  cls.prototype.generateContentAsync = async function* (llmRequest) {
    yield respond(llmRequest);
  };
  cls.prototype.connect = async () => {
    throw new Error("verify harness: live (bidi) connections are not mocked");
  };
}
LLMRegistry.register(ScriptedLlm);
setLogLevel(LogLevel.INFO);

if (process.env.MOCK_LOG) process.on("exit", () => writeFileSync(process.env.MOCK_LOG, JSON.stringify(stats)));
