/**
 * `buildanagent rpc`: serves the harness protocol as JSON-RPC lines over standard input and output, for a client in
 * another process or language. Standard output carries protocol lines only, so the transport's diagnostics go to
 * standard error.
 *
 * The host is interactive, because the client is the person's side: a call no rule settles is asked over the wire with
 * `approval/request` instead of denied, and its pause is signed so a later process can resolve it. The command ends
 * when the client closes standard input, or when the server stops the connection, and only then closes the host.
 */
import { stdioTransport } from "@buildanagent/harness/server";
import { CliError } from "../errors.js";
import { openHost } from "../host.js";
import { modelFromSpec } from "../model.js";
import type { CommandContext } from "../options.js";

/** Serves one client over the process's standard streams until it is done, and returns exit status 0. */
export async function rpcCommand(context: CommandContext, words: readonly string[]): Promise<number> {
  if (words.length > 0) throw new CliError("usage", "rpc takes no arguments");
  const { io, flags, options } = context;
  if (io.streams === undefined) {
    throw new CliError("no_streams", "rpc needs the standard streams as bytes: give the CliIo its streams");
  }
  const { input, output } = io.streams;
  const model = options.model ?? modelFromSpec(flags.model, io.env);
  const host = await openHost({ ...context.hostOptions, model, interactive: true, signing: true });
  try {
    await stdioTransport(host.dispatcher, { input, output, log: (line) => io.error(`${line}\n`) });
  } finally {
    await host.close();
  }
  return 0;
}
