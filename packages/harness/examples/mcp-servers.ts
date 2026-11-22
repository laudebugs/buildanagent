// One MCP server over stdio: the harness starts it with a cleared environment plus the one parent variable it names
// and a token the host supplies, negotiates its era, and registers its tools as deferred `mcp__docs__<tool>` tools.
import { createMcpManager } from "@buildanagent/harness/mcp";
import type { ToolRegistry } from "@buildanagent/harness/tools";

/** Connects the docs server and registers its tools in `registry`. Call `manager.close()` when the harness stops. */
export async function connectDocs(registry: ToolRegistry, command: string, args: string[], token: string) {
  const manager = createMcpManager({
    registry,
    servers: [
      {
        name: "docs",
        transport: { kind: "stdio", command, args, env: ["DOCS_REGION"], setEnv: { DOCS_TOKEN: token } },
        requestTimeoutMs: 30_000,
      },
    ],
  });
  const [status] = await manager.connect();
  if (status?.status === "failed") throw status.error;
  return { manager, era: status?.era, tools: status?.tools ?? [] };
}
