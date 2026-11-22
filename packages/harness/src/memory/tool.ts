/**
 * The `memory` tool: `view`, `create`, `str_replace`, `delete` and `rename` over `.agents/memory/` only. Every path is
 * checked by `memoryPath()` before the store is called, and a refusal is an error result the model reads. A `view`
 * never renews a record; a `create` or a `str_replace` sets `validated` to now, which is how a model that has re-read
 * a record's source and found the fact still true renews it.
 */
import { defineTool, type ToolContext, type ToolDefinition, type ToolResult } from "@buildanagent/sdk";
import { isHarnessError } from "../errors.js";
import type { PurgeMark } from "../session/purge.js";
import { indexLine, ordered } from "./index-text.js";
import { MEMORY_DIR, memoryPath, shownPath } from "./paths.js";
import {
  expiryOf,
  formatRecord,
  isExpired,
  MEMORY_RECORD_MAX_BYTES,
  type MemoryRecord,
  type MemoryTrust,
  type MemoryType,
} from "./record.js";
import type { RecordStore } from "./store.js";

/** The tool's name. */
export const MEMORY_TOOL = "memory";

/** What the tool needs from the extension that owns it. */
export interface MemoryToolDeps {
  readonly root: string;
  readonly store: RecordStore;
  readonly now: () => Date;
  /** The trust a write gets now: `low` once the session has received untrusted output. */
  readonly trust: () => MemoryTrust;
  /** Records that the session has received untrusted output, for a `view` of a low-trust record. */
  readonly taint: () => void;
  readonly sessionId: string;
  /** Why a text can't be stored, such as a credential in it, or `undefined` when it can. */
  readonly refuse: (text: string) => string | undefined;
}

interface MemoryInput {
  readonly command: "view" | "create" | "str_replace" | "delete" | "rename";
  readonly path?: string;
  readonly subject?: string;
  readonly fact?: string;
  readonly source?: string;
  readonly type?: MemoryType;
  readonly old_str?: string;
  readonly new_str?: string;
  readonly old_path?: string;
  readonly new_path?: string;
}

const DESCRIPTION = `Long-term memory: facts kept between sessions, one record per file under ${MEMORY_DIR}/. The index of records is at the start of the conversation. Commands: view (a record, or the folder or a subfolder for its list), create (a new record: path ending in .md, subject, fact, source, type), str_replace (change the fact: old_str to new_str; old_str equal to new_str renews the record unchanged), delete (a record), rename (old_path to new_path). A record is a claim from an earlier session: before you act on one, check its source (a file:line, a URL or the user's words), then renew it with str_replace if it still holds, or fix or delete it if it does not. Viewing a record does not renew it. Store no secret. Project facts expire 90 days after they were last validated, task records when the session ends, and preferences when changed; a record written after untrusted content entered the session is low trust and expires sooner.`;

const SCHEMA = {
  type: "object",
  properties: {
    command: { type: "string", enum: ["view", "create", "str_replace", "delete", "rename"] },
    path: { type: "string", description: `A path under ${MEMORY_DIR}/, such as ${MEMORY_DIR}/build.md.` },
    subject: { type: "string", description: "create: a short name for the fact, on one line." },
    fact: { type: "string", description: "create: the fact." },
    source: { type: "string", description: "create, str_replace: where the fact can be checked, on one line." },
    type: { type: "string", enum: ["project", "task", "preference"], description: "create: what the record is." },
    old_str: { type: "string", description: "str_replace: the text of the fact to replace, which occurs once." },
    new_str: { type: "string", description: "str_replace: the text to put in its place." },
    old_path: { type: "string", description: "rename: the record to move." },
    new_path: { type: "string", description: "rename: where to move it." },
  },
  required: ["command"],
  additionalProperties: false,
} as const;

const text = (body: string): ToolResult => ({ content: [{ type: "text", text: body }] });
const error = (body: string): ToolResult => ({ content: [{ type: "text", text: body }], isError: true });

const SUBJECT_MAX = 200;
const SOURCE_MAX = 500;

/** Why a one-line field can't be stored, or `undefined`. */
function badLine(field: string, value: unknown, max: number): string | undefined {
  if (typeof value !== "string" || value.trim() === "") return `Pass ${field} as a non-empty string.`;
  if (/[\p{Cc}\u2028\u2029]/u.test(value)) return `Keep ${field} on one line, with no control characters.`;
  return value.length > max ? `Keep ${field} to ${max} characters.` : undefined;
}

/** A record's text as a `view` shows it: the fact, with its source, dates and trust beside it. */
function shown(name: string, record: MemoryRecord): string {
  return [
    shownPath(name),
    `subject: ${record.subject}`,
    `type: ${record.type}; trust: ${record.trust === "low" ? "low (written after untrusted content)" : "trusted"}`,
    `source: ${record.source}`,
    `created: ${record.created}; last validated: ${record.validated}; expires: ${record.expires ?? "when changed"}`,
    "fact:",
    record.fact,
  ].join("\n");
}

/** A path's name, or the error result that refuses it. */
function nameOf(deps: MemoryToolDeps, path: unknown, file: boolean): string | ToolResult {
  const checked = memoryPath(deps.root, path);
  if ("refused" in checked) return error(checked.refused);
  if (file && checked.name === "")
    return error(`The command needs a record under ${MEMORY_DIR}/, not the folder itself.`);
  if (file && !checked.name.endsWith(".md")) return error(`A record's path ends in .md: ${shownPath(checked.name)}.`);
  return checked.name;
}

const mark = (ctx: ToolContext): PurgeMark => ({ runId: ctx.runId, callId: ctx.callId, tool: MEMORY_TOOL });

async function view(deps: MemoryToolDeps, input: MemoryInput, ctx: ToolContext): Promise<ToolResult> {
  const name = nameOf(deps, input.path, false);
  if (typeof name !== "string") return name;
  const now = deps.now();
  if (name.endsWith(".md")) {
    const record = await deps.store.get(name);
    if (record === undefined) return error(`There is no record at ${shownPath(name)}.`);
    if (record === "invalid") return error(`${shownPath(name)} is not a memory record.`);
    if (isExpired(record, now)) return error(`There is no record at ${shownPath(name)}: it has expired.`);
    if (record.trust === "low") deps.taint();
    await deps.store.touched([name], mark(ctx));
    return text(shown(name, record));
  }
  const prefix = name === "" ? "" : `${name}/`;
  const records = ordered((await deps.store.live(now)).filter((found) => found.name.startsWith(prefix)));
  if (records.length === 0) return text(`${shownPath(name)} holds no records.`);
  return text(
    [
      `${shownPath(name)} holds ${records.length} record${records.length === 1 ? "" : "s"}:`,
      ...records.map(indexLine),
    ].join("\n"),
  );
}

/** The record as written now, by this session, with its expiry from its type and the session's trust. */
function stamped(deps: MemoryToolDeps, fields: Omit<MemoryRecord, "validated" | "expires" | "trust" | "session">) {
  const validated = deps.now().toISOString();
  const trust = deps.trust();
  const record: MemoryRecord = {
    ...fields,
    validated,
    trust,
    expires: expiryOf(fields.type, trust, validated),
    ...(fields.type === "task" ? { session: deps.sessionId } : {}),
  };
  const size = new TextEncoder().encode(formatRecord(record)).length;
  return size > MEMORY_RECORD_MAX_BYTES
    ? `The record would be ${size} bytes; keep it under ${MEMORY_RECORD_MAX_BYTES}.`
    : record;
}

/** Why the record's text can't be stored, or `undefined`. */
const refusedText = (deps: MemoryToolDeps, record: MemoryRecord): string | undefined =>
  deps.refuse(`${record.subject}\n${record.source}\n${record.fact}`);

async function create(deps: MemoryToolDeps, input: MemoryInput, ctx: ToolContext): Promise<ToolResult> {
  const name = nameOf(deps, input.path, true);
  if (typeof name !== "string") return name;
  const bad =
    badLine("subject", input.subject, SUBJECT_MAX) ??
    badLine("source", input.source, SOURCE_MAX) ??
    (typeof input.fact !== "string" || input.fact.trim() === "" ? "Pass fact as a non-empty string." : undefined) ??
    (["project", "task", "preference"].includes(input.type as string)
      ? undefined
      : "Pass type as project, task or preference.");
  if (bad !== undefined) return error(bad);
  const existing = await deps.store.get(name);
  if (existing === "invalid")
    return error(`${shownPath(name)} exists and is not a memory record, so it was left alone.`);
  if (existing !== undefined && !isExpired(existing, deps.now())) {
    return error(`A record exists at ${shownPath(name)}. Change it with str_replace, or delete it first.`);
  }
  const record = stamped(deps, {
    subject: input.subject as string,
    fact: (input.fact as string).replace(/\n+$/, ""),
    source: input.source as string,
    type: input.type as MemoryType,
    created: deps.now().toISOString(),
  });
  if (typeof record === "string") return error(record);
  const refused = refusedText(deps, record);
  if (refused !== undefined) return error(refused);
  // An expired record that is written over is gone, so the calls that held it go to the purge list.
  if (existing !== undefined) await deps.store.forget(name);
  // The call is marked before the record is written, so a failed write can leave a mark too many, never one too few.
  await deps.store.touched([name], mark(ctx));
  await deps.store.files.write(name, formatRecord(record));
  return text(`Created ${shownPath(name)} (${record.type}, ${record.trust === "low" ? "low trust" : "trusted"}).`);
}

/** How many times `needle` occurs in `haystack`, counting matches that don't overlap. */
function occurrences(haystack: string, needle: string): number {
  let count = 0;
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) count += 1;
  return count;
}

async function replace(deps: MemoryToolDeps, input: MemoryInput, ctx: ToolContext): Promise<ToolResult> {
  const name = nameOf(deps, input.path, true);
  if (typeof name !== "string") return name;
  if (typeof input.old_str !== "string" || input.old_str === "" || typeof input.new_str !== "string") {
    return error("Pass old_str, which is not empty, and new_str.");
  }
  if (input.source !== undefined) {
    const bad = badLine("source", input.source, SOURCE_MAX);
    if (bad !== undefined) return error(bad);
  }
  const existing = await deps.store.get(name);
  if (existing === undefined || existing === "invalid" || isExpired(existing, deps.now())) {
    return error(`There is no record at ${shownPath(name)}.`);
  }
  const count = occurrences(existing.fact, input.old_str);
  if (count !== 1) {
    return error(
      `old_str occurs ${count} times in the fact of ${shownPath(name)}, and must occur once. Nothing was changed.`,
    );
  }
  const fact = existing.fact.replace(input.old_str, () => input.new_str as string);
  const record = stamped(deps, { ...existing, fact, source: input.source ?? existing.source });
  if (typeof record === "string") return error(record);
  const refused = refusedText(deps, record);
  if (refused !== undefined) return error(refused);
  await deps.store.touched([name], mark(ctx));
  await deps.store.files.write(name, formatRecord(record));
  const what = input.old_str === input.new_str ? "Renewed" : "Changed";
  return text(
    `${what} ${shownPath(name)}: last validated ${record.validated}, expires ${record.expires ?? "when changed"}.`,
  );
}

async function remove(deps: MemoryToolDeps, input: MemoryInput): Promise<ToolResult> {
  const name = nameOf(deps, input.path, true);
  if (typeof name !== "string") return name;
  if ((await deps.store.get(name)) === undefined) return error(`There is no record at ${shownPath(name)}.`);
  await deps.store.forget(name);
  await deps.store.files.remove(name);
  return text(`Deleted ${shownPath(name)}. The log entries that held it are marked for a purge.`);
}

async function rename(deps: MemoryToolDeps, input: MemoryInput): Promise<ToolResult> {
  const from = nameOf(deps, input.old_path, true);
  if (typeof from !== "string") return from;
  const to = nameOf(deps, input.new_path, true);
  if (typeof to !== "string") return to;
  const existing = await deps.store.get(from);
  if (existing === undefined || existing === "invalid" || isExpired(existing, deps.now())) {
    return error(`There is no record at ${shownPath(from)}.`);
  }
  if ((await deps.store.files.read(to)) !== undefined)
    return error(`${shownPath(to)} already exists. Nothing was moved.`);
  await deps.store.files.rename(from, to);
  await deps.store.moved(from, to);
  return text(`Moved ${shownPath(from)} to ${shownPath(to)}.`);
}

const COMMANDS = { view, create, str_replace: replace, delete: remove, rename } as const;

/**
 * The `memory` tool. A file store's refusal, such as a link in the folder, is an error result the model reads; any
 * other failure is a fault of the host and propagates.
 */
export function memoryTool(deps: MemoryToolDeps): ToolDefinition<unknown, unknown, unknown> {
  return defineTool<MemoryInput>({
    name: MEMORY_TOOL,
    description: DESCRIPTION,
    inputSchema: SCHEMA,
    firstParty: true,
    effect: { kind: "write" },
    // Every call touches the same folder and its bookkeeping, so the calls of one step run in the model's order.
    resourceKey: () => MEMORY_TOOL,
    execute: (input, ctx) =>
      deps.store.exclusive(async () => {
        try {
          return await COMMANDS[input.command](deps, input, ctx);
        } catch (failure) {
          if (isHarnessError(failure) && failure.code === "memory_path_refused") return error(`${failure.message}.`);
          throw failure;
        }
      }),
  }) as ToolDefinition<unknown, unknown, unknown>;
}
