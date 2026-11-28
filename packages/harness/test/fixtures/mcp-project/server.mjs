// A project's MCP server for the project-config tests. The moment it starts it writes `marker.json` in its working
// folder, with the variables it was given, so a test can tell whether the command ran. It then speaks the legacy
// MCP revision on stdio with one tool, `echo`.
import { writeFileSync } from "node:fs";

writeFileSync("marker.json", JSON.stringify({ env: process.env }));

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);

function handle({ id, method, params }) {
  if (id === undefined) return;
  if (method === "initialize") {
    write({
      id,
      result: {
        protocolVersion: params?.protocolVersion ?? "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1.0.0" },
      },
    });
  } else if (method === "tools/list") {
    write({
      id,
      result: { tools: [{ name: "echo", description: "Returns its text.", inputSchema: { type: "object" } }] },
    });
  } else if (method === "tools/call") {
    write({ id, result: { content: [{ type: "text", text: String(params?.arguments?.text) }] } });
  } else {
    write({ id, error: { code: -32601, message: "Method not found" } });
  }
}

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  const lines = buffered.split("\n");
  buffered = lines.pop() ?? "";
  for (const line of lines) if (line.trim() !== "") handle(JSON.parse(line));
});
process.stdin.on("end", () => process.exit(0));
