// A real MCP server on @modelcontextprotocol/server 2.4.0, for both eras. In process, `serveModern()` and
// `serveLegacy()` serve it over a linked in-memory pair. Run as a script, it serves stdio:
//   library-server.ts <modern|legacy> <call log path>
// and appends each tool call it receives to the log, one JSON line each, so a test can see what reached the server.
import { appendFileSync } from "node:fs";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";

/** A Standard Schema that describes itself as `json` and accepts any value, which is all a test server needs. */
function schema(json: Record<string, unknown>) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "buildanagent-test",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  } as never;
}

const OBJECT = schema({ type: "object" });
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

/** The server's tools. `record` is told of every call before it runs. */
export function buildServer(record: (tool: string, input: unknown) => void = () => {}): McpServer {
  const server = new McpServer({ name: "fixture", version: "1.0.0" }, { capabilities: { tools: {} } });
  const tool = (
    name: string,
    description: string,
    run: (input: Record<string, unknown>) => Promise<unknown>,
    extra = {},
  ) =>
    server.registerTool(name, { description, inputSchema: OBJECT, ...extra }, (async (
      input: Record<string, unknown>,
    ) => {
      record(name, input);
      return run(input ?? {});
    }) as never);
  tool("echo", "Returns its text.", async ({ text: value }) => text(String(value)));
  tool("big", "Returns a text of the given number of bytes.", async ({ bytes }) => text("x".repeat(Number(bytes))));
  tool("env", "Returns the server's environment and process id.", async () =>
    text(JSON.stringify({ env: process.env, pid: process.pid })),
  );
  tool("hang", "Never answers.", () => new Promise(() => {}));
  tool("crash", "Exits in the middle of the call.", async () => process.exit(3));
  tool("fails", "Reports a failure of its own.", async () => ({ ...text("it broke"), isError: true }));
  tool("noisy", "Writes a lot to standard error.", async () => {
    process.stderr.write(`${"e".repeat(256 * 1024)}\nlast line of stderr\n`);
    return text("done");
  });
  tool("reader", "Claims to change nothing.", async () => text("read"), {
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  });
  return server;
}

/** A 2026-07-28 server and its client end, in this process. */
export function serveModern(record?: (tool: string, input: unknown) => void) {
  const [client, server] = InMemoryTransport.createLinkedPair();
  serveStdio(() => buildServer(record), { transport: server });
  return client;
}

/** A legacy-only server, wired the 2025 way, and its client end, in this process. */
export async function serveLegacy(record?: (tool: string, input: unknown) => void) {
  const [client, server] = InMemoryTransport.createLinkedPair();
  await buildServer(record).connect(server);
  return client;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [era, log] = process.argv.slice(2);
  const record = (tool: string, input: unknown) => {
    if (log !== undefined) appendFileSync(log, `${JSON.stringify({ tool, input })}\n`);
  };
  if (era === "modern") serveStdio(() => buildServer(record));
  else await buildServer(record).connect(new StdioServerTransport());
}
