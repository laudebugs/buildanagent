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
    case "redos-input":
      return [
        tool("q", {
          type: "object",
          properties: {
            q: { type: "string", pattern: "^(a+)+$", format: "email" },
            pattern: { type: "string", description: "A property that happens to be named pattern." },
          },
          patternProperties: { "^(b+)+$": { type: "string" } },
          items: [{ type: "string", pattern: "^(c+)+$" }],
        }),
      ];
    case "surrogate":
      return [{ ...tool("emoji"), description: `${"x".repeat(4095)}\u{1F600}` }];
    case "pages":
      return Array.from({ length: 100 }, (_, i) => tool(`p${listed}_${i}`));
    case "two-tools":
      return [tool("alpha"), tool("echo")];
    case "proto":
      return [
        JSON.parse(
          '{"name":"p","description":"d","inputSchema":{"type":"object","__proto__":{"polluted":1},"properties":{"constructor":{"type":"string"}}},"annotations":{"__proto__":{"polluted":2}}}',
        ),
      ];
    case "redos-output":
      return [
        { ...tool("r"), outputSchema: { type: "object", properties: { s: { type: "string", pattern: "^(a+)+$" } } } },
      ];
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
    case "answer-then-exit": {
      // Exits as soon as the whole line is in the pipe, before the client can have read it.
      const line = `${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "z".repeat(32 * 1024) }] } })}\n`;
      process.stdout.write(line, () => process.exit(0));
      return;
    }
    case "late-output": {
      // The server exits at once, and a child that shares its standard output writes the answer 150 ms later: the
      // client sees the output arrive after the exit, which Node allows for any child.
      const line = JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "late" }] } });
      spawn(process.execPath, ["-e", `setTimeout(() => process.stdout.write(${JSON.stringify(`${line}\n`)}), 150)`], {
        stdio: ["ignore", "inherit", "ignore"],
      });
      process.exit(0);
      return;
    }
    case "report-pid":
    case "ignore-term":
      result(id, { content: [{ type: "text", text: JSON.stringify({ pid: process.pid }) }] });
      return;
    case "split-utf8": {
      const line = `${JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "héllo" }] } })}\n`;
      const bytes = Buffer.from(line, "utf8");
      const cut = bytes.indexOf(0xc3) + 1;
      process.stdout.write(bytes.subarray(0, cut));
      setTimeout(() => process.stdout.write(bytes.subarray(cut)), 50);
      return;
    }
    case "proto":
      write(
        JSON.parse(
          `{"jsonrpc":"2.0","id":${JSON.stringify(id)},"result":{"__proto__":{"isError":true},"content":[{"type":"text","text":"ok","__proto__":{"polluted":3}}]}}`,
        ),
      );
      return;
    case "redos-output":
      result(id, { content: [{ type: "text", text: "done" }], structuredContent: { s: `${"a".repeat(40)}!` } });
      return;
    case "server-requests":
      askClient(id);
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
          { type: "resource", resource: { uri: "https://example.com/blob", blob: "AAAA" } },
        ],
      });
      return;
    default:
      result(id, { content: [{ type: "text", text: `called ${name}` }] });
  }
}

// The requests a server may send its client, and the answers the client gave, keyed by our request id.
const asked = new Map<string, string>();
const answers: Record<string, unknown> = {};
let pendingCall: unknown;

function askClient(callId: unknown): void {
  pendingCall = callId;
  const requests: [string, unknown][] = [
    ["sampling/createMessage", { messages: [{ role: "user", content: { type: "text", text: "hi" } }], maxTokens: 5 }],
    ["roots/list", {}],
    ["elicitation/create", { mode: "form", message: "ok?", requestedSchema: { type: "object", properties: {} } }],
    ["ping", {}],
  ];
  for (const [method, params] of requests) {
    const id = `ask-${method}`;
    asked.set(id, method);
    write({ jsonrpc: "2.0", id, method, params });
  }
  // A client that drops these requests never answers, so the call ends with what came back after a while.
  setTimeout(() => {
    if (asked.size === 0) return;
    asked.clear();
    result(pendingCall, { content: [{ type: "text", text: JSON.stringify(answers) }] });
  }, 800);
}

function answered(message: { id?: unknown; result?: unknown; error?: unknown }): void {
  const method = asked.get(String(message.id));
  if (method === undefined) return;
  answers[method] = message.error === undefined ? { result: message.result } : { error: message.error };
  asked.delete(String(message.id));
  if (asked.size === 0) result(pendingCall, { content: [{ type: "text", text: JSON.stringify(answers) }] });
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
  if (method === undefined) return answered(message as never);
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
    if (scenario === "pages") listed += 1;
    const page = scenario === "pages" ? { nextCursor: `page-${listed}` } : {};
    return result(id, { tools: toolsFor(), ...page, ...(modern ? { ttlMs: 0, cacheScope: "private" } : {}) });
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
