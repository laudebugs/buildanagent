// Turns the raw events that record.mjs saved for one example into its committed transcript,
// <harness>/results/transcripts/<example>.json, and checks a transcript's shape. A harness is a verify/<sdk> directory
// or one of our own packages, such as packages/sdk. Each verify harness's scripts/run-examples.mjs, and the shared
// book-examples.ts that our packages' tests call, call transcriptRun() before an example runs and its write() after
// the process exits. The book's replay reads the file, and scripts/ci/results-drift.mjs fails when a committed
// transcript differs from the one a run writes. The shapes themselves live in events.ts.
//
// Two runs on two machines must write the same bytes, so the file holds no absolute path, temporary directory or
// environment value, and every id, timestamp and duration that the SDK generates is replaced by a placeholder. What an
// example scripts itself, such as a tool's input, a model's text or an answer's usage and model id, is kept as
// written.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findSecret } from "../live/redact.ts";
import { TRANSCRIPT_FORMAT } from "./events.ts";

export { TRANSCRIPT_FORMAT };

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The package each harness's recorder attaches to, whose version the transcript records beside the pin, so an update
 * to the mock layer's package shows as a change to the transcript.
 */
export const MOCK_PACKAGES = {
  "packages/gateway": "@buildanagent/gateway",
  "packages/harness": "@buildanagent/harness",
  "packages/sdk": "@buildanagent/sdk",
  "verify/claude-agent-sdk": "@anthropic-ai/claude-agent-sdk",
  "verify/cloudflare-agents": "ai",
  "verify/copilot-sdk": "@github/copilot-sdk",
  "verify/google-adk": "@google/adk",
  "verify/langchain": "@langchain/core",
  "verify/openai-agents-sdk": "@openai/agents",
  "verify/pi": "@earendil-works/pi-ai",
  "verify/vercel-ai-sdk": "ai",
};

/** Where a harness keeps the transcript of one example. */
export const transcriptPath = (harnessDir, example) => join(harnessDir, "results", "transcripts", `${example}.json`);

/**
 * Where a harness keeps the transcript of one example's live run on one provider (scripts/live/run.mjs). Each provider
 * has its own folder, because the live list may run one example on both.
 */
export const liveTranscriptPath = (harnessDir, example, provider) =>
  join(harnessDir, "results", "live", provider, `${example}.json`);

const toPosix = (path) => path.split(sep).join("/");
const harnessOf = (harnessDir) => toPosix(relative(REPO_ROOT, harnessDir));

/**
 * The version a transcript records for one of our own workspace packages: `workspace`, never the version number. A
 * run of our package's examples runs its source as it stands, and the release job's version commit may change only
 * the version itself (scripts/ci/version-pr.mjs), so a transcript that named the number would go stale at each release.
 */
export const WORKSPACE_VERSION = "workspace";

/**
 * A package's exact version in a harness's `package.json`, as `name@version`. In one of our own packages, the package
 * itself is recorded as `name@workspace`.
 */
function versionOf(harnessDir, name) {
  const manifest = JSON.parse(readFileSync(join(harnessDir, "package.json"), "utf8"));
  if (manifest.name === name) return `${name}@${WORKSPACE_VERSION}`;
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
 * They are the run's own temporary working and home directories, the repository and the user's home directory, longer
 * ones first. Both spellings of each path count, because macOS reaches its temporary directory through a symbolic
 * link. The system's temporary directory itself is left alone, because on Linux it is `/tmp`, which an example's
 * own text can name, and so are user and host names outside these paths.
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

/**
 * Returns a copy of the events that two runs on any two machines write identically. Three rules apply, each only
 * where it belongs. First, a machine directory anywhere becomes `<cwd>`, `<home>` or `<repo>`. Second, the id of a
 * tool call or a tool result stays as written when the mock's script chose it, as each response's `scripted` list
 * says; any other id, one the SDK generated, becomes `<id-N>`, numbered by first appearance so a call still matches
 * its result. Third, inside an `other` part, which holds what an SDK adds, timestamps become `<time>`, durations
 * `<duration>` and UUIDs `<uuid-N>`. Text, tool inputs and tool outputs keep their dates and ids, because the example
 * wrote them. The `scripted` lists themselves are not written.
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
  const scripted = new Set(
    events.flatMap((event) => (event.kind === "response" && Array.isArray(event.scripted) ? event.scripted : [])),
  );
  const id = (value) => (typeof value === "string" && !scripted.has(value) ? placeholder("id", value) : value);
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
    if (event.kind === "response") {
      const { scripted: _scripted, ...rest } = event;
      return { ...walk(rest, false), message: message(event.message) };
    }
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

/**
 * The time an event happened at, in milliseconds with a fraction, on a clock that the processes of one run share: the
 * wall clock at a process's start plus the time since, so a clock step during the run cannot reorder events, and two
 * events a millisecond apart still sort in the order they happened.
 */
export const eventTime = () => performance.timeOrigin + performance.now();

/**
 * The events of a mock that runs in another process, merged with the example process's events in the order they
 * happened. Each event carries the `at` time (`eventTime`) that recorded it; when two share one the mock's
 * comes first, because an example checks what a call answered after the answer arrived.
 */
export function mergeEvents(mockEvents, exampleEvents) {
  // An example's own events are already in the order they happened, so only a mock in another process needs merging.
  // The sort is stable, so events that tie keep their order, the mock's first.
  if (mockEvents.length === 0) return exampleEvents;
  return [...mockEvents, ...exampleEvents].sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

/** A transcript as the file holds it: two-space JSON with a final newline. */
export const serialise = (transcript) => `${JSON.stringify(transcript, null, 2)}\n`;

/**
 * Writes the transcript of one example from the raw events record.mjs saved in `rawFile`. `cwd` and `home` are the
 * temporary working and home directories the example ran in, and `outDir` overrides where the file goes. An example
 * whose model calls never reached the recorded mock layer gets no transcript. When it had one committed, the stale
 * file is deleted and the problem printed, so the results-drift check reports it instead of passing on an old run.
 *
 * `live`, `{ provider, model, secrets }`, marks the transcript of a live run (scripts/live/run.mjs), which goes to
 * `results/live/<provider>/` and names the provider and model. A real model chose every tool-call id in it, so none is kept as
 * written. A live transcript that holds one of `secrets` or the shape of a key, an account id or a request id
 * (scripts/live/redact.ts) is not written at all, and the problem names only the shape it matched.
 */
export function writeTranscript({ harnessDir, exampleFile, rawFile, cwd, home, outDir, live, mockEvents }) {
  const example = basename(exampleFile, extname(exampleFile));
  const defaultPath = live === undefined ? transcriptPath : liveTranscriptPath;
  const file =
    outDir === undefined ? defaultPath(harnessDir, example, live?.provider) : join(outDir, `${example}.json`);
  const raw = existsSync(rawFile) ? (JSON.parse(readFileSync(rawFile, "utf8")).events ?? []) : [];
  const recorded = mergeEvents(mockEvents ?? [], raw).map(({ at: _at, ...event }) => event);
  const events = live === undefined ? recorded : recorded.map(({ scripted: _scripted, ...event }) => event);
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
    ...(live === undefined ? {} : { live: { provider: live.provider, model: live.model } }),
    events: normalise(compactRequests(events), { cwd, home }),
  };
  const text = serialise(transcript);
  const secret = live === undefined ? undefined : findSecret(text, live.secrets ?? []);
  if (secret !== undefined) {
    if (existsSync(file)) rmSync(file);
    console.error(`transcript: ${example}'s live transcript held ${secret}, so it is not written`);
    return undefined;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
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
    write: ({ harnessDir, exampleFile, cwd, outDir, live, mockEvents }) => {
      const written = writeTranscript({
        harnessDir,
        exampleFile,
        rawFile: raw,
        cwd,
        home: env.HOME,
        outDir,
        live,
        mockEvents,
      });
      rmSync(dirname(raw), { recursive: true, force: true });
      return written;
    },
  };
}

const ROLES = new Set(["system", "user", "assistant", "tool"]);
/**
 * The characters a tool's name and its arguments' keys may use. The live run's issue and pull request quote them, so
 * a transcript that a real model or package code wrote can't smuggle Markdown or a mention in through them.
 */
const NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const PART_TYPES = new Set(["text", "reasoning", "tool-call", "tool-result", "other"]);
/** The token classes a response's `usage` may hold (events.ts, `Usage`). */
const USAGE_CLASSES = new Set(["uncachedInput", "cacheRead", "cacheWrite", "output", "reasoning"]);
/** The characters a reported model id may use, such as `claude-sonnet-5-5` or `models/gemini-pro@001`. */
const MODEL_ID = /^[A-Za-z0-9_.:/@-]{1,128}$/;

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
      // A tool result may leave its tool unnamed, as a LangChain tool message without a name does.
      const unnamed = part?.type === "tool-result" && part.name === "";
      if ((part?.type === "tool-call" || part?.type === "tool-result") && !unnamed && !NAME.test(String(part.name))) {
        fail(`${where}.parts[${i}]`, "names a tool outside [A-Za-z0-9_.-]");
      }
      if (part?.type === "tool-call" && part.input && typeof part.input === "object" && !Array.isArray(part.input)) {
        if (!Object.keys(part.input).every((key) => NAME.test(key))) {
          fail(`${where}.parts[${i}]`, "has an argument key outside [A-Za-z0-9_.-]");
        }
      }
    });
  };
  const usage = (value, where) => {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length === 0) {
      fail(where, "must be an object with at least one token class");
      return;
    }
    for (const [key, count] of Object.entries(value)) {
      if (!USAGE_CLASSES.has(key)) fail(where, `has a token class ${JSON.stringify(key)}`);
      else if (!(Number.isInteger(count) && count >= 0)) fail(where, `${key} is not a whole number`);
    }
  };
  transcript.events.forEach((event, i) => {
    const where = `events[${i}]`;
    if (event.line !== undefined && !(Number.isInteger(event.line) && event.line > 0)) {
      fail(where, "has a line that is not a positive integer");
    }
    if (event.kind === "request") {
      if (typeof event.model !== "string") fail(where, "names no model");
      if (!(Number.isInteger(event.repeated) && event.repeated >= 0)) fail(where, "has no count of repeated messages");
      if (Array.isArray(event.tools) && !event.tools.every((tool) => NAME.test(String(tool)))) {
        fail(where, "offers a tool whose name is outside [A-Za-z0-9_.-]");
      }
      if (!Array.isArray(event.messages)) fail(where, "has no messages");
      else
        event.messages.forEach((m, j) => {
          message(m, `${where}.messages[${j}]`);
        });
    } else if (event.kind === "response") {
      if (typeof event.model !== "string") fail(where, "names no model");
      message(event.message, `${where}.message`);
      if (event.usage !== undefined) usage(event.usage, `${where}.usage`);
      if (event.modelId !== undefined && typeof event.modelId !== "string")
        fail(where, "has a model id that is no string");
      else if (event.modelId !== undefined && !MODEL_ID.test(event.modelId)) {
        fail(where, "has a model id outside [A-Za-z0-9_.:/@-]");
      }
    } else if (event.kind === "check") {
      if (typeof event.message !== "string") fail(where, "has no message");
      if (typeof event.pass !== "boolean") fail(where, "has no pass state");
    } else {
      fail(where, `has kind ${JSON.stringify(event.kind)}`);
    }
  });
  return problems;
}
