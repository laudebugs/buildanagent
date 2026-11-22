/**
 * The registry's types: where a tool comes from, how the model reaches it, and what the harness records about it. The
 * registry holds one `RegisteredTool` per tool of every source, so permission rules, tool search and the session log
 * read one description of each.
 */
import type { ToolDefinition } from "@buildanagent/sdk";

/** Where a tool comes from: the harness, an in-process extension, one MCP server (`mcp:<server>`) or the client. */
export type ToolSource = "builtin" | "extension" | `mcp:${string}` | "client";

/** How a tool's code is reached: in this process, or by asking the client through a `tool/call` server request. */
export type HostPattern = "in_process" | "client_request";

/** Whether a request sends the tool: `direct` always, `deferred` once tool search names it, `hidden` only when named. */
export type ToolExposure = "direct" | "deferred" | "hidden";

/** Whether a tool's output may carry instructions an attacker wrote. */
export type OutputTrust = "trusted" | "untrusted";

/** Which approvals may cover later calls: a sticky one, a grouped one, both, or none, so each call asks. */
export type ApprovalReuse = "sticky" | "group" | "both" | "none";

/** A tool as the registry holds it, with its canonical name and every default resolved. */
export interface RegisteredTool {
  /** The name every request, permission rule and log entry uses. */
  readonly canonicalName: string;
  /** The name the tool was registered under, before any namespace or hash. */
  readonly name: string;
  /** A native or display name that a rule may match too. It never replaces the canonical name. */
  readonly alias?: string;
  readonly source: ToolSource;
  readonly pattern: HostPattern;
  readonly exposure: ToolExposure;
  /** `untrusted` for an MCP tool and a tool that calls a remote agent, `trusted` otherwise, unless the tool declares it. */
  readonly outputTrust: OutputTrust;
  /** Defaults to `both`. */
  readonly approvalReuse: ApprovalReuse;
  /** True for a tool that calls a remote agent, whose replies are untrusted input. */
  readonly remoteAgent: boolean;
  readonly definition: ToolDefinition<unknown, unknown, unknown>;
}

/** What `register()` takes: the tool, where it comes from, and any default it overrides. */
export interface ToolRegistration {
  /** The name the source knows the tool by. For an MCP tool it is the server's tool name, which the registry namespaces. */
  readonly name: string;
  readonly source: ToolSource;
  /** Defaults to `in_process`. */
  readonly pattern?: HostPattern;
  readonly alias?: string;
  /** Defaults to the source's exposure, which is `deferred` for MCP and `direct` for every other source. */
  readonly exposure?: ToolExposure;
  /** Defaults by source, as `RegisteredTool.outputTrust` says. */
  readonly outputTrust?: OutputTrust;
  /** Set it for a tool that calls a remote agent, so its output defaults to `untrusted`. */
  readonly remoteAgent?: boolean;
  readonly approvalReuse?: ApprovalReuse;
  /** Lets an extension, client or other non-MCP tool replace a built-in of the same name. It replaces nothing else. */
  readonly override?: boolean;
  readonly definition: ToolDefinition<unknown, unknown, unknown>;
}

/**
 * Wraps one registered tool's definition for a turn: a write cap, shadow mode or a sandbox binding, with the turn's
 * host context. The registry sets the result's name and exposure, so a wrapper can't rename a tool or expose it.
 */
export type ToolWrapper<H = unknown> = (
  tool: RegisteredTool,
  hostContext: H,
) => ToolDefinition<unknown, unknown, unknown>;

/** The options of `preambleTokens()`. */
export interface PreambleOptions {
  /** The system prompt, counted with the tool definitions. Left out, only the tools count. */
  readonly system?: string;
}

/** One registry for the tools of every source. */
export interface ToolRegistry {
  /**
   * Adds a tool and returns it as registered. Throws a `DuplicateToolError` when the canonical name or alias is
   * taken, and a `HarnessError`, code `invalid_tool_registration`, for a name, source or option that is unusable. An
   * MCP tool whose server or tool name needs cleaning, holds `__`, starts or ends with `_`, or runs past 64 characters gets a hash of its source
   * and name in its canonical name, so the name depends on the tool alone. Only a final name that is still taken throws.
   */
  register(tool: ToolRegistration): RegisteredTool;
  /**
   * Registers every tool in the list, or none of them: when one registration throws, the tools registered before it in
   * the list are removed again and the error is thrown. Returns the tools as registered, in the list's order.
   */
  registerAll(tools: readonly ToolRegistration[]): RegisteredTool[];
  /** The tool with this canonical name or alias, or `undefined`. */
  get(name: string): RegisteredTool | undefined;
  /** Every tool, in registration order. A replaced built-in keeps its place. */
  list(): readonly RegisteredTool[];
  /**
   * Sets the exposure of every tool of `source`, and of each one registered after. An explicit exposure on a tool is
   * replaced. A run keeps the exposure `definitions()` gave its tools, so take `definitions()` again for the next run.
   * A `RegisteredTool` that `register()` or `get()` returned earlier is a snapshot, so call `get()` again to read the
   * current exposure.
   */
  setExposure(source: ToolSource, exposure: ToolExposure): void;
  /**
   * The definitions for one turn, for `RunOptions.tools`, in registration order so the cached prefix never moves when
   * a tool activates. Each tool goes through `wrap`, which defaults to the tool's own definition.
   */
  definitions<H = undefined>(wrap?: ToolWrapper<H>, hostContext?: H): ToolDefinition<unknown, unknown, unknown>[];
  /**
   * The registry's own tools a request sends: every `direct` tool and every tool named in `activated`, in
   * registration order, and a name the registry doesn't hold is left out. It is not the complete list when the run also
   * has tools from outside the registry, so `toolSearchInterceptors()` builds its list from the request instead.
   */
  activeTools(activated: ReadonlySet<string>): string[];
  /**
   * An estimate of the tokens a request carries before any message: the system prompt and every `direct` tool. A
   * tool whose schema can't describe itself counts as an empty object schema.
   */
  preambleTokens(options?: PreambleOptions): number;
}
