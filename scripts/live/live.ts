// The example side of a live run (scripts/live/run.mjs). A harness's live mode imports this file from its
// examples/lib/, and only scripts/live/run.mjs turns it on, by spawning the harness's runner with LIVE=1 and the path
// of a file that holds one provider's key in LIVE_API_KEY_FILE. That runner passes the same allowlisted environment to
// the example, never ...process.env. Without LIVE=1, `live` is undefined and every mock stays as it is.
//
// On import, the file reads the key from that file and deletes the file, so the key is in no environment block: not
// the example's, not its runner's and not run.mjs's. The harness passes the key to its SDK explicitly, never through
// the variable the SDK reads by default, and wraps each model call in the cost guard (budget.ts). Every request is
// also checked for host tools, as the SDK process requires of mocks (AGENTS.md): a live example may offer only
// in-process function tools.
//
// The guard and these checks protect against our own mistakes: an example that loops, a model that answers at length, a
// tool that reaches the host by accident. They can't contain malicious package code. Any code in the example's process,
// a pinned dependency included, runs before or beside this file and can read the key file before it is deleted, read
// the key from memory, call the provider without the guard, or rewrite the ledger. The hard ceiling on spend is the
// provider's own spend limit on the workspace or project the key belongs to (apps/manual/README.md).
import { readFileSync, rmSync } from "node:fs";
import { estimateTokens, type PlannedCall, readCatalog, reserveCall, settleCall, type TokenUsage } from "./budget.ts";

export type LiveProvider = "anthropic" | "openai";

export interface LiveConfig {
  provider: LiveProvider;
  model: string;
  /** The output allowance of every call, which bounds what one call can cost. */
  maxTokens: number;
  apiKey: string;
  /** Set only by the tests, which point the run at a stub server on the loopback interface. */
  baseURL: string | undefined;
  /** The example's path from the repository root, as the ledger and report name it. */
  example: string;
  ledger: string;
  /** The price catalog the cost guard reads: the gateway's, unless a test passes a fixture. */
  catalog: string | undefined;
}

/**
 * Tool names that reach the host in one of our harnesses' SDKs: shells, file editors, computer use and code
 * execution. A live request that offers one of them stops before it is sent, whatever its type says.
 */
export const HOST_TOOL_NAMES: ReadonlySet<string> = new Set([
  "bash",
  "shell",
  "local_shell",
  "exec_command",
  "execute_command",
  "apply_patch",
  "str_replace_editor",
  "str_replace_based_edit_tool",
  "text_editor",
  "computer",
  "code_interpreter",
  "code_execution",
  "read",
  "write",
  "edit",
  "multiedit",
  "grep",
  "glob",
  "find",
  "ls",
  "web_fetch",
  "web_search",
  "file_search",
]);

function fail(message: string): never {
  throw new Error(`live mode: ${message}`);
}

/** A base URL a test may set: plain HTTP on the loopback interface, so no key can follow it off the machine. */
function loopbackOnly(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    fail("LIVE_BASE_URL may name only a stub server on the loopback interface");
  }
  return value;
}

/** Reads the key from the file run.mjs wrote for this example, then deletes the file and forgets its path. */
function readKey(env: Record<string, string | undefined>): string {
  const file = env.LIVE_API_KEY_FILE;
  delete env.LIVE_API_KEY_FILE;
  if (!file) fail("LIVE_API_KEY_FILE is not set");
  let key: string;
  try {
    key = readFileSync(file, "utf8").trim();
  } finally {
    rmSync(file, { force: true });
  }
  if (!key) fail("the key file is empty");
  return key;
}

function readLive(env: Record<string, string | undefined>): LiveConfig | undefined {
  if (env.LIVE !== "1") return undefined;
  const apiKey = readKey(env);
  const provider = env.LIVE_PROVIDER;
  if (provider !== "anthropic" && provider !== "openai") fail(`LIVE_PROVIDER is ${JSON.stringify(provider)}`);
  const maxTokens = Number(env.LIVE_MAX_TOKENS);
  if (!Number.isInteger(maxTokens) || maxTokens <= 0) fail("LIVE_MAX_TOKENS must be a positive integer");
  if (!env.LIVE_MODEL || !env.LIVE_EXAMPLE || !env.LIVE_LEDGER)
    fail("LIVE_MODEL, LIVE_EXAMPLE and LIVE_LEDGER are needed");
  return {
    provider,
    model: env.LIVE_MODEL,
    maxTokens,
    apiKey,
    baseURL: loopbackOnly(env.LIVE_BASE_URL),
    example: env.LIVE_EXAMPLE,
    ledger: env.LIVE_LEDGER,
    catalog: env.LIVE_CATALOG || undefined,
  };
}

/** The live run's settings, or undefined when the example runs against its mock. */
export const live: LiveConfig | undefined = readLive(process.env);

/** Stops a live request that offers a host tool, by its name or by a type other than a plain function tool. */
export function denyHostTools(tools: readonly { name: string; type?: string }[], functionTypes = ["function"]): void {
  for (const tool of tools) {
    if (HOST_TOOL_NAMES.has(tool.name.toLowerCase())) fail(`the request offers the host tool "${tool.name}"`);
    if (tool.type !== undefined && !functionTypes.includes(tool.type)) {
      fail(`the request offers "${tool.name}", a tool of type "${tool.type}", not an in-process function`);
    }
  }
}

/** A live call the cost guard let through; `settle` records its cost once it has answered. */
export interface LiveCall {
  settle(usage: TokenUsage | undefined): void;
}

/**
 * Checks one live model call against the cost guard before it is sent. `request` is whatever the SDK is about to
 * send, used only for its size: its JSON length estimates the input, which errs high. Throws when the call could pass
 * the cap. Call `settle` with the provider's reported usage once the call answers, or with undefined when it reported
 * none or failed, which records the projection, because a provider may bill a request that failed part way.
 */
export function beginCall(config: LiveConfig, request: unknown): LiveCall {
  const planned: PlannedCall = {
    example: config.example,
    provider: config.provider,
    model: config.model,
    inputTokens: estimateTokens(JSON.stringify(request ?? null)?.length ?? 0),
    maxOutputTokens: config.maxTokens,
  };
  const catalog = readCatalog(config.catalog);
  const projected = reserveCall(config.ledger, planned, catalog);
  let settled = false;
  return {
    settle(usage) {
      if (settled) return;
      settled = true;
      settleCall(config.ledger, planned, projected, usage, catalog);
    },
  };
}

/** Runs one live model call that answers in one piece under the cost guard; `usageOf` reads its reported usage. */
export async function guardedCall<T>(
  config: LiveConfig,
  request: unknown,
  call: () => Promise<T>,
  usageOf: (result: T) => TokenUsage | undefined,
): Promise<T> {
  const guard = beginCall(config, request);
  let result: T;
  try {
    result = await call();
  } catch (error) {
    guard.settle(undefined);
    throw error;
  }
  guard.settle(usageOf(result));
  return result;
}

/**
 * Passes a streamed answer through and settles its cost guard however the stream ends. Only a completed answer is
 * priced from its streamed usage: a part that `isFinish` picks out settles the guard at once with the usage `usageOf`
 * has read up to and including it, so a reader that stops or cancels after the finish part still pays that usage.
 * Every other ending settles with no usage, which records the call's projection: every input token at the dearest rate
 * and the whole output allowance. That covers a stream that ends without a finish part, one that fails and one that
 * the reader cancels first, because the usage such an answer has streamed so far, such as the one output token
 * Anthropic's `message_start` reports, is not what the call is billed. The guard settles once whatever happens.
 */
export function guardStream<T>(
  stream: ReadableStream<T>,
  guard: LiveCall,
  usageOf: (part: T) => TokenUsage | undefined,
  isFinish: (part: T) => boolean,
): ReadableStream<T> {
  const reader = stream.getReader();
  let usage: TokenUsage | undefined;
  return new ReadableStream<T>({
    async pull(controller) {
      let next: Awaited<ReturnType<typeof reader.read>>;
      try {
        next = await reader.read();
      } catch (error) {
        guard.settle(undefined);
        controller.error(error);
        return;
      }
      if (next.done) {
        // A finish part has already settled the guard, so this records the projection only for an unfinished answer.
        guard.settle(undefined);
        controller.close();
        return;
      }
      usage = usageOf(next.value) ?? usage;
      if (isFinish(next.value)) guard.settle(usage);
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      guard.settle(undefined);
      await reader.cancel(reason);
    },
  });
}
