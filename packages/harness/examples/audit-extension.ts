// An audit extension: it asks a person before every shell command and hands every event to an audit log. It is
// composed with another extension into one harness, whose log records which extensions ran.
import type { Model } from "@buildanagent/gateway";
import { composeExtensions, type Extension, recordsOf, registerExtensionTools } from "@buildanagent/harness/extensions";
import { createHarness } from "@buildanagent/harness/server";
import type { ToolRegistry } from "@buildanagent/harness/tools";
import type { AgentEvent } from "@buildanagent/sdk";

const SYSTEM = "You are a careful coding agent.";

/** A harness that runs the audit extension first, then `other`, with both extensions' tools in `registry`. */
export async function auditedHarness(
  registry: ToolRegistry,
  model: Model,
  log: (e: AgentEvent) => void,
  other: Extension,
) {
  const audit: Extension = {
    name: "audit",
    version: "1.0.0",
    interceptors: { beforeToolCall: (event) => (event.tool === "bash" ? { decision: "ask" } : { decision: "allow" }) },
    observers: [(event) => log(event)],
  };
  const { interceptors, observers } = composeExtensions([audit, other]);
  registerExtensionTools(registry, [audit, other]);
  const extensionRecords = await recordsOf([audit, other]);
  return createHarness({ registry, model, system: SYSTEM, interceptors, observers, extensionRecords });
}
