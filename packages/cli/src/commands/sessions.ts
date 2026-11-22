/**
 * `buildanagent sessions list|show|search|replay`: read the stored sessions. Each one reads the log through the
 * harness's own replay, so nothing is re-run: a replay makes no model call and runs no tool.
 */
import type { SessionEntry, SessionListItem } from "@buildanagent/protocol";
import { CliError } from "../errors.js";
import { type Host, openHost } from "../host.js";
import { CLI_VERSION } from "../live.js";
import { Meter, readingText } from "../meter.js";
import type { CommandContext } from "../options.js";
import { Output } from "../output.js";
import { entryLine } from "../render.js";
import { visible } from "../visible.js";
import { openStored, SessionWatch } from "../watch.js";

const SNIPPET_CHARS = 60;

async function readOnlyHost(context: CommandContext): Promise<Host> {
  const host = await openHost({ ...context.hostOptions, interactive: false, signing: false });
  await host.client.request("initialize", {
    clientInfo: { name: "buildanagent", version: CLI_VERSION },
    capabilities: [],
  });
  return host;
}

async function listAll(host: Host): Promise<SessionListItem[]> {
  const all: SessionListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await host.client.request("session/list", cursor === undefined ? {} : { cursor });
    all.push(...page.sessions);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return all;
}

/**
 * Every entry of the session's current file, read back through `session/open`. The open takes no writer lock, so a
 * read never stops another process's turn. The dispatcher does keep the session open for this connection, watching
 * its events and asking it about waiting requests, and the protocol has no call to close one session, so that state
 * lasts until the command closes the host, which ends it for every session read.
 */
async function entriesOf(context: CommandContext, host: Host, session: string): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];
  const watch = new SessionWatch(host.client, session, (event) => {
    if (event.type === "entry_appended") entries.push(event.entry);
  });
  try {
    await openStored(host.client, watch, context.io.cwd);
  } finally {
    watch.stop();
  }
  return entries;
}

function list(out: Output, sessions: readonly SessionListItem[]): number {
  if (sessions.length === 0 && !out.json) out.note("no sessions yet", {});
  for (const item of sessions) {
    out.result(
      `${item.session}  started ${item.startedAt}  last ${item.lastEntryAt}  ${item.entryCount} entries`,
      item,
    );
  }
  return 0;
}

function show(out: Output, session: string, entries: readonly SessionEntry[]): number {
  out.note(`session ${session}: ${entries.length} entries`, { type: "session", session, entries: entries.length });
  for (const entry of entries) {
    const line = entryLine(entry);
    out.result(`#${entry.seq} ${entry.type}${line === undefined ? "" : `  ${line.trim()}`}`, entry);
  }
  return 0;
}

function replay(out: Output, session: string, entries: readonly SessionEntry[]): number {
  const meter = new Meter();
  for (const entry of entries) {
    meter.observe({ type: "entry_appended", entry });
    const line = entryLine(entry);
    if (out.json) out.line({ type: "event", session, seq: entry.seq, event: { type: "entry_appended", entry } });
    else if (line !== undefined) out.result(line, entry);
  }
  out.note(`[replayed ${entries.length} entries] ${readingText(meter.reading())}`, {
    type: "replayed",
    session,
    entries: entries.length,
    meter: meter.reading(),
  });
  return 0;
}

/** The text an entry holds that search reads: a message's text, or a tool result's. */
function searchable(entry: SessionEntry): { who: string; text: string } | undefined {
  if (entry.type === "message_block" && entry.block.type === "text") {
    return { who: entry.role === "user" ? "you" : "assistant", text: entry.block.text };
  }
  if (entry.type === "tool_result") {
    const text = entry.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
    return { who: entry.tool, text };
  }
  return undefined;
}

/**
 * `text` in lower case where that keeps its length, character by character. `toLowerCase()` turns some characters
 * into longer ones, such as `İ` into `i̇`, so a match found in the lowered text would sit at another index of the
 * original; a character like that is compared as it is written instead.
 */
const folded = (text: string): string =>
  Array.from(text, (char) => {
    const lower = char.toLowerCase();
    return lower.length === char.length ? lower : char;
  }).join("");

function snippet(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_CHARS);
  const end = Math.min(text.length, at + length + SNIPPET_CHARS);
  const flat = text.slice(start, end).replace(/\s+/g, " ");
  return `${start > 0 ? "…" : ""}${flat}${end < text.length ? "…" : ""}`;
}

async function search(context: CommandContext, host: Host, out: Output, query: string): Promise<number> {
  const needle = folded(query);
  let found = 0;
  for (const { session } of await listAll(host)) {
    for (const entry of await entriesOf(context, host, session)) {
      const hit = searchable(entry);
      const at = hit === undefined ? -1 : folded(hit.text).indexOf(needle);
      if (hit === undefined || at < 0) continue;
      found += 1;
      const text = snippet(hit.text, at, needle.length);
      out.result(`${session} #${entry.seq} ${visible(`${hit.who}: ${text}`)}`, {
        session,
        seq: entry.seq,
        who: hit.who,
        text,
      });
    }
  }
  if (found === 0) out.note(`no message holds ${JSON.stringify(query)}`, { type: "no_match", query });
  return found === 0 ? 1 : 0;
}

const USAGE = "sessions takes list, show <session>, search <text> or replay <session>";

function oneSession(words: readonly string[], verb: string): string {
  if (words.length !== 1) throw new CliError("usage", `sessions ${verb} takes one session id`);
  return words[0] as string;
}

/** Runs one `sessions` subcommand and returns the exit status. `search` exits 1 when nothing matches. */
export async function sessionsCommand(context: CommandContext, words: readonly string[]): Promise<number> {
  const [verb, ...rest] = words;
  if (verb === undefined || !["list", "show", "search", "replay"].includes(verb)) throw new CliError("usage", USAGE);
  if (verb === "list" && rest.length > 0) throw new CliError("usage", "sessions list takes no arguments");
  if (verb === "search" && rest.join(" ").trim() === "") throw new CliError("usage", "sessions search needs a text");
  const session = verb === "show" || verb === "replay" ? oneSession(rest, verb) : "";
  const host = await readOnlyHost(context);
  const out = new Output(context.io, context.flags.json);
  try {
    if (verb === "list") return list(out, await listAll(host));
    if (verb === "search") return await search(context, host, out, rest.join(" "));
    const entries = await entriesOf(context, host, session);
    return verb === "show" ? show(out, session, entries) : replay(out, session, entries);
  } finally {
    await host.close();
  }
}
