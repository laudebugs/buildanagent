/**
 * The session store conformance suite: what every `SessionStore` must do. The cases import no test runner and no Node
 * module, so any runner can call them, in workerd too. A case that needs a backend to expose a file skips, and
 * reports why, when the factory gives it no `tearLastLine`.
 */
import type { SessionEntry } from "@buildanagent/protocol";
import { isHarnessError } from "../errors.js";
import { ConflictError, EntryTooLargeError } from "../session/errors.js";
import type { EntryInput, SessionKey, SessionStore } from "../session/store.js";
import { type CaseReport, type RunnableCase, runCases } from "./run-cases.js";

/** What a factory returns: a fresh, empty store, and optionally a way to tear a log's last line. */
export interface StoreUnderTest {
  readonly store: SessionStore;
  /**
   * Leaves the session's log ending in a line that was never completed, as a crash in the middle of a write would, by
   * appending partial JSON with no newline. Without it the torn-line cases skip, because a store need not be a file.
   */
  readonly tearLastLine?: (key: SessionKey) => void | Promise<void>;
}

/** Makes a fresh store for each case. */
export type StoreFactory = () => StoreUnderTest | Promise<StoreUnderTest>;

/** One case of the store conformance suite, which a runner can register as a test of its own. */
export type StoreCase = RunnableCase;

/** The report the store conformance suite returns: which cases passed, which skipped with a reason and which failed. */
export type StoreConformanceReport = CaseReport;

const ADA: SessionKey = { userId: "ada", sessionId: "s1" };
const BOB = { userId: "bob", sessionId: "s1" };

function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Session store conformance: ${message}`);
}

const header = (id = "h1", timestamp = "2026-01-01T00:00:00.000Z"): EntryInput => ({
  id,
  parentId: null,
  timestamp,
  origin: "harness",
  type: "session_header",
  formatVersion: 1,
  harnessVersion: "0.0.0",
  sdkVersion: "0.0.0",
  defaultsHash: "d",
  capabilities: [],
  ablationHash: "a",
});

const record = (id: string, parentId: string, data: unknown = {}): EntryInput => ({
  id,
  parentId,
  timestamp: "2026-01-01T00:00:01.000Z",
  origin: "harness",
  type: "product_record",
  name: "test.record",
  data,
});

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const entry of source) found.push(entry);
  return found;
}

const ids = (entries: readonly SessionEntry[]) => entries.map((entry) => entry.id);

async function rejects(run: () => Promise<unknown>, test: (error: unknown) => boolean, message: string) {
  try {
    await run();
  } catch (error) {
    check(test(error), `${message}, but it threw ${String(error)}`);
    return;
  }
  check(false, `${message}, but it did not throw`);
}

const hasCode = (code: string) => (error: unknown) => isHarnessError(error) && error.code === code;

type Skip = { readonly skipped: string };
type Body = (under: StoreUnderTest) => Promise<Skip | undefined | unknown>;

function appendCases(open: (body: Body) => Promise<{ skipped: string } | undefined>): StoreCase[] {
  const cases: [string, Body][] = [
    [
      "append assigns seq from 0 and load returns the entries in order",
      async ({ store }) => {
        const written = await store.append(ADA, [header(), record("r1", "h1"), record("r2", "r1")]);
        check(written.map((entry) => entry.seq).join() === "0,1,2", "append returns each entry with its seq");
        const loaded = await collect(store.load(ADA));
        check(ids(loaded).join() === "h1,r1,r2", "load returns the entries in order");
        const more = await store.append(ADA, [record("r3", "r2")]);
        check(more[0]?.seq === 3, "a later append goes on from the last seq");
      },
    ],
    [
      "appending the same entry twice stores it once",
      async ({ store }) => {
        await store.append(ADA, [header(), record("r1", "h1")]);
        const again = await store.append(ADA, [record("r1", "h1")]);
        check(again.length === 1 && again[0]?.seq === 1, "the retry returns the stored entry");
        check((await collect(store.load(ADA))).length === 2, "the entry is in the log once");
      },
    ],
    [
      "an entry id stored with different content is a ConflictError",
      async ({ store }) => {
        await store.append(ADA, [header(), record("r1", "h1", { a: 1 })]);
        await rejects(
          () => store.append(ADA, [record("r1", "h1", { a: 2 })]),
          (error) => error instanceof ConflictError && isHarnessError(error) && error.code === "session_conflict",
          "reusing an id with other content must throw a ConflictError",
        );
        const same = await store.append(ADA, [record("r1", "h1", { a: 1 })]);
        check(same.length === 1, "the same content under that id is still a retry");
      },
    ],
    [
      "a batch that is partly stored finishes on a retry, and one stored out of order conflicts",
      async ({ store }) => {
        await store.append(ADA, [header(), record("r1", "h1")]);
        const finished = await store.append(ADA, [record("r1", "h1"), record("r2", "r1")]);
        check(
          ids(finished).join() === "r1,r2" && finished[1]?.seq === 2,
          "the stored prefix is kept and the rest written",
        );
        await rejects(
          () => store.append(ADA, [record("r3", "r2"), record("r1", "h1")]),
          (error) => error instanceof ConflictError,
          "a stored entry after a new one must conflict",
        );
        check((await collect(store.load(ADA))).length === 3, "the failed batch wrote nothing");
      },
    ],
  ];
  return cases.map(([name, body]) => ({ name, run: () => open(body) }));
}

function conflictCases(open: (body: Body) => Promise<{ skipped: string } | undefined>): StoreCase[] {
  const cases: [string, Body][] = [
    [
      "a retry of a partly stored batch conflicts once another writer has extended the log",
      async ({ store }) => {
        await store.append(ADA, [header()]);
        await store.append(ADA, [record("a1", "h1")], { expectedLastId: "h1" });
        await store.append(ADA, [record("b1", "a1")], { expectedLastId: "a1" });
        await rejects(
          () => store.append(ADA, [record("a1", "h1"), record("a2", "a1")], { expectedLastId: "h1" }),
          (error) => error instanceof ConflictError,
          "a1 is stored but is no longer the end of the log, so a2 must not be written after b1",
        );
        check(ids(await collect(store.load(ADA))).join() === "h1,a1,b1", "the retry wrote nothing");
      },
    ],
    [
      "a stale expectedLastId is a ConflictError and writes nothing",
      async ({ store }) => {
        await rejects(
          () => store.append(ADA, [header()], { expectedLastId: "x" }),
          (error) => error instanceof ConflictError,
          "a new session expects null, not an id",
        );
        await store.append(ADA, [header()], { expectedLastId: null });
        await store.append(ADA, [record("r1", "h1")], { expectedLastId: "h1" });
        await rejects(
          () => store.append(ADA, [record("r2", "r1")], { expectedLastId: "h1" }),
          (error) => error instanceof ConflictError,
          "an old tail must conflict",
        );
        await rejects(
          () => store.append(ADA, [record("r2", "r1")], { expectedLastId: null }),
          (error) => error instanceof ConflictError,
          "null on a session that exists must conflict",
        );
        check(ids(await collect(store.load(ADA))).join() === "h1,r1", "the failed appends wrote nothing");
      },
    ],
    [
      "a load yields the entries present when it began, even if the caller appends while it iterates",
      async ({ store }) => {
        await store.append(ADA, [header(), record("r1", "h1")]);
        const seen: string[] = [];
        for await (const entry of store.load(ADA)) {
          seen.push(entry.id);
          if (seen.length < 5) await store.append(ADA, [record(`n${seen.length}`, entry.id)]);
        }
        check(seen.join() === "h1,r1", "the loop saw the two entries that existed, and ended");
        check((await collect(store.load(ADA))).length === 4, "the two appends made during it were stored");
      },
    ],
    [
      "load from a sequence skips the earlier entries",
      async ({ store }) => {
        await store.append(ADA, [header(), record("r1", "h1"), record("r2", "r1")]);
        check(ids(await collect(store.load(ADA, { fromSeq: 1 }))).join() === "r1,r2", "fromSeq 1 starts at seq 1");
        check((await collect(store.load(ADA, { fromSeq: 9 }))).length === 0, "past the end yields nothing");
      },
    ],
  ];
  return cases.map(([name, body]) => ({ name, run: () => open(body) }));
}

function validationCases(open: (body: Body) => Promise<{ skipped: string } | undefined>): StoreCase[] {
  const cases: [string, Body][] = [
    [
      "a first entry that is not a header, a second header and an invalid entry are refused",
      async ({ store }) => {
        const invalid = hasCode("invalid_session_entry");
        await rejects(() => store.append(ADA, [record("r1", "h1")]), invalid, "a log must start with a header");
        await store.append(ADA, [header()]);
        await rejects(() => store.append(ADA, [header("h2")]), invalid, "only the first entry may be a header");
        await rejects(
          () => store.append(ADA, [{ ...record("r1", "h1"), timestamp: "yesterday" }]),
          invalid,
          "an entry the protocol rejects must be refused",
        );
        await rejects(
          () => store.append(ADA, [record("r1", "h1"), record("r1", "h1")]),
          invalid,
          "a batch repeating an id must be refused",
        );
        check((await collect(store.load(ADA))).length === 1, "refused appends wrote nothing");
      },
    ],
    [
      "an entry over 64 KiB is an EntryTooLargeError, and a batch with one writes none of it",
      async ({ store }) => {
        const big = record("big", "h1", { text: "x".repeat(64 * 1024) });
        await store.append(ADA, [header()]);
        await rejects(
          () => store.append(ADA, [record("ok", "h1"), big]),
          (error) => error instanceof EntryTooLargeError && error.entryId === "big" && error.maxBytes === 64 * 1024,
          "an oversize entry must throw an EntryTooLargeError",
        );
        check((await collect(store.load(ADA))).length === 1, "the small entry before it was not written either");
        await store.append(ADA, [record("small", "h1", { text: "x".repeat(60 * 1024) })]);
      },
    ],
  ];
  return cases.map(([name, body]) => ({ name, run: () => open(body) }));
}

function identityCases(open: (body: Body) => Promise<{ skipped: string } | undefined>): StoreCase[] {
  const cases: [string, Body][] = [
    [
      "a caller that changes an entry after appending it does not change the stored one",
      async ({ store }) => {
        const data = { a: 1 };
        await store.append(ADA, [header(), record("r1", "h1", data)]);
        data.a = 2;
        const again = await store.append(ADA, [record("r1", "h1", { a: 1 })]);
        check(again.length === 1, "a retry with the original content is still a retry");
        await rejects(
          () => store.append(ADA, [record("r1", "h1", { a: 2 })]),
          (error) => error instanceof ConflictError,
          "the changed content must conflict, because the stored entry did not change",
        );
        const [, stored] = await collect(store.load(ADA));
        (stored as { data: { a: number } }).data.a = 9;
        check(
          ((await collect(store.load(ADA)))[1] as unknown as { data: { a: number } }).data.a === 1,
          "a loaded entry is a copy",
        );
      },
    ],
    [
      "ids that differ only in letter case are different users and sessions",
      async ({ store }) => {
        await store.append({ userId: "Ada", sessionId: "S1" }, [header("upper")]);
        await store.append({ userId: "ada", sessionId: "s1" }, [header("lower")]);
        check(
          ids(await collect(store.load({ userId: "Ada", sessionId: "S1" }))).join() === "upper",
          "Ada's S1 holds its own entries",
        );
        check(
          ids(await collect(store.load({ userId: "ada", sessionId: "s1" }))).join() === "lower",
          "and ada's s1 holds its own",
        );
        check((await collect(store.list("Ada"))).length === 1, "each user lists one session");
      },
    ],
  ];
  return cases.map(([name, body]) => ({ name, run: () => open(body) }));
}

function keyCases(open: (body: Body) => Promise<{ skipped: string } | undefined>): StoreCase[] {
  const cases: [string, Body][] = [
    [
      "append rejects, and does not throw, for a key it can't use, and every store agrees on which keys those are",
      async ({ store }) => {
        const invalid = hasCode("invalid_session_key");
        await rejects(
          () => store.append({ userId: "", sessionId: "s" }, [header()]),
          invalid,
          "an empty user is refused",
        );
        await rejects(
          () => store.append({ userId: "u", sessionId: "é".repeat(64) }, [header()]),
          invalid,
          "a name that encodes to over 200 bytes is refused by every store",
        );
        await rejects(
          () => store.append({ userId: "\ud800", sessionId: "s" }, [header()]),
          invalid,
          "a lone surrogate would encode like another id, so it is refused",
        );
        await store.append({ userId: "u", sessionId: "e".repeat(64) }, [header()]);
      },
    ],
    [
      "a user id or session id that is empty or has a control character is refused",
      async ({ store }) => {
        const invalid = hasCode("invalid_session_key");
        for (const key of [
          { userId: "", sessionId: "s" },
          { userId: "u", sessionId: "" },
          { userId: "u", sessionId: "a\nb" },
        ]) {
          await rejects(() => store.append(key, [header()]), invalid, `${JSON.stringify(key)} must be refused`);
        }
        await store.append({ userId: "u/../x", sessionId: "../../y" }, [header()]);
        check(
          (await collect(store.load({ userId: "u/../x", sessionId: "../../y" }))).length === 1,
          "an id that looks like a path is a name, and works",
        );
      },
    ],
  ];
  return cases.map(([name, body]) => ({ name, run: () => open(body) }));
}

function listAndOwnerCases(open: (body: Body) => Promise<{ skipped: string } | undefined>): StoreCase[] {
  const cases: [string, Body][] = [
    [
      "list returns the user's sessions from their headers, oldest first, and delete removes one",
      async ({ store }) => {
        await store.append({ userId: "ada", sessionId: "late" }, [
          header("h", "2026-01-02T00:00:00.000Z"),
          record("r", "h"),
        ]);
        await store.append({ userId: "ada", sessionId: "early" }, [header("h", "2026-01-01T00:00:00.000Z")]);
        const listed = await collect(store.list("ada"));
        check(listed.map((summary) => summary.sessionId).join() === "early,late", "list is oldest first");
        const late = listed[1];
        check(
          late?.entryCount === 2 && late.startedAt === "2026-01-02T00:00:00.000Z",
          "the summary comes from the entries",
        );
        await store.delete({ userId: "ada", sessionId: "early" });
        check((await collect(store.list("ada"))).length === 1, "delete removes the session");
        await store.delete({ userId: "ada", sessionId: "early" });
      },
    ],
    [
      "another user's session looks the same as one that was never created",
      async ({ store }) => {
        await store.append(ADA, [header(), record("r1", "h1")]);
        const neverMade = await collect(store.load({ userId: "bob", sessionId: "never" }));
        const adasUnderBob = await collect(store.load(BOB));
        check(
          neverMade.length === 0 && adasUnderBob.length === 0,
          "loading under another user yields nothing, as for a missing id",
        );
        check((await collect(store.list("bob"))).length === 0, "list under another user leaves it out");
        await store.delete(BOB);
        check((await collect(store.load(ADA))).length === 2, "delete under another user changed nothing");
        await store.append(BOB, [header("hb")]);
        check(
          ids(await collect(store.load(ADA))).join() === "h1,r1",
          "bob's session with the same id is a separate session",
        );
        check(ids(await collect(store.load(BOB))).join() === "hb", "and it holds only bob's entries");
      },
    ],
  ];
  return cases.map(([name, body]) => ({ name, run: () => open(body) }));
}

function tornCases(open: (body: Body) => Promise<{ skipped: string } | undefined>): StoreCase[] {
  const needsTear = "the store gave no way to tear a log's last line";
  const cases: [string, Body][] = [
    [
      "a torn last line is skipped by load and reported once, with every complete entry kept",
      async ({ store, tearLastLine }) => {
        if (tearLastLine === undefined) return { skipped: needsTear };
        await store.append(ADA, [header(), record("r1", "h1")]);
        await tearLastLine(ADA);
        const reports: number[] = [];
        const loaded = await collect(store.load(ADA, { onTornLine: (line) => reports.push(line.bytes) }));
        check(ids(loaded).join() === "h1,r1", "the complete entries load");
        check(reports.length === 1 && (reports[0] ?? 0) > 0, "the torn line is reported once");
        const clean = await collect(
          store.load(
            { userId: "ada", sessionId: "other" },
            { onTornLine: () => check(false, "a clean log reports nothing") },
          ),
        );
        check(clean.length === 0, "a missing session yields nothing");
      },
    ],
    [
      "an append after a torn line cuts it off, so the next entry is not glued to it",
      async ({ store, tearLastLine }) => {
        if (tearLastLine === undefined) return { skipped: needsTear };
        await store.append(ADA, [header(), record("r1", "h1")]);
        await tearLastLine(ADA);
        const written = await store.append(ADA, [record("r2", "r1")], { expectedLastId: "r1" });
        check(written[0]?.seq === 2, "the new entry follows the last complete one");
        const reports: number[] = [];
        const loaded = await collect(store.load(ADA, { onTornLine: (line) => reports.push(line.bytes) }));
        check(ids(loaded).join() === "h1,r1,r2" && reports.length === 0, "the log is whole again");
      },
    ],
  ];
  return cases.map(([name, body]) => ({ name, run: () => open(body) }));
}

/** Every conformance case, each against a store from `factory`. */
export function storeConformanceCases(factory: StoreFactory): readonly StoreCase[] {
  const open = async (body: Body) => {
    const outcome = await body(await factory());
    return typeof outcome === "object" && outcome !== null && "skipped" in outcome ? (outcome as Skip) : undefined;
  };
  return [
    ...appendCases(open),
    ...conflictCases(open),
    ...validationCases(open),
    ...identityCases(open),
    ...keyCases(open),
    ...listAndOwnerCases(open),
    ...tornCases(open),
  ];
}

/** Runs every case and reports which passed, which skipped with a reason and which failed. */
export async function runStoreConformance(factory: StoreFactory): Promise<StoreConformanceReport> {
  return runCases(storeConformanceCases(factory));
}
