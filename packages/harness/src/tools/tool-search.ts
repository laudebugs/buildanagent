/**
 * Tool search: how a model finds a deferred tool and has it sent from the next request on. The tool names the matches,
 * and the interceptor turns the names it recorded into `activeTools`, so a deferred tool is absent until it is asked for.
 */
import type { Interceptors, ToolDefinition } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import type { RegisteredTool, ToolRegistry } from "./types.js";

const DEFAULT_MAX_RESULTS = 5;
// Words that match nearly every description, so they would make every deferred tool a candidate.
const STOP_WORDS = new Set(["the", "for", "and", "with", "that", "this", "from", "are", "you", "your", "use", "can"]);

/** The options of `toolSearchTool()`. */
export interface ToolSearchOptions {
  /** Where the tool records the names it activates. Pass the same set to `toolSearchInterceptors()`. */
  readonly activated: Set<string>;
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
    haystack.some(
      (have) => have.length >= 3 && !STOP_WORDS.has(have) && (have.startsWith(word) || word.startsWith(have)),
    );
  return new Set(query.filter(matches)).size;
}

/**
 * A tool's score for a query. A tool with untrusted output, such as an MCP tool, is scored on its name and alias, and its
 * description adds at most one match, so a server that stuffs a description with keywords can't outrank every tool.
 */
function scoreFor(wanted: readonly string[], tool: RegisteredTool): number {
  const named = words(`${tool.name} ${tool.alias ?? ""}`);
  const described = words(tool.definition.description);
  if (tool.outputTrust === "trusted") return scoreOf(wanted, [...named, ...described]);
  return scoreOf(wanted, named) + Math.min(1, scoreOf(wanted, described));
}

/** The best matches, at most `max`, and at most half of them, rounded down but at least one, from one untrusted source. */
function best(matches: readonly { tool: RegisteredTool; score: number }[], max: number) {
  const perSource = Math.max(1, Math.floor(max / 2));
  const taken = new Map<string, number>();
  const kept: { tool: RegisteredTool; score: number }[] = [];
  for (const match of matches) {
    if (kept.length === max) break;
    const source = match.tool.source;
    if (match.tool.outputTrust === "untrusted") {
      const count = taken.get(source) ?? 0;
      if (count >= perSource) continue;
      taken.set(source, count + 1);
    }
    kept.push(match);
  }
  return kept;
}

/** One line of the search's result. An untrusted tool's description is the server's text, so only its name is given. */
function lineOf(tool: RegisteredTool): string {
  if (tool.outputTrust === "trusted") return `- ${tool.canonicalName}: ${tool.definition.description}`;
  return `- ${tool.canonicalName} (from ${tool.source}; its own description comes with its definition)`;
}

/**
 * The `tool_search` tool: it searches the registry's `deferred` tools by the words of a query, records the best
 * matches in `options.activated` and tells the model their names, plus the descriptions of trusted tools. `hidden`
 * tools are never found, because hiding one means the model should not learn it exists. Results are in registration order among equal scores.
 */
export function toolSearchTool(
  registry: ToolRegistry,
  options: ToolSearchOptions,
): ToolDefinition<{ query: string }, { activated: string[] }, unknown> {
  if (!(options?.activated instanceof Set)) {
    throw new HarnessError("invalid_tool_registration", "toolSearchTool() needs an activated set");
  }
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
      const ranked = registry
        .list()
        .filter((tool) => tool.exposure === "deferred")
        // The name it was registered under, not the canonical one, so `mcp` and the server's name match nothing by themselves.
        .map((tool) => ({ tool, score: scoreFor(wanted, tool) }))
        .filter((match) => match.score > 0)
        .sort((a, b) => b.score - a.score);
      const matches = best(ranked, max);
      const activated = matches.map(({ tool }) => tool.canonicalName);
      for (const name of activated) options.activated.add(name);
      const text =
        activated.length === 0
          ? `No tool matches "${query}". Try other words.`
          : `These tools are available on your next step:\n${matches.map(({ tool }) => lineOf(tool)).join("\n")}`;
      return { content: [{ type: "text", text }], structured: { activated } };
    },
  };
}

/**
 * The interceptor that sends what tool search activated. Each model call's `activeTools` is the run's tools, plus
 * `tool_search`, plus the activated names the registry holds. Register `toolSearchTool()` in the registry first, then
 * take `registry.definitions()` after the last registration, because the SDK throws when `activeTools` names a tool the
 * run does not hold. Pass the same set to the tool, and a new one for each run.
 */
export function toolSearchInterceptors(registry: ToolRegistry, activated: ReadonlySet<string>): Interceptors {
  if (!registry.list().some((tool) => tool.canonicalName === "tool_search")) {
    throw new HarnessError(
      "invalid_tool_registration",
      "toolSearchInterceptors() needs the registry to hold the tool_search tool under that name, because every request sends it by that name",
    );
  }
  return {
    beforeModelCall: ({ context }) => {
      const known = new Set(registry.list().map((tool) => tool.canonicalName));
      const held = [...activated].filter((name) => known.has(name));
      // The search tool is always sent, so a source set to deferred or hidden can't leave the model with no way to find a tool.
      return { activeTools: [...new Set([...context.tools.map((tool) => tool.name), ...held, "tool_search"])] };
    },
  };
}
