/**
 * `memoryExtension()`: long-term memory as an extension that does nothing until a host loads it. It adds the `memory`
 * tool and puts the index at the start of each run's first request, the way `projectContext()` adds the context files,
 * so the index is in no system prompt and no log entry. It watches the session's tool results to decide each write's
 * trust, and marks the calls that wrote or returned each record, so a delete can reach the log.
 */
import type { ContentBlock, Message } from "@buildanagent/gateway";
import { HarnessError, isHarnessError } from "../errors.js";
import { contextText } from "../extensions/context-files.js";
import type { Extension } from "../extensions/types.js";
import { normalizePath, pathsOf } from "../permissions/match.js";
import type { ToolRegistry } from "../tools/types.js";
import type { MemoryFiles } from "./files.js";
import { indexText } from "./index-text.js";
import { MEMORY_DIR } from "./paths.js";
import { formatRecord } from "./record.js";
import { RecordStore } from "./store.js";
import { MEMORY_TOOL, memoryTool } from "./tool.js";

/** The options of `memoryExtension()`. */
export interface MemoryExtensionOptions {
  /** The project root, absolute. The tool's paths are relative to it, or absolute under it. */
  readonly root: string;
  /** Where the memory folder's files are: `fileMemoryFiles(root)` from `@buildanagent/harness/memory/node` on Node. */
  readonly files: MemoryFiles;
  /**
   * The registry the session's tools are in. A tool's `outputTrust` there decides whether its result makes the
   * session's later writes low trust; a tool it does not hold counts as untrusted, as the session log records it.
   */
  readonly registry: Pick<ToolRegistry, "get">;
  /** The clock every date and every expiry is read from. Default the system clock; a test passes a fixed one. */
  readonly clock?: () => Date;
  /** The session this extension serves, which a task record names. Default a random id. */
  readonly sessionId?: string;
  /** Values that must never be stored, such as the credentials the host holds. A write that holds one is refused. */
  readonly secrets?: readonly string[];
}

/** The memory extension: an `Extension`, and the call that ends its session. */
export interface MemoryExtension extends Extension {
  /** Ends the session: every task record it wrote expires now. Call it when the session is closed for good. */
  endSession(): Promise<void>;
}

// Credential shapes that a record must never hold, whatever the host passes in `secrets`.
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/,
];

/** The most runs whose index is held at once, so an extension that lives long keeps no unbounded map. */
const RUNS_KEPT = 128;

/** The messages with `text` leading the first message, which is the user's, or as a new first message. */
function lead(messages: readonly Message[], text: string): Message[] {
  const block: ContentBlock = { type: "text", text };
  const [first, ...rest] = messages;
  if (first?.role === "user") return [{ role: "user", content: [block, ...first.content] }, ...rest];
  return [{ role: "user", content: [block] }, ...messages];
}

/** The tools each call id in `messages` named, from the assistant's tool calls. */
function callNames(messages: readonly Message[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) if (block.type === "tool_call") names.set(block.callId, block.name);
  }
  return names;
}

const resultText = (content: readonly { readonly type: string; readonly text?: string }[]): string =>
  content.map((block) => (block.type === "text" ? (block.text ?? "") : "")).join("\n");

// A fact shorter than this is too likely to occur by chance in an unrelated result to mark that result.
const MIN_TRACKED_FACT = 12;

/** Why a record's text can't be stored, for a text that holds a secret the host named or a credential's shape. */
function refuserOf(secrets: readonly string[]): (text: string) => string | undefined {
  const named = secrets.filter((secret) => secret.length >= 4);
  return (text) =>
    named.some((secret) => text.includes(secret)) || CREDENTIAL_SHAPES.some((shape) => shape.test(text))
      ? "The record holds what looks like a credential, so it was not stored. Store where a secret is kept, never the secret."
      : undefined;
}

/**
 * The index's text, or a one-line notice when the file store refuses the folder, such as a memory folder that is a
 * link, so a project that plants one gets no memory and keeps working.
 */
async function readIndex(store: RecordStore, now: () => Date): Promise<string> {
  try {
    return indexText(await store.exclusive(() => store.live(now())));
  } catch (error) {
    if (!isHarnessError(error) || error.code !== "memory_path_refused") throw error;
    return `[No memory was read: ${error.message.replace(/[\p{Cc}\p{Cf}]/gu, " ")}.]`;
  }
}

/**
 * The index for a run: read at the run's first model call and kept for its other calls, so the request's start holds
 * still within a run and a record written in one run shows in the next.
 */
function indexCache(store: RecordStore, now: () => Date): (runId: string, stepIndex: number) => Promise<string> {
  const indexes = new Map<string, string>();
  return async (runId, stepIndex) => {
    const held = indexes.get(runId);
    const found = held !== undefined && stepIndex > 0 ? held : await readIndex(store, now);
    // A map iterates in insertion order, so a run moved to the end on every use is the last to be evicted.
    indexes.delete(runId);
    indexes.set(runId, found);
    for (const key of indexes.keys()) {
      if (indexes.size <= RUNS_KEPT) break;
      indexes.delete(key);
    }
    return found;
  };
}

/**
 * Marks a call of another tool whose result holds a record's fact verbatim, when its input or its result names the
 * memory folder, so a `read`, `grep` or `bash` of a record's file is purged with the record. An expired record counts
 * too, because its file stays readable until a `create` or a `delete` replaces it. Tracking never fails the call: a
 * folder the file store refuses, or bookkeeping it can't read, leaves the call unmarked and its result as it was,
 * because the result belongs to another tool and memory is then unusable anyway.
 */
function tracker(store: RecordStore) {
  return async (runId: string, callId: string, tool: string, input: unknown, text: string): Promise<void> => {
    if (tool === MEMORY_TOOL) return;
    if (!text.includes(MEMORY_DIR) && !JSON.stringify(input ?? null).includes(MEMORY_DIR)) return;
    try {
      await store.exclusive(async () => {
        const held = (await store.present()).filter(
          ({ record }) => record.fact.length >= MIN_TRACKED_FACT && text.includes(record.fact),
        );
        await store.touched(
          held.map(({ name }) => name),
          { runId, callId, tool },
        );
      });
    } catch {
      // The error may quote the folder's paths, so nothing of it is passed on.
    }
  };
}

/** The built-in tools that write a file the model names, which must never write the memory folder. */
const FILE_WRITERS: readonly string[] = ["write", "edit"];

/**
 * Why a call of `tool` with `input` is denied, when it is a file write into the memory folder under `root`, or
 * `undefined`. A record written so would skip the memory tool's trust, its secret check and its bookkeeping, and a
 * write over the bookkeeping would clear the purge list. The paths are compared without case, for a file system that
 * ignores it; a link to the folder from elsewhere in the project is not seen, as no check on a path's text sees one.
 */
function memoryWriteRefused(root: string, tool: string, input: unknown): string | undefined {
  if (!FILE_WRITERS.includes(tool)) return undefined;
  const folder = normalizePath(`${root}/${MEMORY_DIR}`).toLowerCase();
  const inside = pathsOf(input).some((path) => {
    const resolved = normalizePath(path.startsWith("/") ? path : `${root}/${path}`).toLowerCase();
    return resolved === folder || resolved.startsWith(`${folder}/`);
  });
  return inside
    ? `${MEMORY_DIR}/ is written only through the ${MEMORY_TOOL} tool, so this ${tool} call was refused.`
    : undefined;
}

/** Expires every live task record that `sessionId` wrote, as of now. */
function endTasks(store: RecordStore, now: () => Date, sessionId: string): Promise<void> {
  return store.exclusive(async () => {
    const at = now();
    for (const { name, record } of await store.live(at)) {
      if (record.type !== "task" || record.session !== sessionId) continue;
      await store.files.write(name, formatRecord({ ...record, expires: at.toISOString() }));
    }
  });
}

/**
 * Long-term memory over `.agents/memory/` under `root`: the `memory` tool and the index. Load it with
 * `composeExtensions()` and `registerExtensionTools()` like any extension, one per session. Leave it out and no memory
 * tool and no index reach the model.
 *
 * Every date comes from `clock`. A record is shown, in a `view` and in the index, only until it expires: a project fact
 * 90 days after it was last validated, a preference when it is changed, and a task record when `endSession()` runs, or
 * at the latest 7 days after it was last validated. A `view` never renews a record, and a `create` or `str_replace`
 * does. Once a result from a tool whose output is untrusted has entered the session, or the model has viewed a
 * low-trust record, every write is stored as low trust, which expires sooner: 30 days for a project fact or a
 * preference and 1 day for a task record. A `str_replace` never raises a record's trust, so a low-trust record stays
 * low trust when a trusted session renews or changes it. The tool's own results are logged as untrusted, because a
 * record can have been planted; a view of a trusted record does not make later writes low trust. A built-in `write` or
 * `edit` into the memory folder is denied, so records go through the tool; `bash` is not checked.
 *
 * A `delete` removes the record and adds the calls that wrote or returned it to the purge list, which
 * `readPurgeMarks()` reads for `purgeSession()` and `pruneSessions()`. The calls of other tools whose result holds a
 * record's fact verbatim, such as a `read` of the record's file, are marked too, an expired record's included, and a
 * failure to mark one never fails that call. Throws a `HarnessError` with code
 * `invalid_memory_options` for a `root` that is not absolute.
 */
export function memoryExtension(options: MemoryExtensionOptions): MemoryExtension {
  if (typeof options.root !== "string" || !options.root.startsWith("/")) {
    throw new HarnessError("invalid_memory_options", "memoryExtension() needs an absolute project root");
  }
  const now = options.clock ?? (() => new Date());
  const sessionId = options.sessionId ?? globalThis.crypto.randomUUID();
  const store = new RecordStore(options.files);
  let tainted = false;
  const untrusted = (tool: string): boolean =>
    tool !== MEMORY_TOOL && (options.registry.get(tool)?.outputTrust ?? "untrusted") === "untrusted";
  const indexFor = indexCache(store, now);
  const track = tracker(store);
  const tool = memoryTool({
    root: options.root,
    store,
    now,
    trust: () => (tainted ? "low" : "trusted"),
    taint: () => {
      tainted = true;
    },
    sessionId,
    refuse: refuserOf(options.secrets ?? []),
  });

  return {
    name: "memory",
    version: "1.0.0",
    tools: [{ name: MEMORY_TOOL, outputTrust: "untrusted", definition: tool }],
    interceptors: {
      beforeToolCall(event) {
        const refused = memoryWriteRefused(options.root, event.tool, event.input);
        return refused === undefined ? { decision: "allow" } : { decision: "deny", reason: refused };
      },
      async transformContext(event) {
        // The session's earlier results are in the messages, so a resumed session that read untrusted output stays low trust.
        const names = callNames(event.messages);
        for (const message of event.messages) {
          if (message.role === "tool" && untrusted(names.get(message.callId) ?? "")) tainted = true;
        }
        const index = await indexFor(event.runId, event.stepIndex);
        if (index === "") return event.messages;
        return lead(event.messages, contextText([{ path: `${MEMORY_DIR}/ index`, text: index, truncated: false }]));
      },
      afterModelCall(event) {
        // A call in this step runs beside the memory call, possibly first, so an untrusted one taints the step's writes.
        for (const block of event.message.content)
          if (block.type === "tool_call" && untrusted(block.name)) tainted = true;
        return undefined;
      },
      async afterToolCall(event) {
        if (untrusted(event.tool)) tainted = true;
        await track(event.runId, event.callId, event.tool, event.input, resultText(event.result.content));
        return undefined;
      },
    },
    endSession: () => endTasks(store, now, sessionId),
  };
}
