// One remote MCP server over streamable HTTP, reached through the egress proxy with a token the host supplies. The
// manager connects it in the background, and the harness calls the manager at each turn's start, where the server's
// tools are registered and checked against their pins.

import type { Model } from "@buildanagent/gateway";
import { createMcpManager, type McpEgressFetch, memoryMcpPinStore } from "@buildanagent/harness/mcp";
import { createPermissionPipeline } from "@buildanagent/harness/permissions";
import { createHarness } from "@buildanagent/harness/server";
import type { ToolRegistry } from "@buildanagent/harness/tools";

/** A harness whose turns reach the tracker server's approved tools. Call `manager.close()` when the harness stops. */
export function trackerHarness(registry: ToolRegistry, model: Model, proxy: McpEgressFetch, token: string) {
  const manager = createMcpManager({
    registry,
    servers: [
      {
        name: "tracker",
        transport: {
          kind: "http",
          url: "https://mcp.tracker.example/mcp",
          headers: { Authorization: `Bearer ${token}` },
          proxy,
        },
        exposure: "direct",
      },
    ],
    pins: memoryMcpPinStore(),
  });
  manager.start();
  const pipeline = createPermissionPipeline(
    { mode: "default", hooks: [manager.permissionHook()], interactive: true, policyVersion: "v1" },
    registry,
  );
  const harness = createHarness({ registry, model, system: "You track issues.", pipeline, turnBoundaries: [manager] });
  return { manager, harness };
}
