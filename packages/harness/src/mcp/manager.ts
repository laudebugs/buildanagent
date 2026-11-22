/**
 * `createMcpManager()`: the MCP client as one removable component. It connects each server on its own, so one slow or
 * broken server never holds back the others, and registers each server's tools with the registry under the source
 * `mcp:<name>`, which names them `mcp__<name>__<tool>` and defers them by default.
 *
 * A server's tools are registered all or none: the list is checked, then registered through `registerAll()`, which
 * removes the tools it added when any one is refused, so a list the registry would refuse halfway leaves nothing
 * behind. Every tool is marked as not first-party and as a write, whatever its annotations say, so a server's
 * `readOnlyHint` can't make the loop run its calls together or run one again after a crash. The calls reach the server
 * only through the turn's tool pipeline, so the permission gate and the write cap apply to them as to any tool.
 *
 * Servers connect in the background, and everything that changes a session's tools waits for a turn boundary:
 * `beginTurn()` registers the servers that connected since the last turn, sets which tools may run, and writes a
 * notice of what changed. A tool runs only while its server's current definition matches its pin, so a server that
 * changes a tool after it was approved gets the tool disabled at the next turn, never mid-turn, and never silently.
 */
import { defineTool, type ToolDefinition } from "@buildanagent/sdk";
import { HarnessError } from "../errors.js";
import type { ExtensionLoadedRecord } from "../extensions/types.js";
import type { HookDecision, PermissionHook } from "../permissions/types.js";
import type { ToolRegistration } from "../tools/types.js";
import { checkServerConfig, connectMcpServer, systemTimers } from "./connection.js";
import { safeSchema } from "./content.js";
import { McpError } from "./errors.js";
import { checkPins, toolPinOf } from "./pins.js";
import { mcpRecordOf } from "./record.js";
import type {
  McpConnection,
  McpManager,
  McpManagerOptions,
  McpPendingTool,
  McpServerConfig,
  McpServerStatus,
  McpTimers,
  McpTool,
} from "./types.js";

// A placeholder that passes defineTool()'s name check; the registry names every tool by its canonical name.
const PLACEHOLDER_NAME = "mcp_tool";
const DEFAULT_DIRECT_WAIT_MS = 10_000;
const DEFAULT_RELIST_INTERVAL_MS = 2_000;
// The most lines one notice holds; the rest are counted, so a server that changes many tools can't flood a turn.
const MAX_NOTICE_LINES = 20;
const MAX_TIMER_MS = 2 ** 31 - 1;

/** One tool as its server lists it now, with the hash of its definition. */
interface Listed {
  readonly tool: McpTool;
  readonly hash: string;
}

/** What a turn was last told about one registered tool. */
type Label = "enabled" | "new" | "changed" | "removed" | "unreadable" | "stale";

/** One server's state for the life of the manager. */
interface ServerState {
  readonly config: McpServerConfig;
  status: "connecting" | "connected" | "registered" | "failed";
  done: Promise<void>;
  connection?: McpConnection;
  error?: Error;
  /** The approved hash of each tool, by its name on the server. */
  pinned: Map<string, string>;
  /** The server's current list. */
  latest: Map<string, Listed>;
  /** True while the newest re-read of the list failed, so no current definition is known. */
  unreadable: boolean;
  /** The registrations built at connect, registered at the next turn boundary. */
  staged?:
    | {
        readonly registrations: readonly ToolRegistration[];
        readonly record: ExtensionLoadedRecord;
        /** Each staged tool's definition hash, taken from the same list the registrations were built from. */
        readonly hashes: ReadonlyMap<string, string>;
      }
    | undefined;
  /** Each registered tool's canonical name, by its name on the server, in registration order. */
  registered: Map<string, string>;
  /** The hash of each registered tool's definition as registered: the one the model reads for the whole session. */
  registeredHash: Map<string, string>;
  /** The tools that may run this turn, by name on the server. Replaced only at a turn boundary. */
  enabled: ReadonlySet<string>;
  announced: Map<string, Label>;
  /** How many tools the server added mid-session, as last announced. */
  announcedAdded: number;
  relist: { timer: unknown; running: boolean; dirty: boolean; last: number };
  pinWrites: Promise<void>;
}

/** The definition of one server tool. Its `execute` refuses a disabled tool and calls the rest by their listed name. */
function definitionOf(
  state: ServerState,
  connection: McpConnection,
  tool: McpTool,
): ToolDefinition<unknown, unknown, unknown> {
  return defineTool<unknown, unknown, unknown>({
    name: PLACEHOLDER_NAME,
    description: tool.description,
    kind: "dynamic",
    // The server's own schema runs no regular expression here: see safeSchema().
    inputSchema: safeSchema(tool.inputSchema) as Readonly<Record<string, unknown>>,
    firstParty: false,
    // A server's hints are claims by code the harness does not control, so every call is treated as a write.
    effect: { kind: "write" },
    async execute(input, ctx) {
      if (!state.enabled.has(tool.name)) {
        throw new McpError(
          "mcp_call_failed",
          state.config.name,
          "the tool is disabled: its definition is new, changed or gone since it was pinned, and no person has approved it",
          { failure: "disabled" },
        );
      }
      const result = await connection.callTool(tool.name, input, ctx.signal);
      return { content: result.content, ...(result.isError ? { isError: true } : {}) };
    },
  });
}

/** The server's registrations, built before any is registered, so a tool the SDK refuses fails the whole list. */
function registrationsOf(state: ServerState, connection: McpConnection, tools: readonly McpTool[]) {
  const { config } = state;
  return tools.map((tool): ToolRegistration => {
    try {
      return {
        name: tool.name,
        source: `mcp:${config.name}`,
        ...(config.exposure === undefined ? {} : { exposure: config.exposure }),
        definition: definitionOf(state, connection, tool),
      };
    } catch (error) {
      throw refused(config.name, error);
    }
  });
}

function refused(server: string, error: unknown): McpError {
  const why = error instanceof Error ? error.message : String(error);
  return new McpError(
    "mcp_tool_list_refused",
    server,
    `its tool list was refused, so none of its tools was registered: ${why}`,
    { cause: error },
  );
}

function checkServers(servers: readonly McpServerConfig[]): void {
  if (!Array.isArray(servers)) throw new HarnessError("invalid_mcp_config", "servers must be a list");
  const names = new Set<string>();
  for (const config of servers) {
    checkServerConfig(config);
    const key = config.name.toLowerCase();
    if (names.has(key)) {
      throw new HarnessError("invalid_mcp_config", `two MCP servers are named "${config.name}", in some letter case`);
    }
    names.add(key);
  }
}

function wait(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!(Number.isInteger(value) && value >= 0 && value <= MAX_TIMER_MS)) {
    throw new HarnessError(
      "invalid_mcp_config",
      `${name} must be a whole number of milliseconds from 0 to ${MAX_TIMER_MS}`,
    );
  }
  return value;
}

/** The hashes of a list, by tool name. */
async function listedOf(tools: readonly McpTool[]): Promise<Map<string, Listed>> {
  const hashes = await Promise.all(tools.map(toolPinOf));
  return new Map(tools.map((tool, index) => [tool.name, { tool, hash: hashes[index] as string }]));
}

/** The label a registered tool has now. */
function labelOf(state: ServerState, name: string): Label {
  if (state.enabled.has(name)) return "enabled";
  if (state.unreadable) return "unreadable";
  const now = state.latest.get(name);
  if (now === undefined) return "removed";
  const pin = state.pinned.get(name);
  if (pin === undefined) return "new";
  return pin === now.hash ? "stale" : "changed";
}

const SENTENCES: Record<Label, string> = {
  enabled: "was approved and may be called again",
  new: "is new on its server and is disabled until a person approves it",
  changed: "changed its definition on its server and is disabled until a person approves it",
  removed: "was removed by its server and is disabled",
  unreadable: "is disabled, because its server's tool list could not be read",
  stale:
    "is disabled for this session, because the definition it was registered with is not the approved one; a new session registers the approved one",
};

/** The notice lines of one server: each tool whose label changed, and the count of tools it added mid-session. */
function noticeLinesOf(state: ServerState, commits: (() => void)[]): string[] {
  const lines: string[] = [];
  for (const [name, canonical] of state.registered) {
    const label = labelOf(state, name);
    if (label === (state.announced.get(name) ?? "enabled")) continue;
    commits.push(() => state.announced.set(name, label));
    lines.push(`- ${canonical} ${SENTENCES[label]}.`);
  }
  const added = state.unreadable ? 0 : [...state.latest.keys()].filter((name) => !state.registered.has(name)).length;
  if (added === state.announcedAdded) return lines;
  commits.push(() => {
    state.announcedAdded = added;
  });
  // The server's name comes from the host's config; the new tools' names are the server's text, so only their number
  // is given.
  if (added > 0) {
    const tools = added === 1 ? "1 tool" : `${added} tools`;
    const them = added === 1 ? "it" : "them";
    lines.push(
      `- The server "${state.config.name}" lists ${tools} this session does not have; a person may approve ${them} for a later session.`,
    );
  }
  return lines;
}

const newState = (config: McpServerConfig): ServerState => ({
  config,
  status: "connecting",
  done: Promise.resolve(),
  pinned: new Map(),
  latest: new Map(),
  unreadable: false,
  registered: new Map(),
  registeredHash: new Map(),
  enabled: new Set(),
  announced: new Map(),
  announcedAdded: 0,
  relist: { timer: undefined, running: false, dirty: false, last: Number.NEGATIVE_INFINITY },
  pinWrites: Promise.resolve(),
});

class Manager implements McpManager {
  readonly #options: McpManagerOptions;
  readonly #timers: McpTimers;
  readonly #directWaitMs: number;
  readonly #relistMs: number;
  readonly #states: ServerState[];
  readonly #records = new Map<string, ExtensionLoadedRecord>();
  // Every connection that exists, registered or not, so a close can end one whose tool list is still being read.
  readonly #open = new Set<McpConnection>();
  readonly #abort = new AbortController();
  #started = false;
  #firstTurnDone = false;
  // What the last notice told, kept back until the turn has written it, so a turn that fails first loses no notice.
  #uncommitted: (() => void)[] = [];
  #connecting: Promise<readonly McpServerStatus[]> | undefined;
  #closing: Promise<void> | undefined;

  constructor(options: McpManagerOptions) {
    this.#options = options;
    this.#timers = options.timers ?? systemTimers;
    this.#directWaitMs = wait("directWaitMs", options.directWaitMs, DEFAULT_DIRECT_WAIT_MS);
    this.#relistMs = wait("relistIntervalMs", options.relistIntervalMs, DEFAULT_RELIST_INTERVAL_MS);
    this.#states = options.servers.map(newState);
  }

  #log(line: string): void {
    try {
      this.#options.log?.(line);
    } catch {
      // A logger that throws must not stop a connect.
    }
  }

  start(): void {
    if (this.#started || this.#options.mcp === false || this.#closing !== undefined) return;
    this.#started = true;
    for (const state of this.#states) state.done = this.#connectOne(state);
  }

  connect(): Promise<readonly McpServerStatus[]> {
    if (this.#closing !== undefined) {
      return Promise.reject(new HarnessError("invalid_mcp_config", "the MCP manager was closed"));
    }
    this.#connecting ??= (async () => {
      if (this.#options.mcp === false) return [];
      this.start();
      // Each server is registered as soon as it connects, so one that hangs holds back no other.
      await Promise.all(this.#states.map((state) => state.done.then(() => this.#registerReady(this.#firstTurnDone))));
      // Every server has connected or failed by now, and registerReady() registered or failed each connected one.
      return this.statuses().filter((status): status is McpServerStatus => status.status !== "connecting");
    })();
    return this.#connecting;
  }

  statuses(): readonly (McpServerStatus | { readonly server: string; readonly status: "connecting" })[] {
    if (this.#options.mcp === false) return [];
    return this.#states.map((state) => {
      const server = state.config.name;
      if (state.status === "failed") return { server, status: "failed", error: state.error as Error };
      if (state.status !== "registered" || state.connection === undefined) return { server, status: "connecting" };
      const names = [...state.registered];
      return {
        server,
        status: "connected",
        era: state.connection.era,
        tools: names.map(([, canonical]) => canonical),
        disabled: names.filter(([name]) => !state.enabled.has(name)).map(([, canonical]) => canonical),
      };
    });
  }

  async #connectOne(state: ServerState): Promise<void> {
    const { config } = state;
    let connection: McpConnection | undefined;
    try {
      connection = await connectMcpServer(config, {
        log: (line) => this.#log(line),
        signal: this.#abort.signal,
        timers: this.#timers,
      });
      this.#open.add(connection);
      // A close that began during the handshake must still end this server.
      if (this.#closing !== undefined) throw new McpError("mcp_connect_failed", config.name, "the manager was closed");
      // A notice that comes while the first list is read is kept, and the list is read again once it is in.
      connection.watchTools(() => this.#scheduleRelist(state));
      const tools = await connection.listTools();
      const registrations = registrationsOf(state, connection, tools);
      let record: ExtensionLoadedRecord;
      let latest: Map<string, Listed>;
      try {
        record = await mcpRecordOf(config, connection, tools);
        latest = await listedOf(tools);
      } catch (error) {
        throw refused(config.name, error);
      }
      const pinned = await this.#pinsOf(config.name, latest);
      if (this.#closing !== undefined) throw new McpError("mcp_connect_failed", config.name, "the manager was closed");
      // The hashes come from the list the registrations were built from, never from a later re-read, so a server that
      // lists another definition before the turn boundary can't make the registered one look approved.
      const hashes = new Map([...latest].map(([name, listed]) => [name, listed.hash]));
      Object.assign(state, {
        connection,
        latest,
        pinned,
        staged: { registrations, record, hashes },
        status: "connected",
      });
      if (state.relist.dirty) this.#scheduleRelist(state);
    } catch (error) {
      if (connection !== undefined) this.#open.delete(connection);
      await connection?.close();
      this.#fail(state, error);
    }
  }

  /** The server's pins: the store's, or the list it gave at connect when the manager has no store. */
  async #pinsOf(server: string, latest: ReadonlyMap<string, Listed>): Promise<Map<string, string>> {
    const store = this.#options.pins;
    if (store === undefined) return new Map([...latest].map(([name, listed]) => [name, listed.hash]));
    const stored = await store.read(server);
    return stored === undefined ? new Map() : checkPins(server, stored);
  }

  #fail(state: ServerState, error: unknown): void {
    const failure = error instanceof Error ? error : new Error(String(error));
    state.status = "failed";
    state.error = failure;
    this.#log(`the MCP server "${state.config.name}" was not connected: ${failure.message}`);
  }

  /**
   * Registers every server that has connected and is not registered yet. `late` is true after the first turn's wait,
   * when a `direct` server is registered as `deferred`, so the tools a request sends never change mid-session.
   */
  #registerReady(late: boolean): void {
    for (const state of this.#states) {
      const staged = state.staged;
      const connection = state.connection;
      if (state.status !== "connected" || staged === undefined || connection === undefined) continue;
      state.staged = undefined;
      try {
        this.#register(state, staged, late && state.config.exposure === "direct");
      } catch (error) {
        this.#open.delete(connection);
        void connection.close();
        this.#fail(state, error);
      }
    }
  }

  #register(state: ServerState, staged: NonNullable<ServerState["staged"]>, demote: boolean): void {
    const { config } = state;
    if (demote) {
      this.#log(`the direct MCP server "${config.name}" connected after the first turn, so its tools are deferred`);
    }
    // Nothing awaits between this check and the registration, so another manager on the same registry can't register
    // the source in between, and registerAll() leaves nothing behind when any tool is refused.
    const source = `mcp:${config.name}`;
    if (this.#options.registry.list().some((tool) => tool.source === source)) {
      throw new McpError("mcp_tool_list_refused", config.name, `the registry already holds tools from ${source}`);
    }
    const registrations = demote
      ? staged.registrations.map((registration) => ({ ...registration, exposure: "deferred" as const }))
      : staged.registrations;
    let tools: string[];
    try {
      tools = this.#options.registry.registerAll(registrations).map((tool) => tool.canonicalName);
    } catch (error) {
      throw refused(config.name, error);
    }
    state.registered = new Map(registrations.map((registration, index) => [registration.name, tools[index] as string]));
    state.registeredHash = new Map(registrations.map(({ name }) => [name, staged.hashes.get(name) ?? ""]));
    state.status = "registered";
    this.#records.set(config.name, staged.record);
    this.#settle(state);
  }

  /** Sets which of a server's tools may run: those whose current definition matches their pin. */
  #settle(state: ServerState): void {
    const enabled = new Set<string>();
    if (!state.unreadable) {
      for (const name of state.registered.keys()) {
        const now = state.latest.get(name);
        // The model reads the definition registered at connect, so that one must be the approved one too, or a server
        // could register an unapproved definition and then list the approved one to have it enabled.
        const pin = state.pinned.get(name);
        if (now !== undefined && pin === now.hash && pin === state.registeredHash.get(name)) enabled.add(name);
      }
    }
    state.enabled = enabled;
  }

  async beginTurn(signal: AbortSignal = new AbortController().signal): Promise<readonly string[]> {
    if (this.#options.mcp === false || this.#closing !== undefined) return [];
    this.start();
    if (!this.#firstTurnDone) {
      await this.#waitForDirect(signal);
      this.#registerReady(false);
      this.#firstTurnDone = true;
    } else {
      this.#registerReady(true);
    }
    for (const state of this.#states) if (state.status === "registered") this.#settle(state);
    this.#uncommitted = [];
    const lines = this.#noticeLines(this.#uncommitted);
    if (lines.length === 0) return [];
    const shown = lines.slice(0, MAX_NOTICE_LINES);
    if (lines.length > shown.length) shown.push(`- and ${lines.length - shown.length} more changes.`);
    return [
      [
        "Harness notice: the MCP tools changed since the last turn. The tools you were given are the same, and a",
        "disabled tool's call is refused before it reaches its server.",
        ...shown,
      ].join("\n"),
    ];
  }

  /** Waits, once, for every `direct` server to connect or fail, up to `directWaitMs`, or until `signal` aborts. */
  async #waitForDirect(signal: AbortSignal): Promise<void> {
    const direct = this.#states.filter((state) => state.config.exposure === "direct");
    if (direct.length === 0 || signal.aborted) return;
    let handle: unknown;
    let onAbort: (() => void) | undefined;
    await new Promise<void>((resolve) => {
      handle = this.#timers.setTimeout(resolve, this.#directWaitMs);
      onAbort = () => resolve();
      signal.addEventListener("abort", onAbort, { once: true });
      void Promise.all(direct.map((state) => state.done)).then(() => resolve());
    });
    this.#timers.clearTimeout(handle);
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }

  /** One line per tool whose label changed since the last notice, naming it by canonical name only. */
  #noticeLines(commits: (() => void)[]): string[] {
    return this.#states
      .filter((state) => state.status === "registered")
      .flatMap((state) => noticeLinesOf(state, commits));
  }

  commitNotices(): void {
    for (const commit of this.#uncommitted.splice(0)) commit();
  }

  /** Reads a server's list again after it said the list changed, at most once per `relistIntervalMs`. */
  #scheduleRelist(state: ServerState): void {
    if (this.#closing !== undefined || state.status === "failed") return;
    const relist = state.relist;
    if (state.status === "connecting" || relist.running || relist.timer !== undefined) {
      relist.dirty = true;
      return;
    }
    const delay = Math.max(0, relist.last + this.#relistMs - this.#timers.now());
    relist.timer = this.#timers.setTimeout(() => {
      relist.timer = undefined;
      void this.#relist(state);
    }, delay);
  }

  async #relist(state: ServerState): Promise<void> {
    const relist = state.relist;
    const connection = state.connection;
    if (connection === undefined || this.#closing !== undefined) return;
    relist.running = true;
    relist.dirty = false;
    relist.last = this.#timers.now();
    try {
      state.latest = await listedOf(await connection.listTools());
      state.unreadable = false;
    } catch (error) {
      if (!state.unreadable) {
        const why = error instanceof Error ? error.message : String(error);
        this.#log(
          `the changed tool list of "${state.config.name}" could not be read, so its tools are disabled from the next turn: ${why}`,
        );
      }
      state.unreadable = true;
    } finally {
      relist.running = false;
    }
    if (relist.dirty) this.#scheduleRelist(state);
  }

  pending(): readonly McpPendingTool[] {
    const waiting: McpPendingTool[] = [];
    for (const state of this.#states) {
      for (const [name, listed] of state.latest) {
        if (state.pinned.get(name) === listed.hash) continue;
        const canonicalName = state.registered.get(name);
        waiting.push({
          server: state.config.name,
          tool: name,
          ...(canonicalName === undefined ? {} : { canonicalName }),
          state: state.pinned.has(name) ? "changed" : "new",
          hash: listed.hash,
          definition: listed.tool,
        });
      }
    }
    return waiting;
  }

  async approve(server: string, tool: string, hash: string): Promise<void> {
    const state = this.#states.find((candidate) => candidate.config.name === server);
    const listed = state?.latest.get(tool);
    if (state === undefined || listed === undefined || listed.hash !== hash) {
      throw new HarnessError(
        "invalid_mcp_config",
        "that tool's current definition does not have this hash, so it was not approved; read pending() again",
      );
    }
    const store = this.#options.pins;
    if (store === undefined) {
      state.pinned.set(tool, hash);
      return;
    }
    // Writes of one server run one after another, and each builds its pins when its turn comes, so a later approval
    // never lands under an earlier one. The pin is held in memory only once the store has it, so a failed write
    // enables nothing.
    const write = state.pinWrites.then(async () => {
      await store.write(server, Object.fromEntries([...state.pinned, [tool, hash]]));
      state.pinned.set(tool, hash);
    });
    state.pinWrites = write.catch(() => {});
    await write;
  }

  permissionHook(): PermissionHook {
    return async (call): Promise<HookDecision | undefined> => {
      const canonical = this.#options.registry.get?.(call.tool)?.canonicalName ?? call.tool;
      for (const state of this.#states) {
        for (const [name, registered] of state.registered) {
          if (registered !== canonical) continue;
          if (state.enabled.has(name)) return undefined;
          return {
            decision: "deny",
            reason: `${canonical} is disabled: its definition is new, changed or gone since it was pinned, and no person has approved it`,
            rule: "mcp_pin",
          };
        }
      }
      return undefined;
    };
  }

  records(): readonly ExtensionLoadedRecord[] {
    return this.#states.flatMap((state) => this.#records.get(state.config.name) ?? []);
  }

  connection(server: string): McpConnection | undefined {
    const state = this.#states.find((candidate) => candidate.config.name === server);
    return state?.status === "registered" ? state.connection : undefined;
  }

  close(): Promise<void> {
    this.#closing ??= (async () => {
      // Aborting ends every handshake still running, and closing every open connection fails any tool list still being
      // read, so a server that hangs can't hold the others up.
      this.#abort.abort();
      for (const state of this.#states) {
        if (state.relist.timer !== undefined) this.#timers.clearTimeout(state.relist.timer);
        state.relist.timer = undefined;
      }
      await Promise.all([...this.#open].map((connection) => connection.close()));
      await Promise.all(this.#states.map((state) => state.done));
      await this.#connecting?.catch(() => {});
    })();
    return this.#closing;
  }
}

/**
 * Creates the MCP client for a set of servers. It checks every config now and starts nothing until `start()`,
 * `connect()` or the first `beginTurn()`. Throws a `HarnessError`, code `invalid_mcp_config`, for a config that can't be
 * used, two servers with one name, a registry without `register()`, `registerAll()` and `list()`, a pin store
 * without `read()` and `write()`, or a wait that is not a whole number of milliseconds.
 */
export function createMcpManager(options: McpManagerOptions): McpManager {
  const registry = options?.registry;
  for (const method of ["register", "registerAll", "list"] as const) {
    if (typeof registry?.[method] !== "function") {
      throw new HarnessError("invalid_mcp_config", `createMcpManager() needs a tool registry with ${method}()`);
    }
  }
  checkServers(options.servers);
  const pins = options.pins;
  if (pins !== undefined && (typeof pins.read !== "function" || typeof pins.write !== "function")) {
    throw new HarnessError("invalid_mcp_config", "createMcpManager() needs a pin store with read() and write()");
  }
  return new Manager(options);
}
