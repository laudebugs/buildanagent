// The AI SDK harness's live mode (scripts/live/). Only scripts/live/run.mjs turns it on; otherwise `live` is undefined
// and scripted() in check.ts plays its script. In a live run, scripted() returns a MockLanguageModelV4 whose calls go
// to the real provider through the pinned @ai-sdk/anthropic or @ai-sdk/openai, so the example, its requests list and
// the transcript recorder (transcript.ts) work as they do against the script.
//
// Each call passes the key explicitly, caps the output at the run's maxTokens, refuses provider-defined tools, which
// can reach the host, and runs under the cost guard. The answer keeps only its content, finish reason, usage and
// warnings, and a stream drops its response metadata and raw chunks, so the response's headers, body and ids, which
// name the request and the account, go no further.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4StreamPart,
  LanguageModelV4Usage,
} from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import type { TokenUsage } from "../../../../scripts/live/budget.ts";
import {
  beginCall,
  denyHostTools,
  guardedCall,
  guardStream,
  type LiveConfig,
  live,
} from "../../../../scripts/live/live.ts";

export { live };

function providerModel(config: LiveConfig): LanguageModelV4 {
  const baseURL = config.baseURL === undefined ? undefined : `${config.baseURL}/v1`;
  return config.provider === "anthropic"
    ? createAnthropic({ apiKey: config.apiKey, baseURL })(config.model)
    : createOpenAI({ apiKey: config.apiKey, baseURL })(config.model);
}

/** The AI SDK's usage in the cost guard's token classes. */
function tokensOf(usage: LanguageModelV4Usage | undefined): TokenUsage | undefined {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens.total;
  if (input?.total === undefined || output === undefined) return undefined;
  const cacheRead = input.cacheRead ?? 0;
  const cacheWrite = input.cacheWrite ?? 0;
  return { uncachedInput: input.noCache ?? input.total - cacheRead - cacheWrite, cacheRead, cacheWrite, output };
}

/** The request as the run sends it: host tools refused and the output capped at the run's allowance. */
function prepared(config: LiveConfig, options: LanguageModelV4CallOptions): LanguageModelV4CallOptions {
  denyHostTools((options.tools ?? []).map((tool) => ({ name: tool.name, type: tool.type })));
  const maxOutputTokens = Math.min(options.maxOutputTokens ?? config.maxTokens, config.maxTokens);
  return { ...options, maxOutputTokens };
}

/** What the request's size is judged on: the prompt and tools, without the abort signal. */
const sized = (options: LanguageModelV4CallOptions) => ({ prompt: options.prompt, tools: options.tools });

/**
 * A model that sends each call to the live provider and records each request in `requests`, as scripted() does.
 * Streamed answers pass through as the provider sends them, and the cost guard settles however the stream ends.
 */
export function liveModel(config: LiveConfig, requests: LanguageModelV4CallOptions[]): MockLanguageModelV4 {
  const real = providerModel(config);
  return new MockLanguageModelV4({
    provider: "live",
    modelId: config.model,
    doGenerate: async (options) => {
      requests.push(options);
      const sent = prepared(config, options);
      const result = await guardedCall(
        config,
        sized(sent),
        async () => real.doGenerate(sent),
        (r) => tokensOf(r.usage),
      );
      return {
        content: result.content,
        finishReason: result.finishReason,
        usage: result.usage,
        warnings: result.warnings,
      };
    },
    doStream: async (options) => {
      requests.push(options);
      const sent = prepared(config, options);
      const guard = beginCall(config, sized(sent));
      let result: Awaited<ReturnType<LanguageModelV4["doStream"]>>;
      try {
        result = await real.doStream(sent);
      } catch (error) {
        guard.settle(undefined);
        throw error;
      }
      // The metadata and raw chunks name the response and the request, so they go no further.
      const kept = result.stream.pipeThrough(
        new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type !== "response-metadata" && part.type !== "raw") controller.enqueue(part);
          },
        }),
      );
      // The guard settles when the stream finishes, fails or is cancelled (live.ts).
      return {
        stream: guardStream(
          kept,
          guard,
          (part) => (part.type === "finish" ? tokensOf(part.usage) : undefined),
          (part) => part.type === "finish",
        ),
      };
    },
  });
}
