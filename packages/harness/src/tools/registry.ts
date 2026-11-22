/**
 * `createToolRegistry()`: one registry for the tools of every source. It names each tool once, at registration, refuses
 * duplicates, sets exposure per source, and hands the run its definitions in an order that does not move.
 */
import { estimateInputTokens, isCanonicalName, type WireTool } from "@buildanagent/gateway";
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import { DuplicateToolError } from "./errors.js";
import type {
  ApprovalReuse,
  HostPattern,
  OutputTrust,
  PreambleOptions,
  RegisteredTool,
  ToolExposure,
  ToolRegistration,
  ToolRegistry,
  ToolSource,
  ToolWrapper,
} from "./types.js";

const MAX_NAME = 64;
const PATTERNS: readonly string[] = ["in_process", "client_request"];
const EXPOSURES: readonly string[] = ["direct", "deferred", "hidden"];
const TRUSTS: readonly string[] = ["trusted", "untrusted"];
const REUSES: readonly string[] = ["sticky", "group", "both", "none"];
const PLAIN_SOURCES: readonly string[] = ["builtin", "extension", "client"];

function invalid(why: string): never {
  throw new HarnessError("invalid_tool_registration", `a tool registration ${why}`);
}

function checkOneOf(field: string, value: unknown, allowed: readonly string[]): void {
  if (value !== undefined && !(typeof value === "string" && allowed.includes(value))) {
    invalid(`has a ${field} of ${JSON.stringify(value)}, which must be one of ${allowed.join(", ")}`);
  }
}

function isMcp(source: ToolSource): source is `mcp:${string}` {
  return source.startsWith("mcp:");
}

function checkSource(source: unknown): asserts source is ToolSource {
  const ok =
    typeof source === "string" &&
    (PLAIN_SOURCES.includes(source) || (source.startsWith("mcp:") && source.length > "mcp:".length));
  if (!ok)
    invalid(`has a source of ${JSON.stringify(source)}, which must be builtin, extension, client or mcp:<server>`);
}

/** Checks a registration's fields, so a typo fails here and not when a request is built. */
function check(tool: ToolRegistration): void {
  if (typeof tool?.name !== "string" || tool.name === "") invalid("needs a non-empty name");
  checkSource(tool.source);
  checkOneOf("pattern", tool.pattern, PATTERNS);
  checkOneOf("exposure", tool.exposure, EXPOSURES);
  checkOneOf("outputTrust", tool.outputTrust, TRUSTS);
  checkOneOf("approvalReuse", tool.approvalReuse, REUSES);
  if (tool.alias !== undefined && (typeof tool.alias !== "string" || tool.alias === "")) invalid("has a blank alias");
  if (typeof (tool.definition as Partial<ToolDefinition> | undefined)?.execute !== "function") {
    invalid("needs a definition from defineTool(), whose execute is a function");
  }
}

// FNV-1a, 32 bits, as 8 hex digits: deterministic on every runtime and synchronous, which a collision suffix needs. It
// tells names apart and guards nothing, so it is not a cryptographic hash.
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

const clean = (part: string): string => part.replace(/[^A-Za-z0-9_-]/g, "_");
// A part with letters, digits and hyphens, joined by single underscores, can't be mistaken for two parts by the `__` between them.
const PLAIN_PART = /^[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*$/;

/** `base`, or `base` cut to fit with `_<hash>` after it, when a suffix is needed or the name is too long. */
function suffixed(base: string, source: string, name: string): string {
  const suffix = `_${shortHash(`${source}\u0000${name}`)}`;
  return `${base.slice(0, MAX_NAME - suffix.length)}${suffix}`;
}

interface Entry {
  tool: RegisteredTool;
  name: string;
}

function trustOf(registration: ToolRegistration): OutputTrust {
  if (registration.outputTrust !== undefined) return registration.outputTrust;
  return isMcp(registration.source) || registration.remoteAgent === true ? "untrusted" : "trusted";
}

/** A wire description of a tool, enough to count its tokens. A Standard Schema describes itself; one that can't gives an empty object schema. */
function wireOf(definition: ToolDefinition<unknown, unknown, unknown>): WireTool {
  const schema = definition.inputSchema as unknown as Record<string, unknown>;
  const standard = schema["~standard"] as { jsonSchema?: { input?(options: { target: string }): unknown } } | undefined;
  const described = standard === undefined ? schema : standard.jsonSchema?.input?.({ target: "draft-2020-12" });
  const inputSchema = described ?? { type: "object" };
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: inputSchema as Record<string, unknown>,
  };
}

class Registry implements ToolRegistry {
  readonly #entries: Entry[] = [];
  readonly #exposures = new Map<string, ToolExposure>();

  register(registration: ToolRegistration): RegisteredTool {
    check(registration);
    const { name, source } = registration;
    const canonicalName = this.#canonicalFor(registration);
    const existing = this.#entries.findIndex((entry) => entry.tool.canonicalName === canonicalName);
    const replaces = existing >= 0 ? this.#entries[existing] : undefined;
    if (replaces !== undefined && !this.#mayReplace(registration, replaces)) {
      throw new DuplicateToolError(canonicalName, `${replaces.tool.source} already holds it`);
    }
    this.#checkNameAgainstAliases(canonicalName, replaces);
    this.#checkAlias(registration.alias, canonicalName, replaces);
    const tool: RegisteredTool = {
      canonicalName,
      ...(registration.alias === undefined ? {} : { alias: registration.alias }),
      source,
      pattern: (registration.pattern ?? "in_process") as HostPattern,
      exposure: registration.exposure ?? this.#exposures.get(source) ?? (isMcp(source) ? "deferred" : "direct"),
      outputTrust: trustOf(registration),
      approvalReuse: (registration.approvalReuse ?? "both") as ApprovalReuse,
      remoteAgent: registration.remoteAgent === true,
      definition: registration.definition,
    };
    if (replaces === undefined) this.#entries.push({ tool, name });
    else this.#entries[existing] = { tool, name };
    return tool;
  }

  get(name: string): RegisteredTool | undefined {
    const byName = this.#entries.find((entry) => entry.tool.canonicalName === name);
    return (byName ?? this.#entries.find((entry) => entry.tool.alias === name))?.tool;
  }

  list(): readonly RegisteredTool[] {
    return this.#entries.map((entry) => entry.tool);
  }

  setExposure(source: ToolSource, exposure: ToolExposure): void {
    checkSource(source);
    checkOneOf("exposure", exposure, EXPOSURES);
    this.#exposures.set(source, exposure);
    this.#entries.forEach((entry, index) => {
      if (entry.tool.source === source) this.#entries[index] = { ...entry, tool: { ...entry.tool, exposure } };
    });
  }

  definitions<H = undefined>(wrap?: ToolWrapper<H>, hostContext?: H): ToolDefinition<unknown, unknown, unknown>[] {
    if (wrap !== undefined && typeof wrap !== "function") invalid("needs a wrapper that is a function");
    return this.#entries.map(({ tool }) => {
      const wrapped = wrap === undefined ? tool.definition : wrap(tool, hostContext as H);
      // The registry has the last word on the name and the exposure, so a wrapper can't rename or expose a tool.
      return defineTool<unknown, unknown, unknown>({ ...wrapped, name: tool.canonicalName, exposure: tool.exposure });
    });
  }

  activeTools(activated: ReadonlySet<string>): string[] {
    return this.#entries
      .filter(({ tool }) => tool.exposure === "direct" || activated.has(tool.canonicalName))
      .map(({ tool }) => tool.canonicalName);
  }

  preambleTokens(options: PreambleOptions = {}): number {
    const tools = this.#entries.filter(({ tool }) => tool.exposure === "direct");
    const wire = tools.map(({ tool }) => wireOf({ ...tool.definition, name: tool.canonicalName }));
    return estimateInputTokens({ system: options.system ?? "", messages: [], tools: wire });
  }

  /**
   * The canonical name: an MCP tool is namespaced, and any other name is used as it is. A part that needs cleaning, or
   * holds `__` and so could blur the namespace, adds a hash of the source and name, so a name depends on its tool and
   * never on what was registered before it.
   */
  #canonicalFor({ name, source }: ToolRegistration): string {
    if (!isMcp(source)) {
      if (!isCanonicalName(name)) {
        invalid(`has the name ${JSON.stringify(name)}, which must be 1 to 64 characters from A-Z, a-z, 0-9, _ and -`);
      }
      return name;
    }
    const server = source.slice("mcp:".length);
    const base = `mcp__${clean(server)}__${clean(name)}`;
    const plain = PLAIN_PART.test(server) && PLAIN_PART.test(name) && base.length <= MAX_NAME;
    const canonical = plain ? base : suffixed(base, source, name);
    const taken = this.#entries.find((entry) => entry.tool.canonicalName === canonical);
    if (taken === undefined) return canonical;
    const same = taken.tool.source === source && taken.name === name;
    throw new DuplicateToolError(
      canonical,
      same ? `${source} already registered a tool named "${name}"` : "a hash suffix collided",
    );
  }

  /** Whether `registration` may take the place of `existing`: only a non-MCP tool that says so, over a built-in. */
  #mayReplace(registration: ToolRegistration, existing: Entry): boolean {
    return registration.override === true && existing.tool.source === "builtin" && registration.source !== "builtin";
  }

  /** A new canonical name may not equal another tool's alias, or `get()` would find the wrong tool. */
  #checkNameAgainstAliases(canonicalName: string, replaces: Entry | undefined): void {
    const clash = this.#entries.find((entry) => entry !== replaces && entry.tool.alias === canonicalName);
    if (clash !== undefined)
      throw new DuplicateToolError(canonicalName, `${clash.tool.canonicalName} uses it as an alias`);
  }

  /** An alias is unique among aliases, and no tool's canonical name is another tool's alias. */
  #checkAlias(alias: string | undefined, canonicalName: string, replaces: Entry | undefined): void {
    if (alias === undefined) return;
    const others = this.#entries.filter((entry) => entry !== replaces);
    const clash = others.find((entry) => entry.tool.canonicalName === alias || entry.tool.alias === alias);
    if (clash !== undefined || alias === canonicalName) {
      throw new DuplicateToolError(alias, "another tool already uses it as a name or an alias");
    }
  }
}

/** Creates an empty registry. */
export function createToolRegistry(): ToolRegistry {
  return new Registry();
}
