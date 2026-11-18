// Preloaded with `node --import` so unmodified doc examples run offline:
//   - @ai-sdk/openai and @ai-sdk/anthropic resolve to shims that hand out mock models;
//   - string model ids ('openai/gpt-5') resolve through a mock default provider instead of the
//     AI Gateway;
//   - any non-local fetch is rejected.
import { writeFileSync } from "node:fs";
import { register } from "node:module";
import { mockModel, stats } from "./mock-model.mjs";

register(new URL("./hooks.mjs", import.meta.url));

globalThis.AI_SDK_DEFAULT_PROVIDER = {
  specificationVersion: "v4",
  languageModel: (id) => mockModel(id),
  textEmbeddingModel: () => {
    throw new Error("verify harness: embedding models are not mocked");
  },
  imageModel: () => {
    throw new Error("verify harness: image models are not mocked");
  },
};

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    return Promise.reject(new Error(`verify harness: network disabled (blocked ${url.hostname})`));
  }
  return realFetch(input, init);
};

if (process.env.MOCK_LOG) process.on("exit", () => writeFileSync(process.env.MOCK_LOG, String(stats.calls)));
