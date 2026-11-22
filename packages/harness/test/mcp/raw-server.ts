// A hand-written MCP server for the hostile cases a real server library would not produce: odd tool lists, lines
// that are not JSON or are too long, a server that renames its tools, exits on the probe, ignores SIGTERM or leaves
// a child behind. It speaks JSON lines on stdio:
//   raw-server.ts <modern|legacy|exit-on-probe|silent-probe> <scenario> [call log path]
// Every request it receives is appended to the log as `{ method, name? }`, so a test can see what reached it.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";

const [era = "legacy", scenario = "plain", log] = process.argv.slice(2);
const modern = era === "modern";
const OBJECT = { type: "object" };
let listed = 0;

function write(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const tool = (name: string, inputSchema: unknown = OBJECT) => ({ name, description: `The ${name} tool.`, inputSchema });

/** The tool list each scenario sends. */
function toolsFor(): unknown[] {
  switch (scenario) {
    case "hostile-names":
      return ["a__b", "mcp__other__x", "Ünïcode", "y".repeat(100), "tool_search", "read", "_edge_"].map((n) => tool(n));
    case "duplicate":
      return [tool("search"), tool("search")];
    case "confusable":
      return [tool("search"), tool("ｓearch")];
    case "case":
      return [tool("Search"), tool("search")];
    case "too-many":
      return Array.from({ length: 300 }, (_, i) => tool(`t${i}`));
    case "control-name":
      return [tool("bad\nname")];
    case "huge-schema":
      return [tool("big", { type: "object", description: "d".repeat(70 * 1024) })];
    case "remote-ref":
      return [tool("first"), tool("second", { type: "object", $ref: "http://example.com/schema.json" })];
    case "not-object-schema":
      return [tool("s", { type: "string" })];
    case "long-description":
      return [{ ...tool("long"), description: "z".repeat(10_000) }];
    case "rename":
      listed += 1;
      return listed === 1 ? [tool("alpha")] : [tool("beta")];
    default:
      return [tool("echo")];
  }
}

function result(id: unknown, value: Record<string, unknown>): void {
  write({ jsonrpc: "2.0", id, result: modern ? { ...value, resultType: "complete" } : value });
}

function callTool(id: unknown, name: string): void {
  switch (scenario) {
    case "long-line":
      process.stdout.write("x".repeat(2 * 1024 * 1024));
      return;
    case "garbage":
      process.stdout.write("this is not json\n[1, 2, 3]\n\nÿ\n");
      result(id, { content: [{ type: "text", text: "after the garbage" }] });
      return;
    case "input-required":
      write({
        jsonrpc: "2.0",
        id,
        result: {
          resultType: "input_required",
          inputRequests: {
            confirm: {
              method: "elicitation/create",
              params: { mode: "form", message: "Are you sure?", requestedSchema: { type: "object", properties: {} } },
            },
          },
        },
      });
      return;
    case "grandchild": {
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      result(id, { content: [{ type: "text", text: JSON.stringify({ pid: process.pid, child: child.pid }) }] });
      return;
    }
    case "rename":
      write({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
      result(id, { content: [{ type: "text", text: `called ${name}` }] });
      return;
    case "no-result-type":
      write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "no resultType" }] } });
      return;
    case "mixed-content":
      result(id, {
        content: [
          { type: "text", text: "one" },
          { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
          { type: "image", mimeType: "image/svg+xml", data: "PHN2Zz4=" },
          { type: "audio", mimeType: "audio/wav", data: "AAAA" },
          { type: "resource", resource: { uri: "file:///a", text: "resource text" } },
          { type: "resource_link", uri: "file:///b", name: "b" },
        ],
      });
      return;
    default:
      result(id, { content: [{ type: "text", text: `called ${name}` }] });
  }
}

type Request = { id?: unknown; method?: string; params?: { name?: string; protocolVersion?: string } };

function record({ method, params }: Request): void {
  if (log === undefined) return;
  const name = method === "tools/call" ? params?.name : undefined;
  appendFileSync(log, `${JSON.stringify({ method, ...(name === undefined ? {} : { name }) })}\n`);
}

function discover(id: unknown): void {
  if (era === "exit-on-probe") process.exit(0);
  if (era === "silent-probe") return;
  if (!modern) {
    write({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    return;
  }
  write({
    jsonrpc: "2.0",
    id,
    result: {
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: { listChanged: true } },
      resultType: "complete",
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "raw", version: "1.0.0" } },
    },
  });
}

function handle(message: Request) {
  const { id, method } = message;
  if (method === undefined) return;
  record(message);
  if (id === undefined) return;
  if (method === "server/discover") return discover(id);
  if (scenario === "silent") return;
  if (method === "initialize") {
    return result(id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
      capabilities: { tools: { listChanged: true } },
      serverInfo: { name: "raw", version: "1.0.0" },
    });
  }
  // A 2026-07-28 list result carries its cache hints.
  if (method === "tools/list") {
    return result(id, { tools: toolsFor(), ...(modern ? { ttlMs: 0, cacheScope: "private" } : {}) });
  }
  if (method === "tools/call") return callTool(id, message.params?.name ?? "");
  write({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

if (scenario === "exit-on-start") process.exit(1);
if (scenario === "ignore-term") {
  process.on("SIGTERM", () => {});
  // Stays alive after its input ends, as a server that ignores the close would.
  setInterval(() => {}, 1000);
}

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const line of lines) if (line.trim() !== "") handle(JSON.parse(line));
});
process.stdin.on("end", () => {
  if (scenario !== "ignore-term") process.exit(0);
});
