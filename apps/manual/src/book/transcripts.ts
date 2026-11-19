import { existsSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "astro/zod";
import type { ReplayEvent } from "../components/types.js";

// A transcript is the recorded run of one `verify/` example against its mock model: each request the example's code
// sent, each response, and each check() with its result. The harness's `pnpm test` writes it to
// `verify/<sdk>/results/transcripts/<example>.json` through `scripts/transcripts/write.mjs`, which documents the
// format, and CI's results-drift check fails when a committed one differs from a fresh run. A listing with `replay`
// shows its example's transcript as a replay beside the code.

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

const event = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("request"),
    line,
    model: z.string(),
    repeated: z.number().int().nonnegative(),
    messages: z.array(message),
    tools: z.array(z.string()),
  }),
  z.object({ kind: z.literal("response"), line, model: z.string(), message, finish: z.string() }),
  z.object({ kind: z.literal("check"), line, message: z.string(), pass: z.boolean() }),
]);

const transcriptSchema = z.object({
  format: z.literal(1),
  example: z.string(),
  file: z.string(),
  harness: z.string(),
  pin: z.string(),
  events: z.array(event).min(1),
});

export type Transcript = z.infer<typeof transcriptSchema>;
type TranscriptMessage = z.infer<typeof message>;
type TranscriptPart = z.infer<typeof part>;

/** Where a harness keeps the transcript of the example in `path`, from the repository root. */
export const transcriptPathOf = (harness: string, path: string): string =>
  `${harness}/results/transcripts/${basename(path, extname(path))}.json`;

/**
 * The transcript of the listed file, or why the listing cannot replay it: the file must exist, hold a well-formed
 * transcript, and have been recorded from the listed file at the harness's current pin.
 */
export function readTranscript(
  repoRoot: string,
  listing: { readonly path: string; readonly harness: string; readonly pin: string },
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
  if (transcript.pin !== listing.pin) {
    return {
      message:
        `${transcriptPath} was recorded with ${transcript.pin}, but the harness pins ${listing.pin}; ` +
        `run ${listing.harness}'s pnpm test to record it again`,
    };
  }
  return { transcript, transcriptPath };
}

const compact = (value: unknown): string => (typeof value === "string" ? value : JSON.stringify(value));

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
      return { kind: role === "assistant" ? "model" : "user", role: item.kind, body: compact(item.value) };
  }
}

const withLine = (event: Omit<ReplayEvent, "line">, at: number | undefined): ReplayEvent =>
  at === undefined ? event : { ...event, line: at };

/**
 * The transcript as the replay shows it, one event per message part. A request shows only the messages that are new
 * since its model's previous request, and leaves out the model's own last answer, which the replay showed as a
 * response already; an empty text part shows nothing.
 */
export function replayEvents(transcript: Transcript): ReplayEvent[] {
  const answered = new Set<string>();
  const out: ReplayEvent[] = [];
  for (const item of transcript.events) {
    if (item.kind === "check") {
      out.push(withLine({ kind: "check", role: item.pass ? "Check" : "Check failed", body: item.message }, item.line));
      continue;
    }
    const messages = item.kind === "request" ? item.messages : [item.message];
    // The first assistant message after a model's answer is that answer, resent as history.
    let skipEcho = item.kind === "request" && answered.has(item.model);
    for (const m of messages) {
      if (skipEcho && m.role === "assistant") {
        skipEcho = false;
        continue;
      }
      for (const piece of m.parts) {
        if ((piece.type === "text" || piece.type === "reasoning") && piece.text === "") continue;
        out.push(withLine(partEvent(piece, m.role), item.line));
      }
    }
    if (item.kind === "response") answered.add(item.model);
    else answered.delete(item.model);
  }
  return out;
}
