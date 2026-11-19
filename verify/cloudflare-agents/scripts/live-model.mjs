// The host half of the Cloudflare Agents harness's live mode (scripts/live/). In a live run, the bundle's scripted()
// model (examples/lib/check.ts) posts each call's options to http://live-model.invalid/, and workerd.mjs's
// outboundService hands the request to the handler below, in the Node process that runs workerd. The handler sends
// the call to the real provider through the pinned @ai-sdk/anthropic or @ai-sdk/openai and answers with the result's
// content, finish reason, usage and warnings. So the key stays in this process and never enters workerd.
//
// Each call passes the key explicitly, caps the output at the run's maxTokens, refuses provider-defined tools, which
// can reach the host, and runs under the cost guard. Think offers every turn its workspace tools, which read and write
// files in the Agent's own storage, not on the host; the live run still withholds them, so a real model is offered
// only the example's own tools, and a request that offers any other tool a shell or an editor would have stops.
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { denyHostTools, guardedCall, live } from "../../../scripts/live/live.ts";

/** The workspace tools Think adds to every turn (@cloudflare/think's workspace tools). */
const THINK_WORKSPACE_TOOLS = new Set(["read", "ls", "find", "grep", "write", "edit", "delete"]);

/** The AI SDK's usage in the cost guard's token classes. */
function tokensOf(usage) {
  const input = usage?.inputTokens;
  const output = usage?.outputTokens?.total;
  if (input?.total === undefined || output === undefined) return undefined;
  const cacheRead = input.cacheRead ?? 0;
  const cacheWrite = input.cacheWrite ?? 0;
  return { uncachedInput: input.noCache ?? input.total - cacheRead - cacheWrite, cacheRead, cacheWrite, output };
}

/** The handler for the Worker's model calls. `fetch` is the process's own, which the network guard leaves alone. */
export function liveModel(fetch) {
  if (live === undefined) throw new Error("live mode: scripts/live-model.mjs needs LIVE=1");
  const config = live;
  const baseURL = config.baseURL === undefined ? undefined : `${config.baseURL}/v1`;
  const real =
    config.provider === "anthropic"
      ? createAnthropic({ apiKey: config.apiKey, baseURL, fetch })(config.model)
      : createOpenAI({ apiKey: config.apiKey, baseURL, fetch })(config.model);
  return async (request) => {
    try {
      const options = await request.json();
      const tools = (options.tools ?? []).filter((tool) => !THINK_WORKSPACE_TOOLS.has(tool.name));
      denyHostTools(tools.map((tool) => ({ name: tool.name, type: tool.type })));
      const maxOutputTokens = Math.min(options.maxOutputTokens ?? config.maxTokens, config.maxTokens);
      const sent = { ...options, tools, maxOutputTokens };
      const result = await guardedCall(
        config,
        { prompt: sent.prompt, tools: sent.tools },
        () => real.doGenerate(sent),
        (r) => tokensOf(r.usage),
      );
      const { content, finishReason, usage, warnings } = result;
      return Response.json({ content, finishReason, usage, warnings });
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      return Response.json({ error: message }, { status: 502 });
    }
  };
}
