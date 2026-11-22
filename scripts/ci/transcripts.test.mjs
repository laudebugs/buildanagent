// Offline tests for the transcript writer (scripts/transcripts/write.mjs) and for every committed transcript; run with
// `node --test scripts/ci/*.test.mjs`. A committed transcript must be well formed, written exactly as the writer
// writes it, and free of anything that ties it to one machine or one run.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { answerFacts, isPlaceholder, placeholder, reportedUsage } from "../transcripts/events.ts";
import {
  compactRequests,
  MOCK_PACKAGES,
  mergeEvents,
  mockOf,
  normalise,
  pinOf,
  serialise,
  TRANSCRIPT_FORMAT,
  transcriptProblems,
  writeTranscript,
} from "../transcripts/write.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const committed = execFileSync(
  "git",
  ["ls-files", "--", "verify/*/results/transcripts/*.json", "packages/*/results/transcripts/*.json"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\n")
  .filter(Boolean);

/**
 * Strings that would tie a transcript to this machine: its directories and the values of the environment variables
 * that name a place. The user and host names count only as a path segment (`/runner/`) or a whole host name, because
 * an example's own text can hold the same word: CI's user is `runner`, a word the examples use.
 */
function machinePatterns() {
  const values = new Set([homedir(), tmpdir(), root.replace(/\/$/, "")]);
  for (const name of ["HOME", "TMPDIR", "PWD", "RUNNER_TEMP"]) {
    if (process.env[name]) values.add(process.env[name]);
  }
  for (const dir of (process.env.PATH ?? "").split(":")) values.add(dir);
  const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [...values]
    .map((value) => value.replace(/\/$/, ""))
    .filter((value) => value.length >= 5)
    .map((value) => new RegExp(`${escaped(value)}(?=/|"|$)`));
  const names = [hostname(), process.env.HOSTNAME];
  try {
    names.push(userInfo().username);
  } catch {
    // No passwd entry, so no user name to look for.
  }
  for (const name of names) if (name && name.length >= 3) patterns.push(new RegExp(`/${escaped(name)}/`));
  if (hostname().length >= 3) patterns.push(new RegExp(`(?<![\\w.-])${escaped(hostname())}(?![\\w.-])`));
  return patterns;
}

test("the harnesses commit transcripts", () => {
  assert.ok(
    committed.length > 0,
    "no committed transcript under verify/*/results/transcripts/ or packages/*/results/transcripts/",
  );
});

test("one of our own packages records itself at `workspace`, so a release's version bump keeps its transcripts", () => {
  const sdk = join(root, "packages/sdk");
  assert.equal(pinOf(sdk), "@buildanagent/sdk@workspace");
  assert.equal(mockOf(sdk), "@buildanagent/sdk@workspace");
  assert.ok(committed.some((file) => file.startsWith("packages/sdk/results/transcripts/")));
});

for (const file of committed) {
  test(`${file} is well formed, canonical and tied to no machine`, () => {
    const text = readFileSync(join(root, file), "utf8");
    const transcript = JSON.parse(text);
    assert.deepEqual(transcriptProblems(transcript), []);
    assert.equal(serialise(transcript), text, "the file is not written as serialise() writes it");
    const [, harness, example] = /^((?:verify|packages)\/[^/]+)\/results\/transcripts\/(.+)\.json$/.exec(file);
    assert.equal(transcript.harness, harness);
    assert.equal(transcript.example, example);
    assert.ok(existsSync(join(root, transcript.file)), `${transcript.file} does not exist`);
    assert.equal(transcript.pin, pinOf(join(root, harness)), "the pin differs from the harness's package.json");
    assert.equal(transcript.mock, mockOf(join(root, harness)), "the mock layer's version differs from package.json");
    // A temporary directory a run makes has mkdtemp's six random characters; an example's own "/tmp/x" does not.
    for (const pattern of [
      /\/Users\//,
      /\/home\//,
      /\/private\//,
      /\/var\/folders\//,
      /\/tmp\/[\w.]+-\w{6}\b/,
      /[A-Z]:\\/,
    ]) {
      assert.doesNotMatch(text, pattern);
    }
    for (const pattern of machinePatterns()) assert.doesNotMatch(text, pattern);
  });
}

test("normalise() replaces machine paths and the SDK's generated ids, times and durations, and nothing scripted", () => {
  const cwd = join(tmpdir(), "example-cwd");
  const home = join(tmpdir(), "example-home");
  const generated = "toolu_01ABCdefGHIjklMNO";
  const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const text = (value) => ({ type: "text", text: value });
  const out = normalise(
    [
      {
        kind: "response",
        model: "model-1",
        message: {
          role: "assistant",
          parts: [
            text(`${cwd}/notes.txt, ${cwd}-other, ${home}/.config and ${root}README.md`),
            text("the runner ran at 2026-11-19T10:00:00Z on build host runner-1"),
            { type: "tool-call", id: "call_handoff", name: "t", input: { customerId: "cust_0123456789abcdef" } },
            { type: "tool-call", id: "call_weather_1", name: "t", input: { date: "2026-11-19" } },
            { type: "tool-call", id: generated, name: "t", input: {} },
            {
              type: "other",
              kind: "sdk",
              value: { timestamp: 1763546400000, durationMs: 42, run: uuid, at: "2026-11-19T10:00:00Z" },
            },
          ],
        },
        finish: "stop",
        usage: { uncachedInput: 1000, cacheRead: 1500, cacheWrite: 500, output: 200 },
        modelId: "claude-sonnet-5-5",
        scripted: ["call_handoff", "call_weather_1"],
      },
      {
        kind: "request",
        model: "model-1",
        repeated: 0,
        messages: [
          {
            role: "tool",
            parts: [{ type: "tool-result", id: generated, name: "t", output: { id: "order-000123456789" } }],
          },
          { role: "tool", parts: [{ type: "tool-result", id: "c1", name: "t", output: "short, but not scripted" }] },
        ],
        tools: [],
      },
    ],
    { cwd, home },
  );
  assert.deepEqual(out[0].message.parts, [
    text(`<cwd>/notes.txt, ${cwd}-other, <home>/.config and <repo>/README.md`),
    text("the runner ran at 2026-11-19T10:00:00Z on build host runner-1"),
    { type: "tool-call", id: "call_handoff", name: "t", input: { customerId: "cust_0123456789abcdef" } },
    { type: "tool-call", id: "call_weather_1", name: "t", input: { date: "2026-11-19" } },
    { type: "tool-call", id: "<id-1>", name: "t", input: {} },
    {
      type: "other",
      kind: "sdk",
      value: { timestamp: "<time>", durationMs: "<duration>", run: "<uuid-1>", at: "<time>" },
    },
  ]);
  assert.equal("scripted" in out[0], false, "the scripted list is not written");
  assert.deepEqual(out[0].usage, { uncachedInput: 1000, cacheRead: 1500, cacheWrite: 500, output: 200 });
  assert.equal(out[0].modelId, "claude-sonnet-5-5", "a scripted model id is kept as written");
  assert.deepEqual(
    out[1].messages.map((m) => m.parts[0].id),
    ["<id-1>", "<id-2>"],
    "a call's result keeps its call's placeholder, and an unscripted id is replaced whatever its length",
  );
});

test("normalise() leaves a scripted /tmp path alone and replaces only the run's own directories", () => {
  const before = process.env.TMPDIR;
  process.env.TMPDIR = "/tmp";
  try {
    const out = normalise(
      [
        {
          kind: "response",
          model: "model-1",
          message: {
            role: "assistant",
            parts: [{ type: "text", text: "wrote /tmp/report.txt from /tmp/run-AbC123/in" }],
          },
          finish: "stop",
        },
      ],
      { cwd: "/tmp/run-AbC123", home: "/tmp/home-XyZ789" },
    );
    assert.equal(out[0].message.parts[0].text, "wrote /tmp/report.txt from <cwd>/in");
  } finally {
    if (before === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = before;
  }
});

/** Runs a throwaway example under the recorder, from a temporary directory, and returns the events it recorded. */
function recordedEvents(source) {
  const dir = mkdtempSync(join(tmpdir(), "transcript-probe-"));
  try {
    const example = join(dir, "probe.ts");
    writeFileSync(example, source);
    const raw = join(dir, "events.json");
    spawnSync(
      process.execPath,
      ["--import", "tsx", "--import", join(root, "scripts/transcripts/record.mjs"), example],
      {
        cwd: root,
        env: { PATH: process.env.PATH, TRANSCRIPT_FILE: raw, NODE_NO_WARNINGS: "1" },
        encoding: "utf8",
      },
    );
    // Each raw event carries the millisecond it happened at, which the writer drops after merging a mock's events.
    return JSON.parse(readFileSync(raw, "utf8")).events.map(({ at, ...event }) => {
      assert.equal(typeof at, "number");
      return event;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("the Claude Agent SDK and Copilot SDK transcripts name only the tools an example gave the model, not the CLI's or runtime's built-ins", async () => {
  const { BUILTIN_DENY } = await import(
    new URL("../../verify/copilot-sdk/scripts/mock-model.mjs", import.meta.url).href
  );
  for (const file of committed.filter((f) => /^verify\/(claude-agent-sdk|copilot-sdk)\//.test(f))) {
    const { events } = JSON.parse(readFileSync(join(root, file), "utf8"));
    for (const event of events.filter((e) => e.kind === "request")) {
      for (const tool of event.tools ?? []) {
        if (file.includes("claude-agent-sdk"))
          assert.match(tool, /^mcp__/, `${file} lists ${tool}, a built-in of the CLI`);
        else assert.ok(!BUILTIN_DENY.test(tool), `${file} lists ${tool}, a built-in of the runtime`);
      }
    }
  }
});

test("a mock's events and an example's events merge in the order they happened, the mock first at the same millisecond", () => {
  const mock = [
    { kind: "request", at: 10 },
    { kind: "response", at: 20 },
    { kind: "request", at: 40 },
  ];
  const example = [
    { kind: "check", at: 20 },
    { kind: "check", at: 30 },
    { kind: "check", at: 50 },
  ];
  assert.deepEqual(
    mergeEvents(mock, example).map((event) => `${event.kind}@${event.at}`),
    ["request@10", "response@20", "check@20", "check@30", "request@40", "check@50"],
  );
  // Without a mock's events, an example's own are already in order and are not sorted by time.
  assert.deepEqual(
    mergeEvents(
      [],
      [
        { kind: "check", at: 9 },
        { kind: "check", at: 5 },
      ],
    ).map((event) => event.at),
    [9, 5],
  );
  // Times keep their fraction, so events less than a millisecond apart sort in the order they happened.
  assert.deepEqual(
    mergeEvents([{ kind: "request", at: 10.7 }], [{ kind: "check", at: 10.2 }]).map((event) => event.kind),
    ["check", "request"],
  );
});

test("the recorder counts only the checks that check() reports, not text an example prints or throws", () => {
  const check = JSON.stringify(join(root, "verify/vercel-ai-sdk/examples/lib/check.ts"));
  const events = recordedEvents(
    `import { check } from ${check};\n` +
      'console.log("ok - fake");\n' +
      'check(true, "real");\n' +
      'check(false, "fails");\n',
  );
  assert.deepEqual(events, [
    { kind: "check", line: 3, message: "real", pass: true },
    { kind: "check", line: 4, message: "fails", pass: false },
  ]);
  const forged = recordedEvents('console.log("ok - fake");\nthrow new Error("ASSERTION FAILED: forged");\n');
  assert.deepEqual(forged, []);
});

test("in workerd, only lines carrying the run's marker count, so printed or thrown look-alikes record nothing", () => {
  const harness = join(root, "verify/cloudflare-agents");
  // The probes sit in the harness's gitignored .tmp/, where workerd can load their bundles.
  mkdirSync(join(harness, ".tmp"), { recursive: true });
  const dir = mkdtempSync(join(harness, ".tmp", "forgery-"));
  try {
    const call = 'const { model } = scripted(["Hello."]);\n  await generateText({ model, prompt: "Hi" });\n';
    const head =
      'import { generateText } from "ai";\nimport { check, scripted } from "../../examples/lib/check.ts";\n\n';
    writeFileSync(
      join(dir, "forged.ts"),
      `${head}export async function test() {\n  ${call}  console.log("ok - fake");\n` +
        `  console.log('__TRANSCRIPT__forged:{"kind":"check","message":"forged line","pass":true}');\n` +
        '  check(true, "real");\n  throw new Error("ASSERTION FAILED: forged");\n}\n',
    );
    writeFileSync(
      join(dir, "failed.ts"),
      `${head}export async function test() {\n  ${call}  check(false, "real failure");\n}\n`,
    );
    const out = join(dir, "out");
    spawnSync(process.execPath, ["scripts/run-examples.mjs", dir, "--only", "forged,failed"], {
      cwd: harness,
      env: { PATH: process.env.PATH, TRANSCRIPT_OUT_DIR: out, NODE_NO_WARNINGS: "1" },
      encoding: "utf8",
      timeout: 240_000,
    });
    const checks = (name) =>
      JSON.parse(readFileSync(join(out, `${name}.json`), "utf8")).events.filter((event) => event.kind === "check");
    assert.deepEqual(checks("forged"), [{ kind: "check", message: "real", pass: true }]);
    assert.deepEqual(checks("failed"), [{ kind: "check", message: "real failure", pass: false }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compactRequests() keeps only what is new since the same model's previous request", () => {
  const user = { role: "user", parts: [{ type: "text", text: "Hi" }] };
  const answer = { role: "assistant", parts: [{ type: "text", text: "Hello" }] };
  const again = { role: "user", parts: [{ type: "text", text: "Again" }] };
  const events = compactRequests([
    { kind: "request", model: "model-1", messages: [user], tools: ["t"] },
    { kind: "response", model: "model-1", message: answer, finish: "stop" },
    { kind: "request", model: "model-2", messages: [again], tools: [] },
    { kind: "request", model: "model-1", messages: [user, answer, again], tools: ["t"] },
  ]);
  assert.deepEqual(
    events
      .filter((event) => event.kind === "request")
      .map((event) => [event.model, event.repeated, event.messages.length, Object.keys(event).at(-1)]),
    [
      ["model-1", 0, 1, "tools"],
      ["model-2", 0, 1, "tools"],
      ["model-1", 2, 1, "tools"],
    ],
    "the model's answer counts as repeated too",
  );
});

test("writeTranscript() writes the same bytes from two runs in different directories", () => {
  const harnessDir = join(root, "verify/vercel-ai-sdk");
  const outputs = [1, 2].map((run) => {
    const dir = mkdtempSync(join(tmpdir(), `transcript-run-${run}-`));
    try {
      const raw = join(dir, "events.json");
      const cwd = join(dir, "cwd");
      mkdirSync(cwd);
      writeFileSync(
        raw,
        JSON.stringify({
          events: [
            { kind: "request", line: 3, model: "model-1", messages: [{ role: "user", parts: [] }], tools: [] },
            {
              kind: "response",
              line: 3,
              model: "model-1",
              message: { role: "assistant", parts: [{ type: "text", text: `wrote ${cwd}/out.txt` }] },
              finish: "stop",
            },
            { kind: "check", line: 4, message: "it wrote", pass: true },
          ],
        }),
      );
      const exampleFile = join(harnessDir, "examples", "transcript-writer-test.ts");
      const outDir = join(dir, "out");
      const written = writeTranscript({ harnessDir, exampleFile, rawFile: raw, cwd, home: dir, outDir });
      return readFileSync(written, "utf8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  assert.equal(outputs[0], outputs[1]);
  assert.match(outputs[0], /wrote <cwd>\/out\.txt/);
  assert.match(outputs[0], /"mock": "ai@\d/);
});

test("writeTranscript() deletes a committed transcript when the example recorded no model request", () => {
  const dir = mkdtempSync(join(tmpdir(), "transcript-empty-"));
  try {
    const raw = join(dir, "events.json");
    writeFileSync(raw, JSON.stringify({ events: [{ kind: "check", message: "no model", pass: true }] }));
    const outDir = join(dir, "out");
    mkdirSync(outDir);
    const stale = join(outDir, "transcript-writer-empty.json");
    writeFileSync(stale, "{}\n");
    const harnessDir = join(root, "verify/vercel-ai-sdk");
    const exampleFile = join(harnessDir, "examples", "transcript-writer-empty.ts");
    const errors = [];
    const error = console.error;
    console.error = (message) => errors.push(message);
    try {
      assert.equal(writeTranscript({ harnessDir, exampleFile, rawFile: raw, cwd: dir, home: dir, outDir }), undefined);
    } finally {
      console.error = error;
    }
    assert.equal(existsSync(stale), false, "the stale transcript is deleted, so results-drift reports it");
    assert.match(errors.join("\n"), /recorded no model request/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every recorded harness names the package its recorder attaches to", () => {
  for (const harness of new Set(committed.map((file) => file.split("/").slice(0, 2).join("/")))) {
    assert.ok(MOCK_PACKAGES[harness], `${harness} has transcripts but no entry in MOCK_PACKAGES`);
  }
});

/** The lines of each `// #region` in a file, which the book can list. */
function regionLines(text) {
  const lines = text.split("\n");
  const open = [];
  const inside = new Set();
  lines.forEach((line, index) => {
    if (/^\s*\/\/\s*#region\b/.test(line)) open.push(index);
    else if (/^\s*\/\/\s*#endregion\b/.test(line)) {
      const start = open.pop();
      for (let i = start + 1; i < index; i++) inside.add(i);
    }
  });
  return [...inside].sort((a, b) => a - b).map((index) => [index + 1, lines[index]]);
}

test("no region the book can list holds transcript-recorder code", () => {
  const files = execFileSync("git", ["ls-files", "--", "verify/*/examples/*.ts", "verify/*/examples/**/*.ts"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean);
  assert.ok(files.length > 50, "the examples were not found");
  const plumbing = /transcript|\brecord(?:ed)?[A-Z(]|recording|recordCallers|atCaller|buildanagent\.transcript/;
  const found = [];
  for (const file of files) {
    for (const [line, text] of regionLines(readFileSync(join(root, file), "utf8"))) {
      if (plumbing.test(text)) found.push(`${file}:${line}: ${text.trim()}`);
    }
  }
  assert.deepEqual(found, []);
});

test("the format is version 2, the first with a response's usage and model id", () => {
  assert.equal(TRANSCRIPT_FORMAT, 2);
  const versions = new Set(committed.map((file) => JSON.parse(readFileSync(join(root, file), "utf8")).format));
  assert.deepEqual([...versions], [TRANSCRIPT_FORMAT], "every committed transcript is written at the current version");
});

test("the AI SDK's streaming-usage transcript records the scripted usage and model id on its answer", () => {
  const file = join(root, "verify/vercel-ai-sdk/results/transcripts/10-streaming-usage.json");
  const [answer] = JSON.parse(readFileSync(file, "utf8")).events.filter((event) => event.kind === "response");
  assert.equal(answer.modelId, "claude-sonnet-5-5");
  assert.deepEqual(answer.usage, { uncachedInput: 1000, cacheRead: 1500, cacheWrite: 500, output: 200 });
});

test("a helper's default usage is recorded nowhere: the AI SDK's 10 and 5 tokens and ai/test's mock-model-id", () => {
  const file = join(root, "verify/vercel-ai-sdk/results/transcripts/01-generate-text.json");
  const events = JSON.parse(readFileSync(file, "utf8")).events.filter((event) => event.kind === "response");
  assert.ok(events.length > 0);
  for (const event of events) {
    assert.equal("usage" in event, false, "a placeholder usage is left out");
    assert.equal("modelId" in event, false, "a generated model id is left out");
  }
});

test("reportedUsage() keeps each class the mock counted and leaves out the rest, never writing a zero it lacks", () => {
  assert.deepEqual(
    reportedUsage({ uncachedInput: 1000, cacheRead: 0, cacheWrite: undefined, output: 200, reasoning: Number.NaN }),
    { uncachedInput: 1000, cacheRead: 0, output: 200 },
  );
  assert.equal(reportedUsage({ uncachedInput: undefined, output: undefined }), undefined);
  assert.equal(reportedUsage({ output: -1 }), undefined, "a negative count is no count");
  const usage = { uncachedInput: 1 };
  assert.deepEqual(answerFacts(usage, "m"), { usage, modelId: "m" });
  assert.deepEqual(answerFacts(undefined, ""), {});
  const marked = placeholder({ total: 10 });
  assert.equal(isPlaceholder(marked), true);
  assert.equal(isPlaceholder({ total: 10 }), false, "an equal object a script passed is not the placeholder");
});

test("transcriptProblems() checks a response's usage and model id", () => {
  const transcript = (response) => ({
    format: TRANSCRIPT_FORMAT,
    example: "x",
    file: "x.ts",
    harness: "verify/x",
    pin: "x@1.0.0",
    mock: "x@1.0.0",
    events: [
      {
        kind: "response",
        model: "model-1",
        message: { role: "assistant", parts: [] },
        finish: "stop",
        ...response,
      },
    ],
  });
  assert.deepEqual(
    transcriptProblems(transcript({ usage: { uncachedInput: 1000, cacheRead: 0, output: 200 }, modelId: "a/b@1" })),
    [],
  );
  assert.deepEqual(transcriptProblems(transcript({ usage: { input: 3, output: 1.5 }, modelId: "**bold**" })), [
    'events[0].usage: has a token class "input"',
    "events[0].usage: output is not a whole number",
    "events[0]: has a model id outside [A-Za-z0-9_.:/@-]",
  ]);
  assert.deepEqual(transcriptProblems(transcript({ usage: {} })), [
    "events[0].usage: must be an object with at least one token class",
  ]);
});

test("transcriptProblems() names what is wrong with a malformed transcript", () => {
  assert.deepEqual(
    transcriptProblems({
      format: 1,
      example: "x",
      file: "",
      harness: "verify/x",
      pin: "x@1.0.0",
      mock: "x@1.0.0",
      events: [
        { kind: "request", model: "model-1", repeated: -1, messages: [{ role: "robot", parts: [] }] },
        { kind: "check", line: 0, message: "ok" },
        { kind: "thought" },
      ],
    }),
    [
      "format: is 1, not 2",
      "file: must be a non-empty string",
      "events[0]: has no count of repeated messages",
      'events[0].messages[0]: has role "robot"',
      "events[1]: has a line that is not a positive integer",
      "events[1]: has no pass state",
      'events[2]: has kind "thought"',
    ],
  );
});
