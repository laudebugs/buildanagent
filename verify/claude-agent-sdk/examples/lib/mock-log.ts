// Read the mock's request log, so an example can assert on what the CLI sent to the model.
import { readFileSync } from "node:fs";

/** One tool entry as the Messages API request carries it. */
export interface RequestTool {
  name: string;
  defer_loading?: boolean;
}

/** One `/v1/messages` request, reduced to the parts the examples assert on. */
export interface ModelRequest {
  tools: RequestTool[];
  /** The whole request body as text, for "did this string reach the model" checks. */
  text: string;
  /** Content blocks of every message, flattened. */
  blocks: Array<{ type: string; [key: string]: unknown }>;
}

/** Every model request logged so far; pass the earlier count to see only what a later run sent. */
export function modelRequests(from = 0): ModelRequest[] {
  const path = process.env.MOCK_LOG;
  if (!path) throw new Error("MOCK_LOG is unset: run this example with scripts/run-examples.mjs");
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.path.endsWith("/v1/messages"))
    .slice(from)
    .map(({ body }) => ({
      tools: body.tools ?? [],
      text: JSON.stringify(body),
      blocks: (body.messages ?? []).flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : [])),
    }));
}

/**
 * Fail if any request offers a tool outside `allowed`. An allowlist, because the SDK's built-in
 * list grows (Glob, Grep, Agent, TodoWrite, Monitor, Cron*, ...) and a denylist misses the new names.
 * Each entry is an exact name or a prefix ending in `*`.
 */
export function assertOnlyTools(requests: ModelRequest[], allowed: string[]): void {
  const ok = (name: string) => allowed.some((a) => (a.endsWith("*") ? name.startsWith(a.slice(0, -1)) : name === a));
  const extra = [...new Set(requests.flatMap((r) => r.tools.map((t) => t.name)).filter((n) => !ok(n)))];
  if (extra.length > 0) {
    throw new Error(
      `ASSERTION FAILED: a request offered tools outside the allowed set (${allowed.join(", ")}): ${extra.join(", ")}`,
    );
  }
  console.log(`ok - every request offers only: ${allowed.join(", ")}`);
}
