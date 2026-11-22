// The client side of the stdio tests: spawns stdio-server.ts with a cleared environment and keeps what it writes, as
// raw bytes split on `\n` and as the lines of stderr.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { decode, type ServerMessage } from "@buildanagent/protocol";
import { testEnv } from "../sandbox/home.js";

const script = fileURLToPath(new URL("./stdio-server.ts", import.meta.url));
const sourceCondition = fileURLToPath(new URL("../permissions/source-condition.mjs", import.meta.url));
const packageDir = fileURLToPath(new URL("../..", import.meta.url));

/** The session the child's `flood` mode watches (stdio-server.ts). */
export const FLOOD_SESSION = "flood";

export interface StdioChild {
  readonly process: ChildProcessWithoutNullStreams;
  /** Every complete stdout line so far, split on `\n` only. */
  readonly lines: string[];
  /** Every complete stderr line so far. */
  readonly errors: string[];
  /** Calls `listener` with each stdout chunk, after `lines` holds the lines it finished, for a library's own framing. */
  onChunk(listener: (chunk: Buffer) => void): void;
  /** Writes `text` to the child's stdin as it is. */
  write(text: string): void;
  /** Writes one message as a JSON line. */
  send(message: unknown): void;
  /** Ends the child's stdin. */
  end(): void;
  /** Resolves with the exit code once the child has exited and both its outputs have closed. */
  readonly exited: Promise<number | null>;
}

/** The environment the child runs with. A test passes its own to check what reaches the child. */
export function childEnv(): Record<string, string> {
  return testEnv([]);
}

/** Spawns the server child in `mode`, with only `env` as its environment. */
export function spawnServer(mode: string, args: string[] = [], env: Record<string, string> = childEnv()): StdioChild {
  const child = spawn(
    process.execPath,
    ["--conditions=source", "--import", sourceCondition, "--import", "tsx", script, mode, ...args],
    { cwd: packageDir, env, stdio: ["pipe", "pipe", "pipe"] },
  );
  const lines: string[] = [];
  const errors: string[] = [];
  const listeners: ((chunk: Buffer) => void)[] = [];
  let out = "";
  let err = "";
  // Streaming decoders, so a character cut across two chunks is read whole.
  const outText = new TextDecoder();
  const errText = new TextDecoder();
  child.stdout.on("data", (chunk: Buffer) => {
    out += outText.decode(chunk, { stream: true });
    const parts = out.split("\n");
    out = parts.pop() ?? "";
    for (const part of parts) lines.push(part);
    for (const listener of listeners) listener(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    err += errText.decode(chunk, { stream: true });
    const parts = err.split("\n");
    err = parts.pop() ?? "";
    errors.push(...parts);
  });
  const exited = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
  return {
    process: child,
    lines,
    errors,
    onChunk: (listener) => listeners.push(listener),
    write: (text) => child.stdin.write(text),
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    end: () => child.stdin.end(),
    exited,
  };
}

/** Every stdout line as a message, read strictly: a line that is not one JSON-RPC 2.0 message throws. */
export const messagesOf = (child: StdioChild): ServerMessage[] =>
  child.lines.map((line) => decode(line) as unknown as ServerMessage);

/** The JSON values of the child's stderr lines that hold one, such as its environment report. */
export const reportsOf = (child: StdioChild): Record<string, unknown>[] =>
  child.errors.flatMap((line) => (line.startsWith("{") ? [JSON.parse(line) as Record<string, unknown>] : []));

/** Polls until `ready()` holds, and fails after `ms`, naming `what` and showing the child's stderr. */
export async function waitUntil(child: StdioChild, ready: () => boolean, what: string, ms = 20_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${what}; the child's stderr:\n${child.errors.join("\n")}`);
}

/** Whether a response with `id` has arrived on stdout. */
export const answered = (child: StdioChild, id: number | string): boolean =>
  messagesOf(child).some((message) => !("method" in message) && message.id === id);

/** The response with `id`, which must have arrived. */
export function responseTo(child: StdioChild, id: number | string): ServerMessage {
  const found = messagesOf(child).find((message) => !("method" in message) && message.id === id);
  if (found === undefined) throw new Error(`no response to ${id}`);
  return found;
}

/**
 * Sends a command and waits for its response. The server runs commands concurrently, as JSON-RPC allows, so a client
 * that needs one command's effect before the next waits for the first one's response.
 */
export async function call(
  child: StdioChild,
  message: { readonly id: number | string; readonly [key: string]: unknown },
): Promise<ServerMessage> {
  child.send(message);
  await waitUntil(child, () => answered(child, message.id), `the response to ${message.id}`);
  return responseTo(child, message.id);
}

export const initialize = (id: number | string) => ({
  jsonrpc: "2.0",
  id,
  method: "initialize",
  params: { clientInfo: { name: "stdio-test", version: "0" }, capabilities: [] },
});
