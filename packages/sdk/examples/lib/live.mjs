// Our SDK's live mode (scripts/live/). Only scripts/live/run.mjs turns it on, through this package's
// scripts/run-examples.mjs; otherwise `live` is undefined and scripted() in check.ts plays its script. In a live run,
// scripted() builds its model on our gateway's real adapter for the run's provider instead, so the example and the
// transcript recorder work as they do against the script.
//
// check.ts imports this file before the offline setup, so the file keeps the process's own fetch before the setup
// replaces it with one that reaches only the loopback interface. Only the transport below uses that fetch, and only for
// the run's provider endpoint; every other fetch in the process stays behind the setup's guard, which also still fails
// on a provider key variable. The live mode turns on one thing the setup turns off, real model requests, when
// liveAdapter() is called.
//
// The adapter receives the key explicitly, from the file scripts/live/live.ts read and deleted, and sends HTTP only
// through `ProviderConfig.transport`, the gateway's own seam. Before each request leaves, the transport refuses a host
// tool, a model other than the run's and an output allowance above the run's maxTokens, and checks the call against the
// cost guard. It settles the guard from the usage the answer streams, or at the call's projection when the answer
// fails, stops early or reports none. The answer reaches the adapter with only its status, content type and body, so
// the provider's headers, which name the account and the request, go no further.
import { createModel } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { openaiChat } from "@buildanagent/gateway/openai-chat";
import { allowModelRequests } from "@buildanagent/gateway/testing";
import { beginCall, denyHostTools, guardStream, live } from "../../../../scripts/live/live.ts";

// Kept before the offline setup replaces it (see above).
const fetchOutside = globalThis.fetch;

/** Each provider's fixed endpoint, and the tool types that are plain functions the example's process runs. */
const PROVIDERS = {
  anthropic: { base: "https://api.anthropic.com", path: "/v1/messages", functionTypes: ["custom"] },
  openai: { base: "https://api.openai.com/v1", path: "/chat/completions", functionTypes: ["function"] },
};

/** The run's provider and model, without the key, or undefined when the example runs against its script. */
export const liveRun = live === undefined ? undefined : { provider: live.provider, model: live.model };

/** The base URL the adapter is given: the provider's own, or the loopback stub a test names. */
function baseURLOf(config) {
  if (config.baseURL === undefined) return PROVIDERS[config.provider].base;
  return config.provider === "openai" ? `${config.baseURL}/v1` : config.baseURL;
}

/** The problem with a request body, or undefined when the transport may send it. */
export function requestProblem(config, body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "the request body is not a JSON object";
  if (body.model !== config.model) return `the request names the model ${JSON.stringify(body.model)}`;
  const limit = config.provider === "anthropic" ? body.max_tokens : (body.max_completion_tokens ?? body.max_tokens);
  if (!Number.isInteger(limit) || limit > config.maxTokens) {
    return `the request allows ${limit} output tokens, not at most the run's ${config.maxTokens}`;
  }
  const tools = body.tools ?? [];
  if (!Array.isArray(tools)) return "the request's tools are not a list";
  try {
    denyHostTools(
      tools.map((tool) => ({ name: String(tool?.name ?? tool?.function?.name ?? ""), type: tool?.type })),
      PROVIDERS[config.provider].functionTypes,
    );
  } catch (error) {
    return error.message.replace(/^live mode: /, "");
  }
  return undefined;
}

/** The `data:` payloads of the complete server-sent events in `text`, and the unfinished rest. */
function events(text) {
  const blocks = text.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  const payloads = blocks.flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "" || data === "[DONE]") return [];
    try {
      return [JSON.parse(data)];
    } catch {
      return [];
    }
  });
  return { payloads, rest };
}

/**
 * Reads the usage an answer streams, chunk by chunk, in the cost guard's token classes. Anthropic counts cache reads
 * and writes apart from `input_tokens`; OpenAI's `prompt_tokens` includes its cached tokens.
 */
export function usageReader(provider) {
  const decoder = new TextDecoder();
  const reader = USAGE[provider];
  let buffer = "";
  let counts = {};
  return (chunk) => {
    buffer += decoder.decode(chunk, { stream: true });
    const { payloads, rest } = events(buffer);
    buffer = rest;
    for (const event of payloads) counts = reader.merge(counts, event);
    return reader.usage(counts);
  };
}

const isObject = (value) => value !== null && typeof value === "object";

/** How each provider streams its usage: the counts one event adds, and those counts in the guard's token classes. */
const USAGE = {
  // message_start carries the input counts and message_delta the output, which grows to its total.
  anthropic: {
    merge: (counts, event) => {
      const usage = event.type === "message_start" ? event.message?.usage : event.usage;
      return isObject(usage) ? { ...counts, ...usage } : counts;
    },
    usage: (counts) =>
      typeof counts.output_tokens !== "number"
        ? undefined
        : {
            uncachedInput: counts.input_tokens ?? 0,
            cacheRead: counts.cache_read_input_tokens ?? 0,
            cacheWrite: counts.cache_creation_input_tokens ?? 0,
            output: counts.output_tokens,
          },
  },
  // One last chunk, with empty choices, carries the whole usage when the request asks for it.
  openai: {
    merge: (counts, event) => (isObject(event.usage) ? event.usage : counts),
    usage: (counts) => {
      if (typeof counts.completion_tokens !== "number") return undefined;
      const cached = counts.prompt_tokens_details?.cached_tokens ?? 0;
      return {
        uncachedInput: (counts.prompt_tokens ?? 0) - cached,
        cacheRead: cached,
        output: counts.completion_tokens,
      };
    },
  },
};

/** The transport the adapter sends through: the run's provider endpoint only, each request under the cost guard. */
export function liveTransport(config, send = fetchOutside) {
  const endpoint = `${baseURLOf(config)}${PROVIDERS[config.provider].path}`;
  return async (request) => {
    if (request.method !== "POST" || request.url !== endpoint) {
      throw new Error(`live mode: the transport sends only to ${endpoint}, not ${request.method} ${request.url}`);
    }
    const text = await request.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = undefined;
    }
    const problem = requestProblem(config, body);
    if (problem !== undefined) throw new Error(`live mode: ${problem}`);
    // The guard refuses, and throws, before the call is sent when it could pass the cap.
    const guard = beginCall(config, body);
    let response;
    try {
      response = await send(endpoint, { method: "POST", headers: request.headers, body: text, signal: request.signal });
    } catch (error) {
      guard.settle(undefined);
      throw error;
    }
    const headers = { "content-type": response.headers.get("content-type") ?? "application/json" };
    if (!response.ok || response.body === null) {
      // A provider that bills a failed call reports no usage, so the guard records the call's projection.
      guard.settle(undefined);
      return new Response(await response.text(), { status: response.status, headers });
    }
    const read = usageReader(config.provider);
    return new Response(guardStream(response.body, guard, read), { status: response.status, headers });
  };
}

/** The adapter for the run's provider, given the key explicitly and sending only through the live transport. */
function providerAdapter(config) {
  const settings = { apiKey: config.apiKey, baseURL: baseURLOf(config), transport: liveTransport(config) };
  return config.provider === "anthropic" ? anthropic(settings) : openaiChat(settings);
}

/**
 * The live run's model: our gateway's real adapter for the run's provider behind createModel(), with each call's
 * output allowance held to the run's maxTokens, and the calls it received. It turns on real model requests, which the
 * offline setup turned off, so it throws outside a live run rather than turn them on there. `record` wraps the adapter
 * for the transcript recorder.
 */
export function liveModel(record) {
  if (live === undefined) throw new Error("live mode: liveModel() runs only under scripts/live/run.mjs");
  const config = live;
  const inner = providerAdapter(config);
  const capped = {
    ...inner,
    stream: (ref, context, options) =>
      inner.stream(ref, context, {
        ...options,
        maxOutputTokens: Math.min(options.maxOutputTokens ?? config.maxTokens, config.maxTokens),
      }),
  };
  const calls = [];
  const adapter = record(capped);
  allowModelRequests(true);
  const model = createModel({
    adapter: {
      ...adapter,
      stream: (ref, context, options) => {
        calls.push(structuredClone({ model: ref, context, options: { maxOutputTokens: options.maxOutputTokens } }));
        return adapter.stream(ref, context, options);
      },
    },
    id: config.model,
  });
  return {
    model,
    run: {
      calls,
      // A real model follows no script, so no step can go unused; the example's own checks judge its flow.
      assertComplete: () => {},
    },
  };
}
