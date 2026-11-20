/**
 * `scriptedMcpServer()`: a strict double for the tools an MCP server lends an agent. Each tool is defined the way a
 * client would define a server's tool (a namespaced name, a schema known only at run time, not first-party) and plays
 * scripted results, so a test covers how the loop treats tools it doesn't control without starting a server.
 */
import { assertCanonicalName } from "@buildanagent/gateway";
import { SdkError } from "../errors.js";
import type { MaybePromise } from "../hooks.js";
import type { JsonSchema, ToolDefinition, ToolResult } from "../tools/types.js";

/** One scripted result: a fixed result, or a function that builds one from the call's input. */
export type ScriptedToolStep = ToolResult | ((input: unknown) => MaybePromise<ToolResult>);

/** One tool the scripted server offers. */
export interface ScriptedMcpTool {
  /** The tool's name on the server; the agent sees `mcp__<server>__<name>`. */
  readonly name: string;
  readonly description?: string;
  /** The tool's input schema as the server sends it. */
  readonly inputSchema: JsonSchema;
  /** One result per call, in order. */
  readonly results: readonly ScriptedToolStep[];
}

/** What `scriptedMcpServer()` takes. */
export interface ScriptedMcpServerOptions {
  /** The server's name, used in each tool's namespaced name. */
  readonly name: string;
  readonly tools: readonly ScriptedMcpTool[];
}

/** One call a scripted tool received. */
export interface ScriptedMcpCall {
  /** The namespaced tool name, such as `mcp__docs__search`. */
  readonly tool: string;
  /** The validated input. */
  readonly input: unknown;
}

/** The server's tools, to pass to `run()`, and what they saw. */
export interface ScriptedMcpServer {
  readonly tools: readonly ToolDefinition[];
  /** Every call so far, across the server's tools, in the order they ran. */
  readonly calls: readonly ScriptedMcpCall[];
  /** Throws if a scripted result was never used, or if a tool was called more often than its script allows. */
  assertComplete(): void;
}

interface ToolState {
  readonly name: string;
  readonly results: readonly ScriptedToolStep[];
  used: number;
  overRuns: number;
}

function checkName(name: string): void {
  try {
    assertCanonicalName(name);
  } catch (cause) {
    throw new SdkError("invalid_tool_definition", cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

// A plain frozen definition rather than `defineTool()`, which would load the schema validator into the testing
// export; `run()` checks the definition and compiles its schema when the run starts.
function scriptedTool(
  server: string,
  spec: ScriptedMcpTool,
  state: ToolState,
  calls: ScriptedMcpCall[],
): ToolDefinition {
  checkName(state.name);
  return Object.freeze({
    name: state.name,
    description: spec.description ?? `${spec.name} from the ${server} server`,
    kind: "dynamic",
    firstParty: false,
    inputSchema: spec.inputSchema,
    async execute(input) {
      calls.push({ tool: state.name, input });
      const step = state.results[state.used];
      if (step === undefined) {
        state.overRuns += 1;
        throw new Error(`${state.name}: call ${state.used + state.overRuns} has no scripted result`);
      }
      state.used += 1;
      return typeof step === "function" ? step(input) : step;
    },
  } satisfies ToolDefinition);
}

/**
 * Builds the tools of a scripted MCP server. Each is named `mcp__<server>__<tool>`, has `kind: "dynamic"` and
 * `firstParty: false`, so its annotations never change scheduling, and returns its scripted results one call at a
 * time. A call past the last result throws, which the model reads as an `execution_error` result, and
 * `assertComplete()` then throws. Throws an `SdkError` with code `invalid_tool_definition` for a name that breaks the
 * tool-name rule once namespaced; `run()` checks the rest of each definition, its schema included, when it starts.
 */
export function scriptedMcpServer(options: ScriptedMcpServerOptions): ScriptedMcpServer {
  const calls: ScriptedMcpCall[] = [];
  const states = options.tools.map((spec) => ({
    spec,
    state: { name: `mcp__${options.name}__${spec.name}`, results: [...spec.results], used: 0, overRuns: 0 },
  }));
  const tools = states.map(({ spec, state }) => scriptedTool(options.name, spec, state, calls));
  return {
    tools,
    calls,
    assertComplete(): void {
      for (const { state } of states) {
        if (state.overRuns > 0) {
          throw new Error(`${state.name}: called ${state.overRuns} more time(s) than scripted`);
        }
        const unused = state.results.length - state.used;
        if (unused > 0) throw new Error(`${state.name}: ${unused} of ${state.results.length} results were never used`);
      }
    },
  };
}
