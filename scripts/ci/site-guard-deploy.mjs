// Refuses a deploy of the docs or the website unless the app's wrangler.toml is exactly the assets-only config that
// publish-and-docs DS3 and DS4 describe, and dist/_headers is what site-stage-dist.mjs writes. The deploy workflows run
// it from main's checkout after staging, so a drifted config fails here and not on the live site.
//
// The rule is strict on purpose: the file's lines, with blank lines and whole-line `#` comments left out, must equal
// EXPECTED, in order. Any other key, table, inline comment or reordering is refused. That needs no TOML parser, so the
// guard can never read the file differently from Wrangler: anything it does not recognise, it refuses. Changing a
// site's config therefore means changing EXPECTED in the same commit, which the tests check.
//
// It also refuses when Wrangler could read another config: without --config, Wrangler looks for wrangler.json,
// wrangler.jsonc and wrangler.toml up the directory tree, and follows a .wrangler/deploy/config.json redirect found the
// same way. The workflows pass --config wrangler.toml; this check keeps the guard and Wrangler reading the same file
// if a call ever drops it.
//
// Usage: node scripts/ci/site-guard-deploy.mjs <docs|site> [--noindex]. With --noindex, dist/_headers must be the
// noindex variant, for a preview or for next.docs.buildanagent.fyi.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { headersFor, SITES, siteOf } from "./site-stage-dist.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const COMMON_TOP = ['compatibility_date = "2026-11-17"', "workers_dev = false", "preview_urls = true"];
const ASSETS = ['directory = "./dist"', 'not_found_handling = "404-page"'];
const route = (table, domain) => [`[[${table}]]`, `pattern = "${domain}"`, "custom_domain = true"];

/** Each site's wrangler.toml, without blank lines and whole-line comments. */
export const EXPECTED = {
  site: [
    `name = "${SITES.site.worker}"`,
    ...COMMON_TOP,
    "[assets]",
    ...ASSETS,
    ...route("routes", SITES.site.domain),
    "[previews]",
  ],
  docs: [
    `name = "${SITES.docs.worker}"`,
    ...COMMON_TOP,
    "[assets]",
    ...ASSETS,
    ...route("routes", SITES.docs.domain),
    "[previews]",
    "[env.next]",
    `name = "${SITES.docs.worker}-next"`,
    "workers_dev = false",
    "preview_urls = false",
    "[env.next.assets]",
    ...ASSETS,
    ...route("env.next.routes", SITES.docs.next),
  ],
};

/** Returns the config's significant lines: each line trimmed, with blank lines and whole-line comments left out. */
export function significantLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

/** Returns one message for each way `text` differs from the site's EXPECTED lines, or none. */
export function configProblems(name, text) {
  const expected = EXPECTED[name];
  const got = significantLines(text);
  const problems = [];
  for (let i = 0; i < Math.max(expected.length, got.length); i++) {
    if (got[i] === expected[i]) continue;
    const want = expected[i] === undefined ? "the end of the file" : `\`${expected[i]}\``;
    problems.push(`wrangler.toml line ${i + 1} of its settings must be ${want}, not ${JSON.stringify(got[i] ?? "")}`);
    // After the first difference every later line is shifted, so one message says enough.
    break;
  }
  return problems;
}

const CONFIG_NAMES = ["wrangler.json", "wrangler.jsonc", "wrangler.toml"];
const REDIRECT = join(".wrangler", "deploy", "config.json");

/** Lists every Wrangler config or deploy redirect from `appDir` up to the filesystem root, other than its own. */
export function strayConfigs(appDir) {
  const problems = [];
  const own = join(appDir, "wrangler.toml");
  for (let dir = appDir; ; dir = dirname(dir)) {
    for (const file of [...CONFIG_NAMES, REDIRECT]) {
      const path = join(dir, file);
      if (path !== own && existsSync(path)) problems.push(`${path} must not exist: Wrangler could read it instead`);
    }
    if (dirname(dir) === dir) return problems;
  }
}

/** Checks the site's config, its staged dist/ and its _headers, and returns the problems. */
export function checkSite(name, { noindex = false, root = ROOT } = {}) {
  const site = siteOf(name);
  const appDir = resolve(root, site.app);
  const stray = strayConfigs(appDir);
  if (stray.length > 0) return stray;
  const configPath = join(appDir, "wrangler.toml");
  if (!existsSync(configPath)) return [`${site.app}/wrangler.toml is missing`];
  const problems = configProblems(name, readFileSync(configPath, "utf8"));
  const dist = join(appDir, "dist");
  for (const page of site.required) {
    if (!existsSync(join(dist, page))) problems.push(`dist/${page} is missing: stage the artifact first`);
  }
  let expected;
  try {
    expected = headersFor(appDir, { noindex });
  } catch (error) {
    problems.push(`public/_headers has no noindex variant: ${error.message}`);
    return problems;
  }
  const deployedPath = join(dist, "_headers");
  const deployed = existsSync(deployedPath) ? readFileSync(deployedPath, "utf8") : null;
  if (deployed !== expected) {
    const want =
      expected === null ? "absent, because the app has no public/_headers" : "what site-stage-dist.mjs writes";
    problems.push(
      `dist/_headers must be ${want}${noindex ? " with --noindex" : ""}; it ${deployed === null ? "is missing" : "differs"}`,
    );
  }
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  const noindex = args.at(-1) === "--noindex";
  const rest = noindex ? args.slice(0, -1) : args;
  if (rest.length !== 1 || !Object.hasOwn(SITES, rest[0])) {
    console.error("Usage: node scripts/ci/site-guard-deploy.mjs <docs|site> [--noindex]");
    process.exit(2);
  }
  const problems = checkSite(rest[0], { noindex });
  if (problems.length > 0) {
    console.error(`Deploy refused: ${SITES[rest[0]].app} breaks the deploy rules.\n- ${problems.join("\n- ")}`);
    process.exit(1);
  }
  console.log(
    `Deploy guard passed: ${SITES[rest[0]].app} is an assets-only Worker${noindex ? ", marked noindex" : ""}.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
