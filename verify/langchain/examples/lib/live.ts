// LangChain's live mode (scripts/live/). Only scripts/live/run.mjs turns it on; otherwise this file does nothing and
// fakeModel() plays its queue. In a live run, every model that fakeModel() builds sends its calls to the real provider
// through the pinned @langchain/anthropic or @langchain/openai, with the tools bound to it, so createAgent, the
// example's checks of callCount and calls, and the transcript recorder (transcript.ts) work as they do against the
// queue. check.ts imports this file before transcript.ts, so the recorder wraps the live call.
//
// Each call passes the key explicitly, caps the output at the run's maxTokens, refuses provider tools, which can reach
// the host, and runs under the cost guard. The answer keeps only the provider's message, without the response's
// metadata about the request.
import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseChatModelCallOptions } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { fakeModel } from "langchain";
import type { TokenUsage } from "../../../../scripts/live/budget.ts";
import { denyHostTools, guardedCall, type LiveConfig, live } from "../../../../scripts/live/live.ts";

/** The private fields of fakeModel()'s class that a live call uses; attach() checks they still exist. */
interface FakeModel {
  _state: { callIndex: number; calls: { messages: BaseMessage[]; options: unknown }[] };
  _tools: (Record<string, unknown> & { name?: string; type?: string; function?: { name?: string } })[];
  _generate(messages: BaseMessage[], options: BaseChatModelCallOptions, runManager?: unknown): Promise<ChatResult>;
}

type ProviderModel = ChatAnthropic | ChatOpenAI;

function providerModel(config: LiveConfig): ProviderModel {
  if (config.provider === "anthropic") {
    return new ChatAnthropic({
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      maxRetries: 0,
      ...(config.baseURL === undefined ? {} : { anthropicApiUrl: config.baseURL }),
    });
  }
  return new ChatOpenAI({
    apiKey: config.apiKey,
    model: config.model,
    maxTokens: config.maxTokens,
    maxRetries: 0,
    useResponsesApi: true,
    ...(config.baseURL === undefined ? {} : { configuration: { baseURL: `${config.baseURL}/v1` } }),
  });
}

/** A LangChain message's usage in the cost guard's token classes. */
function tokensOf(result: ChatResult): TokenUsage | undefined {
  const usage = (result.generations[0]?.message as AIMessage | undefined)?.usage_metadata;
  if (usage === undefined) return undefined;
  const cacheRead = usage.input_token_details?.cache_read ?? 0;
  const cacheWrite = usage.input_token_details?.cache_creation ?? 0;
  return {
    uncachedInput: usage.input_tokens - cacheRead - cacheWrite,
    cacheRead,
    cacheWrite,
    output: usage.output_tokens,
  };
}

/** A tool as the host-tool check sees it: a tool object has no type, a provider tool's dictionary has one. */
function described(tool: FakeModel["_tools"][number]) {
  const name = tool.name ?? tool.function?.name ?? "";
  return typeof tool.type === "string" ? { name, type: tool.type } : { name };
}

function attach(config: LiveConfig): void {
  const proto = Object.getPrototypeOf(fakeModel()) as FakeModel;
  const sample = fakeModel() as unknown as FakeModel;
  if (typeof proto._generate !== "function" || !sample._state || !Array.isArray(sample._tools)) {
    throw new Error("live mode: fakeModel()'s _generate, _state or _tools has changed");
  }
  const real = providerModel(config);
  proto._generate = async function (this: FakeModel, messages, options) {
    this._state.calls.push({ messages: [...messages], options });
    this._state.callIndex += 1;
    denyHostTools(this._tools.map(described));
    const sent = { ...options, tools: this._tools } as BaseChatModelCallOptions;
    const result = await guardedCall(
      config,
      { messages: messages.map((m) => m.toDict()), tools: this._tools },
      () => real._generate(messages, sent as never),
      tokensOf,
    );
    const answer = result.generations[0]?.message as AIMessage | undefined;
    if (answer === undefined) throw new Error("live mode: the provider returned no message");
    const message = new AIMessage({
      content: answer.content,
      tool_calls: answer.tool_calls,
      usage_metadata: answer.usage_metadata,
    });
    return { generations: [{ text: answer.text, message }] };
  };
}

if (live) attach(live);
