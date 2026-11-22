// Small MCP servers for the book's examples, running in this process on the real server library
// (@modelcontextprotocol/server), reached through a linked in-memory pair, so no child process starts and no file is
// read. Each call makes a new server, so an example can connect the same tools twice.
import type { McpChannel } from "@buildanagent/harness/mcp";
import { InMemoryTransport, McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

/** A Standard Schema that describes itself as `json` and accepts any value: the server library needs one, and the client checks nothing here. */
function schema(json: Record<string, unknown>) {
  return {
    "~standard": {
      version: 1 as const,
      vendor: "buildanagent-examples",
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => json, output: () => json },
    },
  } as never;
}

const ORDER = schema({ type: "object", properties: { orderId: { type: "string" } }, required: ["orderId"] });
const CITY = schema({ type: "object", properties: { city: { type: "string" } }, required: ["city"] });
const UNITS = schema({ type: "object", properties: { units: { enum: ["C", "F"] } }, required: ["units"] });
const reply = (text: string) => ({ content: [{ type: "text" as const, text }] });

/** A server named `name` whose tools are `[name, description, input schema, answer]`, served in the 2026-07-28 era. */
function serve(name: string, tools: readonly (readonly [string, string, never, string])[]): McpChannel {
  // serveStdio() asks for its server through a factory, as the library's own servers do.
  const build = () => {
    const server = new McpServer({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
    for (const [tool, description, inputSchema, answer] of tools) {
      server.registerTool(tool, { description, inputSchema }, (async () => reply(answer)) as never);
    }
    return server;
  };
  const [client, serverEnd] = InMemoryTransport.createLinkedPair();
  serveStdio(build, { transport: serverEnd });
  // The client's end of the pair has the shape of a channel; the library types its messages more narrowly.
  return client as unknown as McpChannel;
}

/** A weather server with three tools: `get_forecast`, `lookup_station` and `set_units`. */
export function weatherServer(): McpChannel {
  return serve("weather", [
    ["get_forecast", "Five-day forecast for a city", CITY, "Lisbon: sunny, 24 C"],
    ["lookup_station", "Find the nearest weather station", CITY, "Station LPPT, 8 km"],
    ["set_units", "Switch between Celsius and Fahrenheit", UNITS, "Units set"],
  ]);
}

/** An orders server with one tool, `order_status`, which says order A-1 shipped. */
export function ordersServer(): McpChannel {
  return serve("orders", [["order_status", "Look up an order's status", ORDER, "order A-1: shipped"]]);
}
