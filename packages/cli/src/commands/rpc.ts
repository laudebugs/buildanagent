/**
 * `buildanagent rpc`: will serve the harness protocol as JSON lines over standard input and output, for a client in
 * another process or language. The stdio transport it needs is not in the harness yet, so the command says so and
 * exits 2. When the transport lands, this function builds the host with `openHost()` (interactive, signing and the
 * `--model` the caller gave) and hands `host.dispatcher` to the transport with the process's standard streams, in
 * place of the message below.
 */
import type { CommandContext } from "../options.js";

/** Reports that `rpc` is not available yet and returns exit status 2. */
export function rpcCommand(context: CommandContext): number {
  context.io.error("buildanagent: rpc is not available yet; use run --json for one turn's events as JSON lines\n");
  return 2;
}
