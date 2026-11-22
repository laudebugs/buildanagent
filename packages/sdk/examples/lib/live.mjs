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
// cost guard. It settles the guard from the usage the answer streams once its final event arrives, which is where the
// gateway stops reading and cancels the body, or at the call's projection when the answer fails, stops before its final
// event or reports no usage. The answer reaches the adapter with only its status, content type and body, plus a failed
// answer's numeric retry delays, so the provider's other headers, which name the account and the request, go no
// further.
import { AsyncLocalStorage } from "node:async_hooks";
import { createModel } from "@buildanagent/gateway";
import { anthropic } from "@buildanagent/gateway/anthropic";
import { openaiChat } from "@buildanagent/gateway/openai-chat";
import { allowModelRequests } from "@buildanagent/gateway/testing";
import { beginCall, denyHostTools, guardStream, live } from "../../../../scripts/live/live.ts";

// Kept before the offline setup replaces it (see above).
const fetchOutside = globalThis.fetch;

/** The attempt whose stream is running, so the transport can mark it answered; see liveModel(). */
const attemptOf = new AsyncLocalStorage();

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

/**
 * The `data:` payloads of the complete server-sent events in `text`, whether one of them was OpenAI's `[DONE]`, and the
 * unfinished rest.
 */
function events(text) {
  const blocks = text.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  let done = false;
  const payloads = blocks.flatMap((block) => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data === "[DONE]") done = true;
    if (data === "" || data === "[DONE]") return [];
    try {
      return [JSON.parse(data)];
    } catch {
      return [];
    }
  });
  return { payloads, done, rest };
}

/**
 * Reads the usage an answer streams, chunk by chunk, in the cost guard's token classes, and tells when the answer has
 * sent its final event. Anthropic counts cache reads and writes apart from `input_tokens`; OpenAI's `prompt_tokens`
 * includes its cached tokens. The gateway's adapters stop reading at the final event, `message_stop` or `[DONE]`, and
 * cancel the body, so the guard settles there with the usage seen so far: by then the answer has streamed all of it.
 * A body that ends or is cancelled before its final event settles at the call's projection, whatever usage it has
 * streamed so far: Anthropic's `message_start` reports one output token, not what the call is billed.
 */
export function usageReader(provider) {
  const decoder = new TextDecoder();
  const reader = USAGE[provider];
  let buffer = "";
  let counts = {};
  let finished = false;
  return {
    usageOf(chunk) {
      buffer += decoder.decode(chunk, { stream: true });
      const { payloads, done, rest } = events(buffer);
      buffer = rest;
      for (const event of payloads) {
        counts = reader.merge(counts, event);
        if (reader.isFinal(event)) finished = true;
      }
      if (done) finished = true;
      return reader.usage(counts);
    },
    /** Whether the chunks read so far hold the answer's final event. */
    isFinish: () => finished,
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
    isFinal: (event) => event.type === "message_stop",
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
    // The usage chunk carries the whole request's usage, so it ends the billing as `[DONE]` ends the stream.
    isFinal: (event) => isObject(event.usage),
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

/** The headers that tell the gateway how long to wait before a retry, which a failed answer may pass on. */
const RETRY_HEADERS = ["retry-after", "retry-after-ms"];
// A delay in seconds or milliseconds, as the gateway reads one: a non-negative decimal, which names no account.
const DELAY = /^\d+(\.\d+)?$/;

/**
 * A failed answer's content type and retry delays, so the gateway's retries wait as long as the provider asked. A
 * delay passes on only as a plain number; any other value, an HTTP date included, and every other header stay behind.
 */
function failureHeaders(response) {
  const headers = { "content-type": response.headers.get("content-type") ?? "application/json" };
  for (const name of RETRY_HEADERS) {
    const value = response.headers.get(name)?.trim();
    if (value !== undefined && DELAY.test(value)) headers[name] = value;
  }
  return headers;
}

/**
 * The transport the adapter sends through: the run's provider endpoint only, each request under the cost guard. A 2xx
 * answer marks the attempt it belongs to as answered (liveModel()), so the transcript records only answered attempts;
 * the guard charges every attempt either way.
 */
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
      return new Response(await response.text(), { status: response.status, headers: failureHeaders(response) });
    }
    const attempt = attemptOf.getStore();
    if (attempt !== undefined) attempt.answered = true;
    const read = usageReader(config.provider);
    return new Response(guardStream(response.body, guard, read.usageOf, read.isFinish), {
      status: response.status,
      headers,
    });
  };
}

/** The adapter for the run's provider, given the key explicitly and sending only through the live transport. */
function providerAdapter(config) {
  const settings = { apiKey: config.apiKey, baseURL: baseURLOf(config), transport: liveTransport(config) };
  return config.provider === "anthropic" ? anthropic(settings) : openaiChat(settings);
}

/** Runs each step of an attempt's stream inside its store, so the transport that step reaches marks that attempt. */
async function* within(store, events) {
  const iterator = events[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await attemptOf.run(store, () => iterator.next());
      if (next.done) return;
      yield next.value;
    }
  } finally {
    await attemptOf.run(store, () => iterator.return?.());
  }
}

/**
 * The live run's model: our gateway's real adapter for the run's provider behind createModel(), with each call's
 * output allowance held to the run's maxTokens, and the calls it received. It turns on real model requests, which the
 * offline setup turned off, so it throws outside a live run rather than turn them on there. `record` wraps the adapter
 * for the transcript recorder, which records an attempt only when `answered` says the provider answered it with a
 * 2xx status, as the proxied harnesses' proxy records only answers.
 *
 * createModel() retries a request that fails before any output, so one call the run makes can be several attempts at
 * the adapter. `calls` counts the run's calls, above those retries, as `ScriptedModel.calls` counts a script's; the cost
 * guard still charges every attempt, a failed one at its projection.
 */
export function liveModel(record) {
  if (live === undefined) throw new Error("live mode: liveModel() runs only under scripts/live/run.mjs");
  const config = live;
  const inner = providerAdapter(config);
  // Each attempt's store, by the options object the recorder passed that attempt, which the recorder reads back.
  const stores = new WeakMap();
  const capped = {
    ...inner,
    stream: (ref, context, options) => {
      const store = { answered: false };
      stores.set(options, store);
      const events = inner.stream(ref, context, {
        ...options,
        maxOutputTokens: Math.min(options.maxOutputTokens ?? config.maxTokens, config.maxTokens),
      });
      return within(store, events);
    },
  };
  const calls = [];
  const adapter = record(capped, (options) => stores.get(options)?.answered === true);
  allowModelRequests(true);
  const model = createModel({ adapter, id: config.model });
  const count = (context, options = {}) =>
    calls.push(structuredClone({ model: model.ref, context, options: { maxOutputTokens: options.maxOutputTokens } }));
  return {
    model: {
      ...model,
      stream: (context, options) => {
        count(context, options);
        return model.stream(context, options);
      },
      complete: (context, options) => {
        count(context, options);
        return model.complete(context, options);
      },
    },
    run: {
      calls,
      // A real model follows no script, so no step can go unused; the example's own checks judge its flow.
      assertComplete: () => {},
    },
  };
}
