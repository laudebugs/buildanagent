// The harness capstone's sessions: the triage example on a scripted model, with a fixed clock, counted ids and one
// HMAC key, so every case writes the same bytes on every run. Each case runs its first turn, closes the session, and
// answers the pause through a new harness, model and set of systems, as a second process would. The store scrubs the
// fixture's planted secrets from every entry before it is written, as the README asks a host to.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createModel, type Model, type PriceCatalog } from "@buildanagent/gateway";
import type { ContextPolicy } from "@buildanagent/harness/context";
import { scrubSecrets } from "@buildanagent/harness/credentials";
import type { Rule } from "@buildanagent/harness/permissions";
import {
  type EntryInput,
  openSession,
  type SessionEntry,
  type SessionKey,
  type SessionStore,
  type TurnResult,
} from "@buildanagent/harness/session";
import { fileIndex, fileLock, jsonlStore } from "@buildanagent/harness/session/jsonl";
import { hmacSigner, type Observer, type Resolution } from "@buildanagent/sdk";
import {
  type Clock,
  fixedClock,
  type RecordedPair,
  recordPairs,
  replayPairs,
  ScriptedModel,
  type ScriptStep,
  sequentialIds,
} from "@buildanagent/sdk/testing";
import { answerTriage, startTriage, triageHarness } from "../../examples/triage-session.js";
import { type TriageApp, type TriageDeps, triageRegistry } from "../../examples/triage-tools.js";

export const KEY: SessionKey = { userId: "ada", sessionId: "triage" };
export const CUSTOMER: TriageApp = { customerEmail: "user@example.com" };
export const TICKET = "user@example.com says checkout fails with a 500. Triage it.";
export const REASON = "Checkout returns 500 for every pro customer.";
export const BUG = { category: "bug", priority: "high", summary: "Checkout returns 500 for a pro customer." };
export const QUESTION = { category: "question", priority: "low", summary: "A pro customer asked about checkout." };
export const FREEZE: Rule = { tool: "escalate", reason: "Paging is frozen during the incident review." };
/** The only tools a request may offer: the agent's two and its output tool. */
export const TRIAGE_TOOLS = ["escalate", "lookup_customer", "submit_triage"];

/**
 * Obviously fake secrets. The provider key sits in the fixture's own environment, never in `process.env`, whose
 * provider variables the offline setup refuses. The pager token is the credential the host injects into each page;
 * the fake pager echoes both back in its receipt, which the escalate tool puts in its result's `details`.
 */
export const PROVIDER_KEY = "sk-ant-api03-FAKE-capstone-provider-key-not-real-0000";
export const PAGER_TOKEN = "pgr_FAKE_capstone_injected_credential_1111";
export const FIXTURE_ENV: Readonly<Record<string, string>> = { ANTHROPIC_API_KEY: PROVIDER_KEY, PAGER_TOKEN };
const SECRETS = [PROVIDER_KEY, PAGER_TOKEN];

const KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 7);
export const signer = () => hmacSigner({ keys: { k1: KEY_BYTES }, current: "k1" });

/** When the recorded pairs stop replaying: a year after they were made, so N36's suite renews them. */
export const PAIRS_EXPIRE = "2027-11-25T00:00:00.000Z";
export const RECORDED_AT = "2026-11-25T09:00:00.000Z";

/** One "process": what its tools did. */
export function world(): { seen: { lookups: string[]; escalations: string[] }; deps: TriageDeps } {
  const seen = { lookups: [] as string[], escalations: [] as string[] };
  const deps: TriageDeps = {
    findCustomer: async (email) => {
      seen.lookups.push(email);
      return { plan: "pro", openTickets: 2 };
    },
    escalate: async (reason) => {
      seen.escalations.push(reason);
      const echoed = { authorization: `Bearer ${FIXTURE_ENV.PAGER_TOKEN}`, "x-api-key": FIXTURE_ENV.ANTHROPIC_API_KEY };
      return { text: "paged the on-call engineer", receipt: { page: "pg-1", echoed } };
    },
  };
  return { seen, deps };
}

export const call = (callId: string, name: string, input: unknown): ScriptStep => ({
  content: [{ type: "tool_call", callId, name, input }],
  usage: { uncachedInput: 200, output: 50 },
});
export const LOOKUP = call("call-1", "lookup_customer", {});
export const ESCALATE: ScriptStep = {
  content: [
    { type: "text", text: "Every pro customer is affected, so I'll page the on-call engineer." },
    { type: "tool_call", callId: "call-2", name: "escalate", input: { reason: REASON } },
  ],
  usage: { uncachedInput: 200, output: 50 },
};
export const submit = (callId: string, input: unknown) => call(callId, "submit_triage", input);

// The fixture's own price, so the budget has a rate to project with and the recorded costs never move with the
// gateway's catalog.
const MODEL_ID = "triage-priced";
const PRICE_SOURCE = "https://provider.test/pricing";
export const CATALOG: PriceCatalog = {
  models: [
    {
      provider: "scripted",
      id: MODEL_ID,
      rates: [
        { uncachedInput: 3, cacheRead: 0.3, cacheWrite: { "5m": 3.75, "1h": 6 }, output: 15, upToInputTokens: null },
      ],
      contextWindow: 200_000,
      maxOutputTokens: 4000,
      asOf: "2026-11-01",
      sources: { rates: PRICE_SOURCE, contextWindow: PRICE_SOURCE, maxOutputTokens: PRICE_SOURCE },
    },
  ],
};

/** A model for one process of a case, with what it was asked and the pairs it recorded. */
export interface CaseModel {
  readonly model: Model;
  readonly adapter: ScriptedModel;
  pairs(): RecordedPair[];
}

/** A scripted model behind `createModel()`, whose calls are recorded as pairs for a later replay. */
export function recordedModel(steps: ScriptStep[]): CaseModel {
  const adapter = new ScriptedModel(steps);
  const model = createModel({ adapter, id: MODEL_ID, catalog: CATALOG, retries: 0 }) as Model;
  const recorder = recordPairs(model, {
    providerVersion: "scripted",
    expiresAt: PAIRS_EXPIRE,
    clock: fixedClock(RECORDED_AT),
  });
  return { adapter, model: recorder.model, pairs: () => recorder.pairs() };
}

/** A model that replays recorded pairs and fails a call whose request differs from the recording. */
export function replayedModel(pairs: readonly RecordedPair[]): CaseModel {
  const adapter = replayPairs(pairs, { clock: fixedClock(RECORDED_AT), expect: { providerVersion: "scripted" } });
  const model = createModel({ adapter, id: adapter.modelId, catalog: CATALOG, retries: 0 }) as Model;
  return { adapter, model, pairs: () => [...pairs] };
}

/** The store with every planted secret scrubbed from each entry before it is appended. */
export function scrubbing(store: SessionStore): SessionStore {
  const scrub = (entry: EntryInput) => scrubSecrets(entry as SessionEntry, SECRETS) as unknown as EntryInput;
  return new Proxy(store, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "append") return typeof value === "function" ? value.bind(target) : value;
      return ((key, entries, options) =>
        target.append(key, entries.map(scrub), options)) satisfies SessionStore["append"];
    },
  });
}

/**
 * The session files under `dir`, scrubbed on every append. `leaseMs` shortens the lock's lease, for a test whose
 * writer is killed and whose next writer must not wait out the default lease.
 */
export function filesAt(dir: string, leaseMs?: number) {
  const store = scrubbing(jsonlStore({ dir: join(dir, "sessions") }));
  const lease = leaseMs === undefined ? {} : { leaseMs, renewMs: Math.floor(leaseMs / 4) };
  return {
    dir,
    store,
    index: fileIndex({ dir: join(dir, "pointers") }),
    lock: fileLock({ dir: join(dir, "locks"), ...lease }),
  };
}

export type Files = ReturnType<typeof filesAt>;

/** The bytes of every session file under `files`, by file name. */
export function bytesOf(files: Files): Record<string, string> {
  const root = join(files.dir, "sessions");
  const names = readdirSync(root, { recursive: true, encoding: "utf8" }).filter((name) => name.endsWith(".jsonl"));
  return Object.fromEntries(names.sort().map((name) => [name, readFileSync(join(root, name), "utf8")]));
}

export async function entriesOf(files: Files, key: SessionKey = KEY): Promise<SessionEntry[]> {
  const found: SessionEntry[] = [];
  for await (const entry of files.store.load(key)) found.push(entry);
  return found;
}

/** What one recorded case leaves: its result, the systems of both processes, and the model calls of each. */
export interface RecordedCase {
  readonly paused: TurnResult;
  readonly result: TurnResult;
  readonly first: ReturnType<typeof world>["seen"];
  readonly second: ReturnType<typeof world>["seen"];
  readonly pairs: { readonly start: RecordedPair[]; readonly resume: RecordedPair[] };
  readonly toolNames: string[][];
  readonly requestId: string;
}

/** How a case answers the pause, and what the second process's model and policy are. */
export interface CaseScript {
  readonly answer: (requestId: string) => Resolution;
  readonly resume: ScriptStep[];
  readonly deny?: readonly Rule[];
  readonly context?: ContextPolicy;
}

export const CASES = {
  approved: {
    answer: (id) => ({ requestId: id, decision: "allow", by: "on-call lead" }),
    resume: [submit("call-3", BUG)],
  },
  rejected: {
    answer: (id) => ({ requestId: id, decision: "deny", reason: "not an outage" }),
    resume: [submit("call-3", QUESTION)],
  },
  policy_changed: {
    answer: (id) => ({ requestId: id, decision: "allow", by: "on-call lead" }),
    resume: [submit("call-3", QUESTION)],
    deny: [FREEZE],
  },
} as const satisfies Record<string, CaseScript>;

export type CaseName = keyof typeof CASES;

/** Deterministic settings for one case: one clock and one id source, shared by both processes. */
export function determinism(): { clock: Clock; newId: () => string } {
  return { clock: fixedClock("2026-11-25T09:00:00.000Z", 250), newId: sequentialIds("t") };
}

/** Runs one case into `files`: the first process pauses, the second answers. `observers` see both runs. */
export async function recordCase(
  files: Files,
  script: CaseScript,
  options: {
    readonly observers?: readonly Observer[];
    readonly models?: { readonly start: CaseModel; readonly resume: CaseModel };
  } = {},
): Promise<RecordedCase> {
  const observers = options.observers ?? [];
  const { clock, newId } = determinism();
  const sessionOptions = { ...files, key: KEY, now: () => new Date(clock.now()), newId };
  const firstWorld = world();
  const firstModel = options.models?.start ?? recordedModel([LOOKUP, ESCALATE]);
  const firstHarness = triageHarness({
    model: firstModel.model,
    signer: signer(),
    registry: triageRegistry(firstWorld.deps),
    policy: { version: "triage-1" },
  });
  const session = await openSession(sessionOptions);
  const paused = await startTriage({ session, harness: firstHarness, app: CUSTOMER }, TICKET, {
    clock,
    newId,
    observers,
  });
  await session.close();
  const requestId = paused.stopReason === "awaiting_approval" ? (paused.pending[0]?.id ?? "") : "";

  const secondWorld = world();
  const secondModel = options.models?.resume ?? recordedModel([...script.resume]);
  const secondHarness = triageHarness({
    model: secondModel.model,
    signer: signer(),
    registry: triageRegistry(secondWorld.deps),
    policy: {
      version: script.deny === undefined ? "triage-1" : "triage-2",
      ...(script.deny ? { deny: script.deny } : {}),
    },
  });
  const reopened = await openSession(sessionOptions);
  const result = (await answerTriage(
    { session: reopened, harness: secondHarness, app: CUSTOMER },
    [script.answer(requestId)],
    { clock, newId, observers },
  )) as TurnResult;
  await reopened.close();
  firstModel.adapter.assertComplete();
  secondModel.adapter.assertComplete();
  const toolNames = [...firstModel.adapter.calls, ...secondModel.adapter.calls].map((c) =>
    c.context.tools.map((tool) => tool.name).sort(),
  );
  return {
    paused,
    result,
    first: firstWorld.seen,
    second: secondWorld.seen,
    pairs: { start: firstModel.pairs(), resume: secondModel.pairs() },
    toolNames,
    requestId,
  };
}
