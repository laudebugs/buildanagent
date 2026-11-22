// Runs one turn with `buildanagent run --json` from a program and reads its events, one JSON object per line.

import { type CliIo, runCli } from "@buildanagent/cli";
import type { Model } from "@buildanagent/gateway";

/** Asks `question`, keeps sessions under `stateDir`, and returns the exit status and the parsed JSON lines. */
export async function askOnce(model: Model, stateDir: string, question: string) {
  let stdout = "";
  const io: CliIo = {
    write: (text) => {
      stdout += text;
    },
    error: (text) => console.error(text),
    readLine: async () => undefined,
    env: {},
    cwd: process.cwd(),
  };
  const status = await runCli(["run", "--json", "--state-dir", stateDir, question], { io, model });
  const lines = stdout.split("\n").filter((line) => line !== "");
  return { status, objects: lines.map((line) => JSON.parse(line) as { type: string }) };
}
