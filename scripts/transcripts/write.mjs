// Turns the raw events that record.mjs saved for one example into its committed transcript,
// verify/<sdk>/results/transcripts/<example>.json, and checks a transcript's shape. Each harness's
// scripts/run-examples.mjs calls writeTranscript() after an example's process exits; the book's replay reads the
// file, and scripts/ci/results-drift.mjs fails when a committed transcript differs from the one a run writes.
//
// Two runs on two machines must write the same bytes, so the file holds no absolute path, user name, host name,
// temporary directory or environment value, and every id, timestamp and duration that varies between runs is
// replaced by a placeholder numbered in order of first appearance.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The version of the transcript format; a change to the shape below bumps it. */
export const TRANSCRIPT_FORMAT = 1;

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The arguments that preload the recorder into an example's process; they go after tsx's `--import`. */
export const recorderArgs = () => ["--import", fileURLToPath(new URL("./record.mjs", import.meta.url))];

/** Where a harness keeps the transcript of one example. */
export const transcriptPath = (harnessDir, example) => join(harnessDir, "results", "transcripts", `${example}.json`);

const toPosix = (path) => path.split(sep).join("/");

/**
 * The harness's main package at its pinned version, such as `ai@7.0.162`. The book's harness table names each
 * harness's main package, so a transcript and a listing caption show the same pin.
 */
export function pinOf(harnessDir) {
  const harness = toPosix(relative(REPO_ROOT, harnessDir));
  const table = JSON.parse(readFileSync(join(REPO_ROOT, "apps/manual/src/data/harnesses.json"), "utf8"));
  const name = table[harness];
  if (name === undefined) throw new Error(`${harness} is not in apps/manual/src/data/harnesses.json`);
  const manifest = JSON.parse(readFileSync(join(harnessDir, "package.json"), "utf8"));
  const version = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
  if (version === undefined) throw new Error(`${harness}/package.json does not depend on ${name}`);
  return `${name}@${version}`;
}

const realOrSame = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/**
 * The machine-specific strings a run can leak into an event, longest first so a temporary directory inside the home
 * directory is replaced as a whole, each with its placeholder. Both spellings of each path count, because macOS
 * reaches its temporary directory through a symbolic link.
 */
function machineStrings({ cwd, home }) {
  const pairs = [];
  const add = (value, placeholder) => {
    if (typeof value !== "string" || value.length < 3) return;
    for (const spelling of new Set([value, realOrSame(value)])) pairs.push([spelling.replace(/\/$/, ""), placeholder]);
  };
  add(cwd, "<cwd>");
  add(home, "<home>");
  add(REPO_ROOT, "<repo>");
  add(tmpdir(), "<tmp>");
  add(homedir(), "<home>");
  add(hostname(), "<host>");
  try {
    add(userInfo().username, "<user>");
  } catch {
    // A container user without a passwd entry has no name to leak.
  }
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HAS_UUID = new RegExp(UUID.source, "i");
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
/** Keys whose values are clock readings or how long something took. */
const TIME_KEY = /^(?:timestamp|time|date|createdAt|created_at|updatedAt|startedAt|endedAt|completedAt|expiresAt)$/i;
const DURATION_KEY = /(?:^ms$|Ms$|_ms$|^duration|Duration$|^elapsed|^latency)/;
/** Keys that hold an id. */
const ID_KEY = /(?:^id$|Id$|ID$|_id$)/;
/** An id an example wrote itself, such as `call_1` or `approval-2`, which stays as it is. */
const SCRIPTED_ID = /^[A-Za-z]+[_-]?\d{1,6}$/;

/**
 * Returns a copy of `value` that two runs on any two machines write identically. Machine strings become `<cwd>`,
 * `<home>`, `<repo>`, `<tmp>`, `<host>` and `<user>`; timestamps become `<time>` and durations `<duration>`; and
 * UUIDs, and any id longer than eleven characters that is not a scripted one, become `<uuid-N>` and `<id-N>`, numbered
 * in order of first appearance, so an id that recurs keeps one placeholder and a tool call still matches its result.
 */
export function normalise(value, context) {
  const machine = machineStrings(context);
  const seen = { id: new Map(), uuid: new Map() };
  const placeholder = (kind, original) => {
    const names = seen[kind];
    if (!names.has(original)) names.set(original, `<${kind}-${names.size + 1}>`);
    return names.get(original);
  };
  const text = (s) => {
    let out = s;
    for (const [from, to] of machine) out = out.split(from).join(to);
    return out.replace(UUID, (uuid) => placeholder("uuid", uuid.toLowerCase())).replace(ISO_TIME, "<time>");
  };
  const walk = (v, key) => {
    if (Array.isArray(v)) return v.map((item) => walk(item, undefined));
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, item] of Object.entries(v)) out[k] = walk(item, k);
      return out;
    }
    if (key !== undefined && TIME_KEY.test(key) && (typeof v === "number" || typeof v === "string")) return "<time>";
    if (key !== undefined && DURATION_KEY.test(key) && typeof v === "number") return "<duration>";
    if (typeof v !== "string") return v;
    if (key !== undefined && ID_KEY.test(key) && v.length > 11 && !SCRIPTED_ID.test(v) && !HAS_UUID.test(v)) {
      return placeholder("id", v);
    }
    return text(v);
  };
  return walk(value, undefined);
}

/**
 * Shortens each request to what is new since the same model's previous request. A loop resends the whole
 * conversation every step, so a request's `repeated` counts the leading messages it shares with that earlier request,
 * and `messages` holds the rest; the full request is the earlier one's first `repeated` messages followed by these.
 */
export function compactRequests(events) {
  const previous = new Map();
  return events.map((event) => {
    if (event.kind !== "request" || !Array.isArray(event.messages)) return event;
    const before = previous.get(event.model) ?? [];
    previous.set(event.model, event.messages);
    let repeated = 0;
    while (
      repeated < before.length &&
      repeated < event.messages.length &&
      JSON.stringify(before[repeated]) === JSON.stringify(event.messages[repeated])
    ) {
      repeated++;
    }
    const { messages, ...rest } = event;
    const tools = rest.tools;
    delete rest.tools;
    return { ...rest, repeated, messages: messages.slice(repeated), ...(tools === undefined ? {} : { tools }) };
  });
}

/** A transcript as the file holds it: two-space JSON with a final newline. */
export const serialise = (transcript) => `${JSON.stringify(transcript, null, 2)}\n`;

/**
 * Writes the transcript of one example from the raw events record.mjs saved in `rawFile`. `cwd` and `home` are the
 * temporary working and home directories the example ran in.
 */
export function writeTranscript({ harnessDir, exampleFile, rawFile, cwd, home }) {
  if (!existsSync(rawFile)) return undefined;
  const { events = [] } = JSON.parse(readFileSync(rawFile, "utf8"));
  // An example whose model calls never pass through the recorded mock layer gets no transcript, not a list of checks.
  if (!events.some((event) => event.kind === "request")) return undefined;
  const example = basename(exampleFile, extname(exampleFile));
  const transcript = {
    format: TRANSCRIPT_FORMAT,
    example,
    file: toPosix(relative(REPO_ROOT, exampleFile)),
    harness: toPosix(relative(REPO_ROOT, harnessDir)),
    pin: pinOf(harnessDir),
    events: normalise(compactRequests(events), { cwd, home }),
  };
  const file = transcriptPath(harnessDir, example);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialise(transcript));
  return file;
}

const ROLES = new Set(["system", "user", "assistant", "tool"]);
const PART_TYPES = new Set(["text", "reasoning", "tool-call", "tool-result", "other"]);

/** The problems with a transcript's shape, each a sentence naming where; an empty list means it is well formed. */
export function transcriptProblems(transcript) {
  const problems = [];
  const fail = (where, message) => problems.push(`${where}: ${message}`);
  if (!transcript || typeof transcript !== "object") return ["the transcript is not a JSON object"];
  if (transcript.format !== TRANSCRIPT_FORMAT) fail("format", `is ${transcript.format}, not ${TRANSCRIPT_FORMAT}`);
  for (const key of ["example", "file", "harness", "pin"]) {
    if (typeof transcript[key] !== "string" || transcript[key] === "") fail(key, "must be a non-empty string");
  }
  if (!Array.isArray(transcript.events) || transcript.events.length === 0) {
    fail("events", "must be a non-empty list");
    return problems;
  }
  const message = (m, where) => {
    if (!m || !ROLES.has(m.role)) fail(where, `has role ${JSON.stringify(m?.role)}`);
    if (!Array.isArray(m?.parts)) {
      fail(where, "has no parts");
      return;
    }
    m.parts.forEach((part, i) => {
      if (!PART_TYPES.has(part?.type)) fail(`${where}.parts[${i}]`, `has type ${JSON.stringify(part?.type)}`);
    });
  };
  transcript.events.forEach((event, i) => {
    const where = `events[${i}]`;
    if (event.line !== undefined && !(Number.isInteger(event.line) && event.line > 0)) {
      fail(where, "has a line that is not a positive integer");
    }
    if (event.kind === "request") {
      if (typeof event.model !== "string") fail(where, "names no model");
      if (!(Number.isInteger(event.repeated) && event.repeated >= 0)) fail(where, "has no count of repeated messages");
      if (!Array.isArray(event.messages)) fail(where, "has no messages");
      else
        event.messages.forEach((m, j) => {
          message(m, `${where}.messages[${j}]`);
        });
    } else if (event.kind === "response") {
      if (typeof event.model !== "string") fail(where, "names no model");
      message(event.message, `${where}.message`);
    } else if (event.kind === "check") {
      if (typeof event.message !== "string") fail(where, "has no message");
      if (typeof event.pass !== "boolean") fail(where, "has no pass state");
    } else {
      fail(where, `has kind ${JSON.stringify(event.kind)}`);
    }
  });
  return problems;
}
