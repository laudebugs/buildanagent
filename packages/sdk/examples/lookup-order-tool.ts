// A tool that looks up an order by its number. Its Zod schema checks the model's arguments before the lookup runs.
import { defineTool } from "@buildanagent/sdk";
import { z } from "zod";

// #region tool
/** An order, as your order store returns it. */
export interface Order {
  id: number;
  status: "processing" | "shipped" | "delivered";
}

/** Finds an order by its number in your own store. */
export type FindOrder = (id: number) => Promise<Order | undefined>;

/** Builds the `lookup_order` tool over your order store. */
export function lookupOrderTool(findOrder: FindOrder) {
  return defineTool({
    name: "lookup_order",
    description: "Look up an order by its number and return its status.",
    inputSchema: z.object({ order: z.number().int().positive() }),
    async execute({ order }) {
      const found = await findOrder(order);
      if (found === undefined) return { content: [{ type: "text", text: `No order ${order} exists.` }], isError: true };
      return { content: [{ type: "text", text: `Order ${order} is ${found.status}.` }], structured: found };
    },
  });
}
// #endregion
