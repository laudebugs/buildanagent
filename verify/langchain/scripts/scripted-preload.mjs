// Preloaded with `node --import` so unmodified doc examples run offline:
//   - @langchain/anthropic and @langchain/openai resolve to shims whose chat models are scripted,
//     which also covers string model ids that initChatModel resolves by importing those packages;
//   - any non-local fetch is rejected;
//   - the number of model calls is written to $MOCK_LOG on exit.
import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { stats } from "./scripted-model.mjs";

register(new URL("./hooks.mjs", import.meta.url));

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return Promise.reject(new Error(`verify harness: network disabled (blocked ${url.hostname})`));
  }
  return realFetch(input, init);
};

if (process.env.MOCK_LOG) process.on("exit", () => writeFileSync(process.env.MOCK_LOG, String(stats.calls)));
