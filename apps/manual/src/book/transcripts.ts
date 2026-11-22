import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "astro/zod";
import { TRANSCRIPT_FORMAT } from "../../../../scripts/transcripts/events.js";
import type { ReplayEvent } from "../components/types.js";
import { manifestVersion, WORKSPACE_VERSION } from "./harnesses.js";

// A transcript is the recorded run of one harness example against its mock model: each request the example's code
// sent, each response, and each check() with its result. The harness's `pnpm test` writes it to
// `<harness>/results/transcripts/<example>.json`, as in `verify/<sdk>/` or `packages/sdk/`, through
// `scripts/transcripts/write.mjs`, which documents the format, and CI's results-drift check fails when a committed
// one differs from a fresh run. A listing with `replay` shows its example's transcript as a replay beside the code.

const part = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("tool-call"), id: z.string(), name: z.string(), input: z.unknown() }),
  z.object({
    type: z.literal("tool-result"),
    id: z.string(),
    name: z.string(),
    output: z.unknown(),
    error: z.literal(true).optional(),
  }),
  z.object({ type: z.literal("other"), kind: z.string(), value: z.unknown() }),
]);

const message = z.object({ role: z.enum(["system", "user", "assistant", "tool"]), parts: z.array(part) });
const line = z.number().int().positive().optional();
const count = z.number().int().nonnegative().optional();
/** The token counts the mock reported for an answer, each class only where the example's script set it. */
const usage = z.object({ uncachedInput: count, cacheRead: count, cacheWrite: count, output: count, reasoning: count });

const event = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("request"),
    line,
    model: z.string(),
    repeated: z.number().int().nonnegative(),
    messages: z.array(message),
    tools: z.array(z.string()),
  }),
  z.object({
    kind: z.literal("response"),
    line,
    model: z.string(),
    message,
    finish: z.string(),
    usage: usage.optional(),
    modelId: z.string().optional(),
  }),
  z.object({ kind: z.literal("check"), line, message: z.string(), pass: z.boolean() }),
]);

const transcriptSchema = z.object({
  /** Version 1 has no `usage` or `modelId`; the replay reads it until every committed transcript is rewritten. */
  format: z.union([z.literal(1), z.literal(TRANSCRIPT_FORMAT)]),
  example: z.string(),
  file: z.string(),
  harness: z.string(),
  pin: z.string(),
  /**
   * The package the harness's recorder attaches to, at the version the run used, or at `workspace` for one of our
   * own packages.
   */
  mock: z.string().regex(/^@?[^@]+@(?:\d|workspace$)/),
  events: z.array(event).min(1),
});

export type Transcript = z.infer<typeof transcriptSchema>;
/** One message of a transcript: its role and its parts. */
export type TranscriptMessage = z.infer<typeof message>;
type TranscriptPart = z.infer<typeof part>;
type TranscriptUsage = z.infer<typeof usage>;

/** Where a harness keeps the transcript of the example in `path`, from the repository root. */
export const transcriptPathOf = (harness: string, path: string): string =>
  `${harness}/results/transcripts/${basename(path, extname(path))}.json`;

/**
 * The transcript of the listed file, or why the listing cannot replay it: the file must exist, hold a well-formed
 * transcript, and have been recorded from the listed file at the harness's current pin.
 */
export function readTranscript(
  repoRoot: string,
  listing: { readonly path: string; readonly harness: string; readonly recordedPin: string },
): { readonly transcript: Transcript; readonly transcriptPath: string } | { readonly message: string } {
  const transcriptPath = transcriptPathOf(listing.harness, listing.path);
  const file = join(repoRoot, transcriptPath);
  if (!existsSync(file)) {
    return {
      message:
        `replay needs ${transcriptPath}, which does not exist; run ${listing.harness}'s pnpm test to record it, ` +
        "or drop replay if the harness has no transcript recorder",
    };
  }
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { message: `${transcriptPath} is not JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const parsed = transcriptSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { message: `${transcriptPath} is not a transcript: ${issue?.path.join(".")}: ${issue?.message}` };
  }
  const transcript = parsed.data;
  if (transcript.file !== listing.path) {
    return { message: `${transcriptPath} records ${transcript.file}, not ${listing.path}` };
  }
  const [, mockName = "", mockVersion] = /^(@?[^@]+)@(.+)$/.exec(transcript.mock) ?? [];
  const manifest: unknown = JSON.parse(readFileSync(join(repoRoot, listing.harness, "package.json"), "utf8"));
  const found = manifestVersion(manifest as Parameters<typeof manifestVersion>[0], mockName);
  const pinned = found.self ? WORKSPACE_VERSION : found.version;
  if (transcript.pin !== listing.recordedPin || pinned !== mockVersion) {
    return {
      message:
        `${transcriptPath} was recorded with ${transcript.pin} and ${transcript.mock}, but the harness pins ` +
        `${listing.recordedPin} and ${mockName}@${pinned ?? "nothing"}; run ${listing.harness}'s pnpm test to ` +
        "record it again",
    };
  }
  return { transcript, transcriptPath };
}

const compact = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

/** The longest body a replay event shows; a longer one ends with how many characters it left out. Our choice. */
export const REPLAY_BODY_LIMIT = 600;

function capped(body: string): string {
  if (body.length <= REPLAY_BODY_LIMIT) return body;
  return `${body.slice(0, REPLAY_BODY_LIMIT)}… (${body.length - REPLAY_BODY_LIMIT} more characters)`;
}

/** A part the format has no shape for, under a name a reader can follow. */
function otherEvent(kind: string, value: unknown, role: TranscriptMessage["role"]): Omit<ReplayEvent, "line"> {
  if (kind === "sections" && Array.isArray(value)) {
    return { kind: "user", role: "System prompt sections", body: value.join(", ") };
  }
  if (kind === "derived-text") {
    const characters = (value as { characters?: number } | null)?.characters ?? 0;
    return {
      kind: "model",
      role: "Model text (made up by the fake model)",
      body: `${characters} characters that the fake model built from the conversation so far`,
    };
  }
  return { kind: role === "assistant" ? "model" : "user", role: `Other part (${kind})`, body: compact(value) };
}

function partEvent(item: TranscriptPart, role: TranscriptMessage["role"]): Omit<ReplayEvent, "line"> {
  switch (item.type) {
    case "text":
      if (role === "system") return { kind: "user", role: "System", body: item.text };
      if (role === "assistant") return { kind: "model", role: "Model", body: item.text };
      return { kind: "user", role: "User", body: item.text };
    case "reasoning":
      return { kind: "model", role: "Reasoning", body: item.text };
    case "tool-call":
      return { kind: "tool", role: "Tool call", body: `${item.name}(${compact(item.input)})` };
    case "tool-result":
      return {
        kind: "result",
        role: item.error ? "Tool error" : "Tool result",
        body: `${item.name}: ${compact(item.output)}`,
      };
    case "other":
      return otherEvent(item.kind, item.value, role);
  }
}

const tokens = (n: number): string => n.toLocaleString("en-US");

/**
 * An answer's usage as the replay says it, such as "1,000 uncached input, 1,500 cache read, 500 cache write, 200
 * output tokens", naming only the classes the transcript holds. Reasoning is part of the output, so it comes last.
 */
export function usageText(usage: TranscriptUsage): string {
  const classes: string[] = [];
  if (usage.uncachedInput !== undefined) classes.push(`${tokens(usage.uncachedInput)} uncached input`);
  if (usage.cacheRead !== undefined) classes.push(`${tokens(usage.cacheRead)} cache read`);
  if (usage.cacheWrite !== undefined) classes.push(`${tokens(usage.cacheWrite)} cache write`);
  if (usage.output !== undefined) classes.push(`${tokens(usage.output)} output`);
  if (usage.reasoning === undefined) return `${classes.join(", ")} tokens`;
  const reasoning = `${tokens(usage.reasoning)} ${usage.output === undefined ? "reasoning" : "of them on reasoning"}`;
  return classes.length === 0 ? `${reasoning} tokens` : `${classes.join(", ")} tokens, ${reasoning}`;
}

/** What an answer reported about itself, for the last event the replay shows of it. */
function answerFacts(item: { usage?: TranscriptUsage; modelId?: string }): Pick<ReplayEvent, "modelId" | "usage"> {
  return {
    ...(item.modelId === undefined ? {} : { modelId: item.modelId }),
    ...(item.usage === undefined ? {} : { usage: usageText(item.usage) }),
  };
}

const withLine = (event: Omit<ReplayEvent, "line">, at: number | undefined): ReplayEvent => {
  const body = capped(event.body);
  return at === undefined ? { ...event, body } : { ...event, body, line: at };
};

/**
 * The transcript as the replay shows it, one event per message part. A request shows the messages that are new since
 * its model's previous request and answer (the transcript has already left the rest out). A request can still resend
 * history, as when a handoff gives the conversation to another agent: a message the replay showed before, unless it
 * ends the request, folds into one "History" event that says how many messages were sent again. So does the model's
 * own last answer when the SDK resends it changed, such as with a tool input's defaults filled in. An empty text part
 * shows nothing. An answer's usage and model id, where its transcript records them, go on the answer's last event.
 */
export function replayEvents(transcript: Transcript): ReplayEvent[] {
  const shown = new Set<string>();
  const answered = new Set<string>();
  const out: ReplayEvent[] = [];
  for (const item of transcript.events) {
    if (item.kind === "check") {
      out.push(withLine({ kind: "check", role: item.pass ? "Check" : "Check failed", body: item.message }, item.line));
      continue;
    }
    const messages = item.kind === "request" ? item.messages : [item.message];
    let echo = item.kind === "request" && answered.has(item.model);
    let resent = 0;
    const fresh: ReplayEvent[] = [];
    messages.forEach((m, index) => {
      const key = JSON.stringify(m);
      const last = index === messages.length - 1;
      if (item.kind === "request" && ((echo && m.role === "assistant") || (!last && shown.has(key)))) {
        if (m.role === "assistant") echo = false;
        resent++;
        return;
      }
      shown.add(key);
      for (const piece of m.parts) {
        if ((piece.type === "text" || piece.type === "reasoning") && piece.text === "") continue;
        fresh.push(withLine(partEvent(piece, m.role), item.line));
      }
    });
    if (resent > 0) {
      const body = resent === 1 ? "1 earlier message sent again" : `${resent} earlier messages sent again`;
      out.push(withLine({ kind: "user", role: "History", body }, item.line));
    }
    if (item.kind === "response") {
      const facts = answerFacts(item);
      if (Object.keys(facts).length > 0) {
        // The answer's usage and model id go on its last event, or on an event of their own when it showed none.
        const last =
          fresh.pop() ?? withLine({ kind: "model", role: "Model", body: "An answer with no content" }, item.line);
        fresh.push({ ...last, ...facts });
      }
    }
    out.push(...fresh);
    if (item.kind === "response") answered.add(item.model);
    else answered.delete(item.model);
  }
  return out;
}
