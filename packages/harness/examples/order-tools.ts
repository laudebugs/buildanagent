// Two read-only tools in a harness's registry, and a turn that offers the model only one of them. The registry holds
// every tool of the app, and each turn's `tools` list picks the ones its requests send.
import { createHarness } from "@buildanagent/harness/server";
import { runTurn, type Session } from "@buildanagent/harness/session";
import { createToolRegistry, type ToolRegistry } from "@buildanagent/harness/tools";
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";
import type { Model } from "@buildanagent/gateway";

/** What the tools read from your own order store. */
export interface OrderStore {
  status(orderId: string): Promise<string | undefined>;
  history(customerId: string): Promise<readonly string[]>;
}

type AnyTool = ToolDefinition<unknown, unknown, unknown>;
const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

// #region registry
/** A registry with `order_status` and `order_history`, both registered as tools of your own app. */
export function orderRegistry(store: OrderStore): ToolRegistry {
  const status = defineTool<{ orderId: string }>({
    name: "order_status",
    description: "Look up the status of one order by its id.",
    inputSchema: { type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] },
    execute: async ({ orderId }) => text((await store.status(orderId)) ?? `No order ${orderId} exists.`),
  });
  const history = defineTool<{ customerId: string }>({
    name: "order_history",
    description: "List the order ids of one customer.",
    inputSchema: { type: "object", properties: { customerId: { type: "string" } }, required: ["customerId"] },
    execute: async ({ customerId }) => text((await store.history(customerId)).join(", ")),
  });
  const registry = createToolRegistry();
  for (const definition of [status, history] as AnyTool[]) {
    registry.register({ name: definition.name, source: "builtin", definition });
  }
  return registry;
}
// #endregion

/** Asks one question in `session`, with `order_status` as the only tool the model is offered. */
export function askAboutStatus(session: Session, model: Model, store: OrderStore, input: string) {
  const harness = createHarness({ registry: orderRegistry(store), model, system: "You answer questions about orders." });
  // #region offer
  return runTurn(session, harness, { input, tools: ["order_status"] });
  // #endregion
}
