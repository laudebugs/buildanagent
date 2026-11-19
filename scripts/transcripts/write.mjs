// Turns the raw events that record.mjs saved for one example into its committed transcript,
// verify/<sdk>/results/transcripts/<example>.json, and checks a transcript's shape. Each harness's
// scripts/run-examples.mjs calls transcriptRun() before an example runs and its write() after the process exits; the
// book's replay reads the file, and scripts/ci/results-drift.mjs fails when a committed transcript differs from the one
// a run writes. The shapes themselves live in events.ts.
//
// Two runs on two machines must write the same bytes, so the file holds no absolute path, temporary directory or
// environment value, and every id, timestamp and duration that the SDK generates is replaced by a placeholder. What an
// example scripts itself, such as a tool's input or a model's text, is kept as written.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TRANSCRIPT_FORMAT } from "./events.ts";

export { TRANSCRIPT_FORMAT };

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The package each harness's recorder attaches to, whose version the transcript records beside the pin, so an update
 * to the mock layer's package shows as a change to the transcript.
 */
export const MOCK_PACKAGES = {
  "verify/cloudflare-agents": "ai",
  "verify/google-adk": "@google/adk",
  "verify/langchain": "@langchain/core",
  "verify/openai-agents-sdk": "@openai/agents",
  "verify/pi": "@earendil-works/pi-ai",
  "verify/vercel-ai-sdk": "ai",
};

/** Where a harness keeps the transcript of one example. */
export const transcriptPath = (harnessDir, example) => join(harnessDir, "results", "transcripts", `${example}.json`);

const toPosix = (path) => path.split(sep).join("/");
const harnessOf = (harnessDir) => toPosix(relative(REPO_ROOT, harnessDir));

/** A package's exact version in a harness's `package.json`, as `name@version`. */
function versionOf(harnessDir, name) {
  const manifest = JSON.parse(readFileSync(join(harnessDir, "package.json"), "utf8"));
  const version = manifest.dependencies?.[name] ?? manifest.devDependencies?.[name];
  if (version === undefined) throw new Error(`${harnessOf(harnessDir)}/package.json does not depend on ${name}`);
  return `${name}@${version}`;
}

/**
 * The harness's main package at its pinned version, such as `ai@7.0.162`. The book's harness table names each
 * harness's main package, so a transcript and a listing caption show the same pin.
 */
export function pinOf(harnessDir) {
  const harness = harnessOf(harnessDir);
  const table = JSON.parse(readFileSync(join(REPO_ROOT, "apps/manual/src/data/harnesses.json"), "utf8"));
  if (table[harness] === undefined) throw new Error(`${harness} is not in apps/manual/src/data/harnesses.json`);
  return versionOf(harnessDir, table[harness]);
}

/** The version of the package the harness's recorder attaches to, such as `@langchain/core@1.3.4`. */
export function mockOf(harnessDir) {
  const name = MOCK_PACKAGES[harnessOf(harnessDir)];
  if (name === undefined) throw new Error(`${harnessOf(harnessDir)} has no recorder in MOCK_PACKAGES`);
  return versionOf(harnessDir, name);
}

const realOrSame = (path) => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The machine's directories a run can leak into an event, each with its placeholder, as patterns that match only a
 * whole path: one that starts a string or follows a space, quote or similar, and ends at a `/` or where a path ends.
 * Longer paths come first, so a temporary directory inside the home directory is replaced as a whole. Both spellings
 * of each path count, because macOS reaches its temporary directory through a symbolic link. User and host names are
 * left alone outside these paths, because an example's own text can hold the same words.
 */
function machinePaths({ cwd, home }) {
  const pairs = [];
  const add = (value, placeholder) => {
    if (typeof value !== "string" || value.length < 2) return;
    for (const spelling of new Set([value, realOrSame(value)])) pairs.push([spelling.replace(/\/$/, ""), placeholder]);
  };
  add(cwd, "<cwd>");
  add(home, "<home>");
  add(REPO_ROOT, "<repo>");
  add(tmpdir(), "<tmp>");
  add(homedir(), "<home>");
  return pairs
    .filter(([path]) => path.length > 1)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([path, placeholder]) => [new RegExp(`(?<![\\w.~-])${escapeRegExp(path)}(?=/|$|[^\\w.-])`, "g"), placeholder]);
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_TIME = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
/** Keys whose values are clock readings or how long something took, in what an SDK adds to a part. */
const TIME_KEY = /^(?:timestamp|createdAt|created_at|updatedAt|startedAt|endedAt|completedAt|expiresAt)$/;
const DURATION_KEY = /(?:^ms$|Ms$|_ms$|^duration|Duration$|^elapsed|^latency)/;
/** An id an example wrote itself, such as `call_1` or `approval-2`, which stays as it is. */
const SCRIPTED_ID = /^[A-Za-z]+[_-]?\d{1,6}$/;

/**
 * Returns a copy of the events that two runs on any two machines write identically. Three rules apply, each only
 * where it belongs. First, a machine directory anywhere becomes `<cwd>`, `<home>`, `<repo>` or `<tmp>`. Second, the
 * id of a tool call or a tool result becomes `<id-N>`, numbered by first appearance so a call still matches its
 * result, unless it is at most eleven characters long or shaped like `call_1`, as ids an example scripts are. Third,
 * inside an `other` part, which holds what an SDK adds, timestamps become `<time>`, durations `<duration>` and UUIDs
 * `<uuid-N>`. Text, tool inputs and tool outputs keep their dates and ids, because the example wrote them.
 */
export function normalise(events, context) {
  const paths = machinePaths(context);
  const seen = { id: new Map(), uuid: new Map() };
  const placeholder = (kind, original) => {
    const names = seen[kind];
    if (!names.has(original)) names.set(original, `<${kind}-${names.size + 1}>`);
    return names.get(original);
  };
  const machine = (text) => paths.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
  const id = (value) =>
    typeof value === "string" && value.length > 11 && !SCRIPTED_ID.test(value) ? placeholder("id", value) : value;
  // Generic values keep everything but machine paths; SDK values also lose clock readings, durations and UUIDs.
  const walk = (value, generated, key) => {
    if (Array.isArray(value)) return value.map((item) => walk(item, generated, undefined));
    if (value && typeof value === "object") {
      const out = {};
      for (const [k, item] of Object.entries(value)) out[k] = walk(item, generated, k);
      return out;
    }
    if (generated && key !== undefined && TIME_KEY.test(key)) return "<time>";
    if (generated && key !== undefined && DURATION_KEY.test(key) && typeof value === "number") return "<duration>";
    if (typeof value !== "string") return value;
    const text = machine(value);
    if (!generated) return text;
    return text.replace(UUID, (uuid) => placeholder("uuid", uuid.toLowerCase())).replace(ISO_TIME, "<time>");
  };
  const part = (p) => {
    if (p?.type === "tool-call" || p?.type === "tool-result") return { ...walk(p, false), id: id(p.id) };
    if (p?.type === "other") return { ...p, value: walk(p.value, true) };
    return walk(p, false);
  };
  const message = (m) => (m && Array.isArray(m.parts) ? { ...m, parts: m.parts.map(part) } : walk(m, false));
  return events.map((event) => {
    if (event.kind === "request") return { ...walk(event, false), messages: event.messages.map(message) };
    if (event.kind === "response") return { ...walk(event, false), message: message(event.message) };
    return walk(event, false);
  });
}

/**
 * Shortens each request to what is new since the same model's previous request and its answer. A loop resends the
 * whole conversation every step, including the model's last answer, so a request's `repeated` counts its leading
 * messages that match that earlier request's messages followed by the answer, and `messages` holds the rest. The full
 * request is those first `repeated` messages followed by these.
 */
export function compactRequests(events) {
  const previous = new Map();
  return events.map((event) => {
    if (event.kind === "response") {
      const before = previous.get(event.model);
      if (before) previous.set(event.model, [...before, event.message]);
      return event;
    }
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
    const { messages, tools, ...rest } = event;
    return { ...rest, repeated, messages: messages.slice(repeated), ...(tools === undefined ? {} : { tools }) };
  });
}

/** A transcript as the file holds it: two-space JSON with a final newline. */
export const serialise = (transcript) => `${JSON.stringify(transcript, null, 2)}\n`;

/**
 * Writes the transcript of one example from the raw events record.mjs saved in `rawFile`. `cwd` and `home` are the
 * temporary working and home directories the example ran in, and `outDir` overrides where the file goes. An example
 * whose model calls never reached the recorded mock layer gets no transcript. When it had one committed, the stale
 * file is deleted and the problem printed, so the results-drift check reports it instead of passing on an old run.
 */
export function writeTranscript({ harnessDir, exampleFile, rawFile, cwd, home, outDir }) {
  const example = basename(exampleFile, extname(exampleFile));
  const file = outDir === undefined ? transcriptPath(harnessDir, example) : join(outDir, `${example}.json`);
  const events = existsSync(rawFile) ? (JSON.parse(readFileSync(rawFile, "utf8")).events ?? []) : [];
  if (!events.some((event) => event.kind === "request")) {
    if (existsSync(file)) {
      rmSync(file);
      console.error(
        `transcript: ${example} recorded no model request, so ${toPosix(relative(REPO_ROOT, file))} is deleted`,
      );
    }
    return undefined;
  }
  const transcript = {
    format: TRANSCRIPT_FORMAT,
    example,
    file: toPosix(relative(REPO_ROOT, exampleFile)),
    harness: harnessOf(harnessDir),
    pin: pinOf(harnessDir),
    mock: mockOf(harnessDir),
    events: normalise(compactRequests(events), { cwd, home }),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serialise(transcript));
  return file;
}

/**
 * Prepares one run of an example for recording: adds the recorder to the node arguments, after tsx's `--import`, and
 * the raw file to the environment. Returns `write`, which the runner calls once the process has exited.
 */
export function transcriptRun(args, env) {
  const raw = join(mkdtempSync(join(tmpdir(), "transcript-")), "events.json");
  args.push("--import", fileURLToPath(new URL("./record.mjs", import.meta.url)));
  env.TRANSCRIPT_FILE = raw;
  return {
    write: ({ harnessDir, exampleFile, cwd }) => {
      const written = writeTranscript({ harnessDir, exampleFile, rawFile: raw, cwd, home: env.HOME });
      rmSync(dirname(raw), { recursive: true, force: true });
      return written;
    },
  };
}

const ROLES = new Set(["system", "user", "assistant", "tool"]);
const PART_TYPES = new Set(["text", "reasoning", "tool-call", "tool-result", "other"]);

/** The problems with a transcript's shape, each a sentence naming where; an empty list means it is well formed. */
export function transcriptProblems(transcript) {
  const problems = [];
  const fail = (where, message) => problems.push(`${where}: ${message}`);
  if (!transcript || typeof transcript !== "object") return ["the transcript is not a JSON object"];
  if (transcript.format !== TRANSCRIPT_FORMAT) fail("format", `is ${transcript.format}, not ${TRANSCRIPT_FORMAT}`);
  for (const key of ["example", "file", "harness", "pin", "mock"]) {
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
