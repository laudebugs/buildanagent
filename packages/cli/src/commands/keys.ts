/**
 * `buildanagent keys rotate|prune`: change the approval key ring. `rotate` adds a key that signs every new request;
 * the older keys still verify the requests they signed. `prune` removes the keys that no waiting request names, so a
 * request signed with an old key never stops verifying while it waits.
 */
import { pruneKeys, rotateKeys } from "@buildanagent/harness/session";
import { fileKeyStore } from "@buildanagent/harness/session/jsonl";
import { CliError } from "../errors.js";
import { openHost } from "../host.js";
import { CLI_VERSION } from "../live.js";
import type { CommandContext } from "../options.js";
import { Output } from "../output.js";

/** The ids of the keys that sign a request still waiting in any session. */
async function keysInUse(context: CommandContext): Promise<Set<string>> {
  const host = await openHost({ ...context.hostOptions, interactive: false, signing: false });
  try {
    const { pending } = await host.client.request("initialize", {
      clientInfo: { name: "buildanagent", version: CLI_VERSION },
      capabilities: [],
    });
    return new Set(pending.map(({ request }) => request.keyId));
  } finally {
    await host.close();
  }
}

/** Runs `keys rotate` or `keys prune` and returns the exit status. */
export async function keysCommand(context: CommandContext, words: readonly string[]): Promise<number> {
  const [verb, ...rest] = words;
  if ((verb !== "rotate" && verb !== "prune") || rest.length > 0) {
    throw new CliError("usage", "keys takes rotate or prune");
  }
  const store = fileKeyStore(context.hostOptions.paths.keys);
  const out = new Output(context.io, context.flags.json);
  if (verb === "rotate") {
    const id = await rotateKeys(store);
    out.result(`new current key ${id}`, { rotated: id });
    return 0;
  }
  const inUse = await keysInUse(context);
  const removed = await pruneKeys(store, inUse);
  out.result(removed.length === 0 ? "no key to remove" : `removed ${removed.join(", ")}`, {
    removed,
    kept: [...inUse],
  });
  return 0;
}
