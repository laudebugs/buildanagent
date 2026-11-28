// Runs this project's pinned wrangler with an allowlisted environment (AGENTS.md, "Running third-party code").
// It passes the real HOME, an exception to the temp-HOME rule: wrangler's OAuth login and Docker's configuration live
// there, and the owner approved that login for N50's one run. A rerun should use a temp HOME, a DOCKER_CONFIG copy
// and a CLOUDFLARE_API_TOKEN scoped to Workers and Containers (the findings note, "Environment").
// CLOUDFLARE_ACCOUNT_ID must name the one account the owner approved for the run; it is an identifier, not a
// credential, and it stays out of the repo.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.dirname(here);
const env = {
  PATH: process.env.PATH ?? "",
  HOME: process.env.HOME ?? "",
  TMPDIR: process.env.TMPDIR ?? "/tmp",
  LANG: process.env.LANG ?? "en_US.UTF-8",
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID ?? "",
  WRANGLER_SEND_METRICS: "false",
};
if (!env.CLOUDFLARE_ACCOUNT_ID) throw new Error("Set CLOUDFLARE_ACCOUNT_ID to the account approved for the run");
const bin = path.join(project, "node_modules", ".bin", "wrangler");
const { status } = spawnSync(bin, process.argv.slice(2), { cwd: project, env, stdio: "inherit" });
process.exit(status ?? 1);
