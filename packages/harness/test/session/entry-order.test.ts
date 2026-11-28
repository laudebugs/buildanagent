// A session's log must not depend on how long its store takes to append. Each capstone case runs on the JSONL files,
// on the in-memory store, on the DynamoDB store over a fake client and on the Postgres store over PGlite. All four must
// write the same entries: the same ids, parents, times and contents. The rejected case is the one whose ids depend on
// append timing: its denied tool_result and the next message take ids from the same generator one after the other.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dynamoStore } from "@buildanagent/harness/aws/dynamodb";
import { memoryStore, type SessionStore } from "@buildanagent/harness/session";
import { createPostgresHarnessTables, postgresStore } from "@buildanagent/harness/vercel";
import type { SessionEntry } from "@buildanagent/protocol";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, test } from "vitest";
import { fakeDynamoDb } from "../aws/fake-dynamodb.js";
import {
  CASES,
  type CaseName,
  entriesOf,
  type Files,
  filesAt,
  recordCase,
  scrubbing,
} from "../capstone/triage-fixture.js";

const dirs: string[] = [];
const databases: PGlite[] = [];
afterAll(async () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  for (const db of databases) await db.close();
});

/** The capstone's files in a new folder: the JSONL store with its index and lock. */
function files() {
  const dir = mkdtempSync(join(tmpdir(), "entry-order-"));
  dirs.push(dir);
  return filesAt(dir);
}

async function postgres(): Promise<SessionStore> {
  const db = new PGlite();
  databases.push(db);
  await createPostgresHarnessTables(db);
  return postgresStore(db);
}

/** The stores compared with the JSONL files, each made fresh for one run. */
const OTHER_STORES: Record<string, () => SessionStore | Promise<SessionStore>> = {
  "in-memory": () => memoryStore(),
  DynamoDB: () => dynamoStore(fakeDynamoDb().client, { tableName: "harness-sessions" }),
  Postgres: postgres,
};

/** One run of a case on `run`'s store, and the entries it wrote. */
async function logOf(name: CaseName, run: Files): Promise<SessionEntry[]> {
  await recordCase(run, CASES[name]);
  return entriesOf(run);
}

describe("a session's entries do not depend on its store's speed", () => {
  for (const name of Object.keys(CASES) as CaseName[]) {
    for (const [label, make] of Object.entries(OTHER_STORES)) {
      test(`the ${name} case writes the JSONL run's log on the ${label} store`, async () => {
        const onFiles = await logOf(name, files());
        const run = { ...files(), store: scrubbing(await make()) };
        assert.deepEqual(await logOf(name, run), onFiles);
      });
    }
  }
});
