/**
 * Pins for MCP tool definitions. A tool's pin is the hash of its definition as a person approved it: `sha256:` and the
 * hex SHA-256 of the canonical JSON (RFC 8785) of `{ name, description, inputSchema }`, the fields the record's tools
 * hash covers. The annotations are left out, because they change nothing the harness does. A diff compares a server's
 * current list with its pins and classifies each tool as unchanged, new, changed or removed.
 */
import { canonicalInputHash } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import type { McpPinStore, McpTool, McpToolState } from "./types.js";

const PIN = /^sha256:[0-9a-f]{64}$/;

/** The hash of one tool's definition, its pin once a person approves it. */
export async function toolPinOf(tool: McpTool): Promise<string> {
  const { name, description, inputSchema } = tool;
  return `sha256:${await canonicalInputHash({ name, description, inputSchema })}`;
}

/** Each tool of `current` and of `pinned`, by name, with how its current definition compares with its pin. */
export function diffTools(
  pinned: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>,
): Map<string, McpToolState> {
  const states = new Map<string, McpToolState>();
  for (const [name, hash] of current) {
    const pin = pinned.get(name);
    states.set(name, pin === undefined ? "new" : pin === hash ? "unchanged" : "changed");
  }
  for (const name of pinned.keys()) if (!current.has(name)) states.set(name, "removed");
  return states;
}

/** Checks pins a store returned, so a corrupt entry is refused and not compared. */
export function checkPins(server: string, pins: unknown): Map<string, string> {
  if (typeof pins !== "object" || pins === null || Array.isArray(pins)) {
    throw new HarnessError("invalid_mcp_config", `the pins of the MCP server "${server}" are not an object`);
  }
  const checked = new Map<string, string>();
  for (const [name, hash] of Object.entries(pins)) {
    if (typeof hash !== "string" || !PIN.test(hash)) {
      throw new HarnessError("invalid_mcp_config", `a pin of the MCP server "${server}" is not a sha256 hash`);
    }
    checked.set(name, hash);
  }
  return checked;
}

/** A pin store in memory, for a host that keeps approvals for the life of the process, and for tests. */
export function memoryMcpPinStore(
  initial: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
): McpPinStore {
  const servers = new Map(Object.entries(initial).map(([server, pins]) => [server, { ...pins }]));
  return {
    async read(server) {
      const pins = servers.get(server);
      return pins === undefined ? undefined : { ...pins };
    },
    async write(server, pins) {
      servers.set(server, { ...pins });
    },
  };
}
