import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnEnv } from "@buildanagent/harness/sandbox";
import { SDK_VERSION } from "@buildanagent/sdk";
import { afterAll, test } from "vitest";

// The terminal sessions the docs show are files in transcripts/, and this test runs each command and compares what it
// prints with its file. A changed output fails the test until the file is rewritten:
//
//   REWRITE_TRANSCRIPTS=1 pnpm --filter @buildanagent/cli exec vitest run test/transcripts.test.ts
//
// A transcript is the command line after a `$ ` prompt, with any environment variable the run needs before it, then
// standard output, then standard error, exactly as the binary wrote them. Each run starts from a cleared environment and
// an empty home folder, like bin.test.ts.
const BIN = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const SOURCE_CONDITION = fileURLToPath(new URL("./source-condition.mjs", import.meta.url));
const TRANSCRIPTS = new URL("../transcripts/", import.meta.url);
const TSX = import.meta.resolve("tsx");
const MODEL = "anthropic:claude-sonnet-5-5";
const PROMPT = "Why does the login test fail?";
// The one line a client writes to open a conversation, the same one the protocol's quick-start example writes.
const INITIALIZE =
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"clientInfo":{"name":"my-editor","version":"1.0.0"},"capabilities":[]}}';

interface Transcript {
  /** The file's name in transcripts/, without `.txt`. */
  readonly name: string;
  readonly args: readonly string[];
  readonly status: number;
  /** What the command reads from standard input, shown as `echo '<input>' | buildanagent ...`. */
  readonly input?: string;
  readonly env?: Record<string, string>;
}

const RUNS: readonly Transcript[] = [
  { name: "help", args: ["--help"], status: 0 },
  { name: "sessions-empty", args: ["sessions", "list"], status: 0 },
  { name: "no-model", args: ["run", PROMPT], status: 2 },
  { name: "no-key", args: ["run", "--model", MODEL, PROMPT], status: 2 },
  // `initialize` makes no model call, so a key that is not real is enough for the server to start.
  {
    name: "rpc-initialize",
    args: ["rpc", "--model", MODEL],
    status: 0,
    input: `${INITIALIZE}\n`,
    env: { ANTHROPIC_API_KEY: "not-a-real-key" },
  },
];

const homes: string[] = [];
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

const quote = (word: string) => (/^[\w./:@=-]+$/.test(word) ? word : `'${word}'`);

/** The line the transcript starts with: the command as a reader would type it. */
function commandLine(run: Transcript): string {
  // An environment variable the run needs is part of the command, so a reader who pastes it gets the same output.
  const variables = Object.entries(run.env ?? {}).map(([name, value]) => `${name}=${quote(value)}`);
  const command = [...variables, "buildanagent", ...run.args.map(quote)].join(" ");
  return run.input === undefined ? `$ ${command}` : `$ echo '${run.input.trimEnd()}' | ${command}`;
}

/** The SDK's version changes with every release, so a transcript names it as a placeholder, not as a number. */
function withoutVersion(text: string): string {
  return text.replaceAll(`"sdkVersion":"${SDK_VERSION}"`, '"sdkVersion":"<version>"');
}

function record(run: Transcript): { text: string; status: number | null } {
  const env = spawnEnv([]);
  homes.push(env.HOME as string);
  const home = env.HOME as string;
  const child = spawnSync(
    process.execPath,
    ["--conditions=source", "--import", SOURCE_CONDITION, "--import", TSX, BIN, ...run.args],
    { encoding: "utf8", env: { ...env, ...run.env }, input: run.input ?? "" },
  );
  const text = withoutVersion(`${commandLine(run)}\n${child.stdout}${child.stderr}`);
  assert.ok(!text.includes(home), `${run.name} shows this run's home folder`);
  return { text, status: child.status };
}

for (const run of RUNS) {
  test(`${run.name}.txt is what \`${commandLine(run).slice(2)}\` prints, and it exits ${run.status}`, () => {
    const file = new URL(`${run.name}.txt`, TRANSCRIPTS);
    const { text, status } = record(run);
    assert.equal(status, run.status, text);
    if (process.env.REWRITE_TRANSCRIPTS === "1") writeFileSync(file, text);
    assert.equal(
      readFileSync(file, "utf8"),
      text,
      "the command's output changed: rerun with REWRITE_TRANSCRIPTS=1 and commit the file",
    );
  });
}

test("transcripts/ holds one file for each run above, and nothing else", () => {
  assert.deepEqual(readdirSync(TRANSCRIPTS).sort(), RUNS.map((run) => `${run.name}.txt`).sort());
});

test("a transcript starts with a prompt and shows no home folder, so it reads the same on every machine", () => {
  for (const run of RUNS) {
    const text = readFileSync(new URL(`${run.name}.txt`, TRANSCRIPTS), "utf8");
    assert.ok(text.startsWith("$ buildanagent") || text.startsWith("$ echo "), run.name);
    assert.ok(text.endsWith("\n"), run.name);
    assert.doesNotMatch(text, /\/(?:Users|home|tmp|private|var\/folders)\//, `${run.name} shows a machine's path`);
  }
});
