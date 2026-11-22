/**
 * `fetch`: a GET through `EgressProxy.fetch()` only, so the proxy's allowlist and address checks decide what it
 * reaches. It takes only `https:` URLs, which also keeps it off the proxy's credential routes, since those are served
 * over plain HTTP on the proxy's own address. Every known secret is removed from what it returns, as a net under that
 * rule.
 */
import { defineTool, type ToolDefinition, type ToolResult } from "@buildanagent/sdk";
import type { EgressProxy } from "../../credentials/egress-proxy.js";
import { scrubString } from "../../credentials/scrub.js";
import { BUILTIN_TOOL_DEFAULTS } from "./descriptions.js";
import { errorResult, failureResult, textResult } from "./results.js";

/** What the `fetch` tool needs of an egress proxy. */
export type FetchProxy = Pick<EgressProxy, "fetch" | "knownSecrets">;

interface FetchInput {
  readonly url: string;
}

// Content types whose body is text the model can read; any other body is described by its size alone.
const TEXT_TYPE = /^(text\/|application\/([\w.+-]*\+)?(json|xml|javascript|ecmascript|x-www-form-urlencoded)\b)/i;

/** Up to `limit` bytes of the body, and whether more was left unread. */
async function readBody(response: Response, limit: number): Promise<{ bytes: Uint8Array; cut: boolean }> {
  const reader = response.body?.getReader();
  if (reader === undefined) return { bytes: new Uint8Array(), cut: false };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return { bytes: join(chunks, size), cut: false };
    chunks.push(value);
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return { bytes: join(chunks, size).subarray(0, limit), cut: true };
    }
  }
}

function join(chunks: readonly Uint8Array[], size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

async function describe(response: Response, url: URL): Promise<string> {
  const { maxBodyBytes } = BUILTIN_TOOL_DEFAULTS.fetch;
  const type = response.headers.get("content-type") ?? "";
  const location = response.headers.get("location");
  const head = [
    `HTTP ${response.status} ${response.statusText}`.trimEnd(),
    `url: ${url.href}`,
    ...(type === "" ? [] : [`content-type: ${type}`]),
    ...(location === null ? [] : [`location: ${location}`]),
  ].join("\n");
  const { bytes, cut } = await readBody(response, maxBodyBytes);
  if (type !== "" && !TEXT_TYPE.test(type)) {
    return `${head}\n\n[a ${type} body${cut ? ` of more than ${maxBodyBytes}` : ` of ${bytes.length}`} bytes was left out]`;
  }
  const body = new TextDecoder().decode(bytes);
  return `${head}\n\n${body}${cut ? `\n[the body was cut at ${maxBodyBytes} bytes]` : ""}`;
}

async function fetchUrl(proxy: FetchProxy, input: FetchInput, signal: AbortSignal): Promise<ToolResult> {
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return errorResult(`${JSON.stringify(input.url)} is not a URL.`);
  }
  if (url.protocol !== "https:") return errorResult(`fetch reaches only https URLs, not ${url.protocol} ones.`);
  const { timeoutMs } = BUILTIN_TOOL_DEFAULTS.fetch;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await proxy.fetch(url, { method: "GET", signal: AbortSignal.any([signal, timeout]) });
    const text = await describe(response, url);
    return textResult(scrubString(text, await proxy.knownSecrets()), { status: response.status });
  } catch (error) {
    if (timeout.aborted && !signal.aborted) return errorResult(`The request to ${url.host} took over ${timeoutMs} ms.`);
    return failureResult(error);
  }
}

/** The `fetch` tool, which reaches the web only through `proxy`. */
export function fetchTool(proxy: FetchProxy): ToolDefinition<unknown, unknown, unknown> {
  return defineTool<FetchInput>({
    name: "fetch",
    description: BUILTIN_TOOL_DEFAULTS.fetch.description,
    inputSchema: {
      type: "object",
      properties: { url: { type: "string", description: "The https URL to fetch." } },
      required: ["url"],
      additionalProperties: false,
    },
    firstParty: true,
    annotations: { readOnlyHint: true },
    execute: (input, ctx) => fetchUrl(proxy, input, ctx.signal),
  }) as ToolDefinition<unknown, unknown, unknown>;
}
