/**
 * The setup `run`, `chat` and `resume` share: a host with a model, a session created or opened on its client, and
 * the meter and renderer its events go to. It reports the preamble's size when the session starts, the meter's
 * warnings as they happen, and how each turn settled.
 */
import type { TurnResultSummary } from "@buildanagent/protocol";
import { type Host, openHost } from "./host.js";
import { Meter, readingText, warningText } from "./meter.js";
import { modelFromSpec } from "./model.js";
import type { CommandContext } from "./options.js";
import { Output } from "./output.js";
import { liveRenderer } from "./render.js";
import { type EventListener, openStored, SessionWatch, WAITING_REASONS } from "./watch.js";

/** The version `initialize` reports for this client. */
export const CLI_VERSION = "0.0.0";

/** A session ready for turns. */
export interface Live {
  readonly host: Host;
  readonly watch: SessionWatch;
  readonly meter: Meter;
  readonly out: Output;
  /** The requests that waited when a stored session was opened. */
  readonly pending: readonly string[];
}

function listenerFor(context: CommandContext, meter: Meter, out: Output, session: () => string): EventListener {
  const render = liveRenderer(context.io);
  return (event, seq, replayed) => {
    const notes = meter.observe(event, replayed);
    if (replayed) return;
    if (out.json) out.line({ type: "event", session: session(), seq, event });
    else render(event);
    for (const note of notes) out.note(warningText(note), { type: "warning", ...note });
  };
}

async function attach(context: CommandContext, host: Host, listener: EventListener, id: string | undefined) {
  const { client } = host;
  await client.request("initialize", { clientInfo: { name: "buildanagent", version: CLI_VERSION }, capabilities: [] });
  if (id === undefined) {
    const { session } = await client.request("session/create", { cwd: context.io.cwd });
    return { watch: new SessionWatch(client, session, listener), pending: [] };
  }
  const watch = new SessionWatch(client, id, listener);
  return { watch, pending: await openStored(client, watch, context.io.cwd) };
}

/** Opens a host with a model and a session on it: the stored session `id`, or a new one. */
export async function startLive(context: CommandContext, interactive: boolean, id?: string): Promise<Live> {
  const { flags } = context;
  const model = context.options.model ?? modelFromSpec(flags.model, context.io.env);
  const host = await openHost({ ...context.hostOptions, model, interactive, signing: true });
  const meter = new Meter(flags.budgetUsd);
  const out = new Output(context.io, flags.json);
  let session = id ?? "";
  try {
    const attached = await attach(
      context,
      host,
      listenerFor(context, meter, out, () => session),
      id,
    );
    session = attached.watch.session;
    const { registry, system } = host.harness;
    const tools = registry.list().filter((tool) => tool.exposure === "direct").length;
    const preambleTokens = registry.preambleTokens({ system });
    out.note(`session ${session} · preamble ~${preambleTokens} tokens (system prompt and ${tools} tools)`, {
      type: "session",
      session,
      preambleTokens,
      tools,
    });
    return { host, meter, out, ...attached };
  } catch (error) {
    // A close that fails too, such as a collector that can't be reached, must not hide why the session didn't start.
    await host.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Runs `body`, then stops the watch and closes the host, which sends any spans. When `body` throws, a close that
 * fails as well is dropped, so the error that ended the command is the one reported.
 */
export async function withLive<T>(live: Live, body: () => Promise<T>): Promise<T> {
  let result: T;
  try {
    result = await body();
  } catch (error) {
    live.watch.stop();
    await live.host.close().catch(() => undefined);
    throw error;
  }
  live.watch.stop();
  await live.host.close();
  return result;
}

/** Reports how a turn settled, with the meter's totals. */
export function reportSettled(live: Live, result: TurnResultSummary): void {
  const reading = live.meter.reading();
  const why = result.error === undefined ? "" : `: ${result.error.message}`;
  const waiting = WAITING_REASONS.has(result.stopReason)
    ? ` · answer with: buildanagent resume ${live.watch.session}`
    : "";
  live.out.note(`[${result.stopReason}${why}] ${readingText(reading)}${waiting}`, {
    type: "settled",
    session: live.watch.session,
    result,
    meter: reading,
  });
}

/** The exit status for how a turn settled: 0 for `done`, 3 while it waits for a person, and 1 otherwise. */
export function exitStatus(result: TurnResultSummary): number {
  if (result.stopReason === "done") return 0;
  return WAITING_REASONS.has(result.stopReason) ? 3 : 1;
}
