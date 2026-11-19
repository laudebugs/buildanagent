// The OpenAI Agents SDK's live mode (scripts/live/). Only scripts/live/run.mjs turns it on, and the harness's runner
// then preloads live-register.mjs, which resolves every import of @openai/agents/testing in examples/ to this file. Its
// ScriptedModel ignores the script and answers each call from the real Responses API through the pinned
// @openai/agents-openai, so the example's `calls`, `firstCall`, `lastCall` and `assertComplete()`, and the transcript
// recorder (transcript.ts), work as they do against the script. Without the preload nothing imports this file.
//
// Each call passes the key explicitly, caps the output at the run's maxTokens, refuses hosted tools such as shell,
// computer use and code interpreter, which can reach the host, and runs under the cost guard. The answer keeps only
// its output and usage, without the response and request ids.
import type { ModelRequest, ModelResponse, StreamEvent } from "@openai/agents";
import { modelResponder, ScriptedModel as Scripted } from "@openai/agents/testing";
import { OpenAIResponsesModel } from "@openai/agents-openai";
import OpenAI from "openai";
import { denyHostTools, guardedCall, type LiveConfig, live } from "../../../../scripts/live/live.ts";

export * from "@openai/agents/testing";

function config(): LiveConfig {
  if (live === undefined) throw new Error("live mode: examples/lib/live.ts loaded without LIVE=1");
  if (live.provider !== "openai") throw new Error("live mode: the OpenAI Agents SDK harness runs on OpenAI only");
  return live;
}

async function liveResponse(request: ModelRequest): Promise<ModelResponse> {
  const settings = config();
  denyHostTools(
    request.tools.map((tool) => ({ name: String((tool as { name?: unknown }).name ?? tool.type), type: tool.type })),
  );
  const client = new OpenAI({
    apiKey: settings.apiKey,
    maxRetries: 0,
    ...(settings.baseURL === undefined ? {} : { baseURL: `${settings.baseURL}/v1` }),
  });
  const real = new OpenAIResponsesModel(client, settings.model);
  const sent: ModelRequest = { ...request, modelSettings: { ...request.modelSettings, maxTokens: settings.maxTokens } };
  const sized = { systemInstructions: request.systemInstructions, input: request.input, tools: request.tools };
  const response = await guardedCall(
    settings,
    sized,
    () => real.getResponse(sent),
    ({ usage }) => {
      // The SDK keeps input token details as one record or a list of them, one per request it merged.
      const details = [usage.inputTokensDetails].flat() as { cached_tokens?: unknown }[];
      const cached = details.reduce((sum, d) => sum + (typeof d?.cached_tokens === "number" ? d.cached_tokens : 0), 0);
      const cacheRead = cached;
      return { uncachedInput: usage.inputTokens - cacheRead, cacheRead, output: usage.outputTokens };
    },
  );
  return { usage: response.usage, output: response.output };
}

/** A ScriptedModel that sends each call to the live provider; the script it is given is never played. */
export class ScriptedModel extends Scripted {
  constructor(_script?: unknown) {
    super([]);
  }

  override getResponse(request: ModelRequest): Promise<ModelResponse> {
    this.enqueue(modelResponder(() => liveResponse(request)));
    return super.getResponse(request);
  }

  override getStreamedResponse(request: ModelRequest): AsyncIterable<StreamEvent> {
    this.enqueue(modelResponder(() => liveResponse(request)));
    return super.getStreamedResponse(request);
  }
}
