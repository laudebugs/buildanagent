// What a harness's scripts/run-examples.mjs needs for its --live flag, which only scripts/live/run.mjs passes. The
// flag runs one example (--only) against a real provider: the runner adds the LIVE_* variables to the example's
// allowlisted environment, among them the path of the file that holds the key, which the example reads and deletes
// (live.ts). It writes the example's transcript to results/live/ through write.mjs and redacts what it prints.
// Without the flag, liveMode() returns undefined and the runner does what it always does.
import { redact } from "./redact.ts";

/** The variables run.mjs sets for a live run, and the only ones a harness runner passes on to the example. */
export const LIVE_VARIABLES = [
  "LIVE",
  "LIVE_PROVIDER",
  "LIVE_MODEL",
  "LIVE_MAX_TOKENS",
  "LIVE_LEDGER",
  "LIVE_EXAMPLE",
  "LIVE_CATALOG",
  "LIVE_BASE_URL",
  "LIVE_API_KEY_FILE",
];

/**
 * The live run's settings for a harness runner, or undefined without --live. Throws when --live comes without the
 * environment run.mjs sets, or without --only, so a live run never reaches every example by accident.
 */
export function liveMode(argv = process.argv, env = process.env) {
  if (!argv.includes("--live")) return undefined;
  if (env.LIVE !== "1" || !env.LIVE_API_KEY_FILE) {
    throw new Error("--live runs only under scripts/live/run.mjs, which sets LIVE=1 and LIVE_API_KEY_FILE");
  }
  if (!argv.includes("--only")) throw new Error("--live needs --only <example>");
  // The runner never holds the key, so it redacts by shape; run.mjs, which wrote the key file, redacts the value too.
  const secrets = [];
  return {
    /** The variables to add to the example's allowlisted environment. */
    env: Object.fromEntries(LIVE_VARIABLES.filter((name) => env[name] !== undefined).map((name) => [name, env[name]])),
    /** What write.mjs's writeTranscript() takes for a live transcript. */
    transcript: {
      live: { provider: env.LIVE_PROVIDER, model: env.LIVE_MODEL, secrets },
      outDir: env.LIVE_OUT_DIR || undefined,
    },
    /** The example's output with the key and any account or request id taken out. */
    redact: (text) => redact(text, secrets),
  };
}
