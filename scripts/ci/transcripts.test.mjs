// Offline tests for the transcript writer (scripts/transcripts/write.mjs) and for every committed transcript; run with
// `node --test scripts/ci/*.test.mjs`. A committed transcript must be well formed, written exactly as the writer
// writes it, and free of anything that ties it to one machine or one run.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  compactRequests,
  MOCK_PACKAGES,
  mockOf,
  normalise,
  pinOf,
  serialise,
  transcriptProblems,
  writeTranscript,
} from "../transcripts/write.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const committed = execFileSync("git", ["ls-files", "--", "verify/*/results/transcripts/*.json"], {
  cwd: root,
  encoding: "utf8",
})
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
  assert.ok(committed.length > 0, "no committed transcript under verify/*/results/transcripts/");
});

for (const file of committed) {
  test(`${file} is well formed, canonical and tied to no machine`, () => {
    const text = readFileSync(join(root, file), "utf8");
    const transcript = JSON.parse(text);
    assert.deepEqual(transcriptProblems(transcript), []);
    assert.equal(serialise(transcript), text, "the file is not written as serialise() writes it");
    const [, harness, example] = /^(verify\/[^/]+)\/results\/transcripts\/(.+)\.json$/.exec(file);
    assert.equal(transcript.harness, harness);
    assert.equal(transcript.example, example);
    assert.ok(existsSync(join(root, transcript.file)), `${transcript.file} does not exist`);
    assert.equal(transcript.pin, pinOf(join(root, harness)), "the pin differs from the harness's package.json");
    assert.equal(transcript.mock, mockOf(join(root, harness)), "the mock layer's version differs from package.json");
    for (const pattern of [/\/Users\//, /\/home\//, /\/private\//, /\/var\/folders\//, /\/tmp\//, /[A-Z]:\\/]) {
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
  const response = (parts) => ({
    kind: "response",
    model: "model-1",
    message: { role: "assistant", parts },
    finish: "stop",
  });
  const out = normalise(
    [
      response([
        text(`${cwd}/notes.txt, ${cwd}-other, ${home}/.config and ${root}README.md`),
        text("the runner ran at 2026-11-19T10:00:00Z on build host runner-1"),
        {
          type: "tool-call",
          id: generated,
          name: "t",
          input: { customerId: "cust_0123456789abcdef", date: "2026-11-19" },
        },
        {
          type: "tool-result",
          id: "call_1",
          name: "t",
          output: { id: "order-000123456789", at: "2026-11-19T10:00:00Z" },
        },
        {
          type: "other",
          kind: "sdk",
          value: { timestamp: 1763546400000, durationMs: 42, run: uuid, at: "2026-11-19T10:00:00Z" },
        },
        { type: "tool-call", id: "short", name: "t", input: {} },
      ]),
    ],
    { cwd, home },
  );
  assert.deepEqual(out[0].message.parts, [
    text("<cwd>/notes.txt, <tmp>/example-cwd-other, <home>/.config and <repo>/README.md"),
    text("the runner ran at 2026-11-19T10:00:00Z on build host runner-1"),
    { type: "tool-call", id: "<id-1>", name: "t", input: { customerId: "cust_0123456789abcdef", date: "2026-11-19" } },
    { type: "tool-result", id: "call_1", name: "t", output: { id: "order-000123456789", at: "2026-11-19T10:00:00Z" } },
    {
      type: "other",
      kind: "sdk",
      value: { timestamp: "<time>", durationMs: "<duration>", run: "<uuid-1>", at: "<time>" },
    },
    { type: "tool-call", id: "short", name: "t", input: {} },
  ]);
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

test("transcriptProblems() names what is wrong with a malformed transcript", () => {
  assert.deepEqual(
    transcriptProblems({
      format: 2,
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
      "format: is 2, not 1",
      "file: must be a non-empty string",
      "events[0]: has no count of repeated messages",
      'events[0].messages[0]: has role "robot"',
      "events[1]: has a line that is not a positive integer",
      "events[1]: has no pass state",
      'events[2]: has kind "thought"',
    ],
  );
});
