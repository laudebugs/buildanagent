import { rmSync } from "node:fs";
import { spawnEnv } from "@buildanagent/harness/sandbox";
import { afterAll } from "vitest";

// Every `spawnEnv()` call makes a temp HOME that the caller removes, so a test file that spawns processes calls
// `testEnv()` instead and gets them all removed when the file ends.
const made: string[] = [];

afterAll(() => {
  for (const folder of made.splice(0)) rmSync(folder, { recursive: true, force: true });
});

/** `spawnEnv()` whose temp HOME is removed after the test file. */
export function testEnv(allow: string[] = [], extra?: Record<string, string>): Record<string, string> {
  const env = spawnEnv(allow, extra);
  if (env.HOME !== undefined && extra?.HOME === undefined) made.push(env.HOME);
  return env;
}
