/**
 * Tool search: how a model finds a deferred tool and has it sent from the next request on. The tool names the matches,
 * and the interceptor turns the names it recorded into `activeTools`, so a deferred tool is absent until it is asked for.
 */
import type { Interceptors, ToolDefinition } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import type { ToolRegistry } from "./types.js";

const DEFAULT_MAX_RESULTS = 5;
// Words that match nearly every description, so they would make every deferred tool a candidate.
const STOP_WORDS = new Set(["the", "for", "and", "with", "that", "this", "from", "are", "you", "your", "use", "can"]);

/** The options of `toolSearchTool()`. */
export interface ToolSearchOptions {
  /** Where the tool records the names it activates. Pass the same set to `toolSearchInterceptors()`. */
  readonly activated?: Set<string>;
  /** The most tools one search activates. Default 5. */
  readonly maxResults?: number;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "");
}

/**
 * How many of the query's words match a word of a tool's name, alias or description. A word matches when one begins
 * with the other, so `issue` finds `issues`, and a word of under three letters, such as `an`, matches nothing.
 */
function scoreOf(query: readonly string[], haystack: readonly string[]): number {
  // A repeated word counts once, so repeating one cannot outrank a tool that matches more of what was asked.
  const matches = (word: string) =>
    word.length >= 3 &&
    !STOP_WORDS.has(word) &&
    haystack.some((have) => have.length >= 3 && (have.startsWith(word) || word.startsWith(have)));
  return new Set(query.filter(matches)).size;
}

/**
 * The `tool_search` tool: it searches the registry's `deferred` tools by the words of a query, records the best
 * matches in `options.activated` and tells the model their names and descriptions. `hidden` tools are never found,
 * because hiding one means the model should not learn it exists. Results are in registration order among equal scores.
 */
export function toolSearchTool(
  registry: ToolRegistry,
  options: ToolSearchOptions = {},
): ToolDefinition<{ query: string }, { activated: string[] }, unknown> {
  const max = options.maxResults ?? DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(max) || max < 1) {
    throw new HarnessError(
      "invalid_tool_registration",
      `toolSearchTool() needs a maxResults of 1 or more, got ${String(max)}`,
    );
  }
  return {
    name: "tool_search",
    description:
      "Find a tool you do not have yet. Describe what you need in a few words, and the matching tools become available on your next step.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "What the tool should do, in a few words." } },
      required: ["query"],
    },
    async execute({ query }) {
      const wanted = words(query);
      const matches = registry
        .list()
        .filter((tool) => tool.exposure === "deferred")
        .map((tool) => ({
          tool,
          // The tool's own name, not the canonical one, so `mcp` and the server's name match nothing by themselves.
          score: scoreOf(wanted, words(`${tool.definition.name} ${tool.alias ?? ""} ${tool.definition.description}`)),
        }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max);
      const activated = matches.map(({ tool }) => tool.canonicalName);
      for (const name of activated) options.activated?.add(name);
      const text =
        activated.length === 0
          ? `No tool matches "${query}". Try other words.`
          : `These tools are available on your next step:\n${matches
              .map(({ tool }) => `- ${tool.canonicalName}: ${tool.definition.description}`)
              .join("\n")}`;
      return { content: [{ type: "text", text }], structured: { activated } };
    },
  };
}

/**
 * The interceptor that sends what tool search activated: each model call's `activeTools` is every `direct` tool plus
 * the names in `activated`. Register `toolSearchTool()` in the registry first, because `activeTools` is the complete list a
 * request sends and the interceptor throws a `HarnessError` otherwise. Pass the same set to the tool, and a new one for each run.
 */
export function toolSearchInterceptors(registry: ToolRegistry, activated: ReadonlySet<string>): Interceptors {
  if (registry.get("tool_search") === undefined) {
    throw new HarnessError(
      "invalid_tool_registration",
      "toolSearchInterceptors() needs the registry to hold the tool_search tool, because activeTools is the complete list a request sends",
    );
  }
  // The search tool is always sent, so a source set to deferred or hidden can't leave the model with no way to find a tool.
  return { beforeModelCall: () => ({ activeTools: registry.activeTools(new Set([...activated, "tool_search"])) }) };
}
