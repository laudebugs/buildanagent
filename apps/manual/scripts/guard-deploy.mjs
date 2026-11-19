// Adapted from scripts/guard-deploy.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// Refuses a deploy or a preview of the book unless wrangler.jsonc still describes an assets-only Worker on the one
// custom domain (book plan BK15). The deploy workflow runs it from main's checkout, after the built site is in dist/
// and main's public/_headers has been copied over it, so a drifted config fails here and not on the live site.
//
// Usage: node scripts/guard-deploy.mjs [app directory], which defaults to apps/manual.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DOMAIN = "manual.buildanagent.fyi";
const ASSETS_DIRECTORY = "./dist";

/**
 * Parses JSONC: JSON with line and block comments and trailing commas. Comments and commas inside strings stay as
 * they are. The garment original removed trailing commas with a regular expression over the whole text, which also
 * rewrote a string such as ",}"; this version removes them in the same pass that skips strings.
 */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      if (j >= text.length) throw new SyntaxError("unclosed string");
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) throw new SyntaxError("unclosed /* comment");
      i = end + 1;
      out += " ";
    } else if (ch === "," && CLOSERS.has(nextSignificant(text, i + 1))) {
      // A trailing comma: drop it.
    } else {
      out += ch;
    }
  }
  return JSON.parse(out);
}

const CLOSERS = new Set(["}", "]"]);

// The next character after `from` that is not whitespace or inside a comment.
function nextSignificant(text, from) {
  let i = from;
  while (i < text.length) {
    if (/\s/.test(text[i])) i++;
    else if (text[i] === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (text[i] === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) return "";
      i = end + 2;
    } else return text[i];
  }
  return "";
}

/**
 * Returns one message for each of the seven rules the config breaks, or none. `headers` describes the `_headers`
 * files: `source` is public/_headers from main, and `deployed` is the copy in the assets directory; each is the
 * file's text, or null when it is missing.
 */
export function problemsIn(config, headers) {
  const problems = [];
  const routes = config.routes;
  const route = Array.isArray(routes) && routes.length === 1 ? routes[0] : undefined;
  const exactRoute =
    route !== null &&
    typeof route === "object" &&
    Object.keys(route).sort().join() === "custom_domain,pattern" &&
    route.pattern === DOMAIN &&
    route.custom_domain === true;
  if (!exactRoute) {
    problems.push(`"routes" must be exactly [{ "pattern": "${DOMAIN}", "custom_domain": true }]`);
  }
  if ("main" in config) {
    problems.push('"main" must be absent: the book is an assets-only Worker with no code');
  }
  const assets = config.assets !== null && typeof config.assets === "object" ? config.assets : {};
  if (assets.directory !== ASSETS_DIRECTORY) {
    problems.push(`"assets.directory" must be "${ASSETS_DIRECTORY}"`);
  }
  if (assets.not_found_handling !== "404-page") {
    problems.push('"assets.not_found_handling" must be "404-page", so a missing page gets the book\'s 404 page');
  }
  if (config.workers_dev !== false) {
    problems.push('"workers_dev" must be false, so the custom domain is the only production address');
  }
  if (config.preview_urls !== true) {
    problems.push('"preview_urls" must be true, or pull-request previews on workers.dev are turned off');
  }
  if (headers.source === null) {
    problems.push("public/_headers must exist: it holds the content security policy");
  } else if (headers.deployed !== headers.source) {
    problems.push(
      `${ASSETS_DIRECTORY}/_headers must be a copy of public/_headers from main; ` +
        (headers.deployed === null ? "it is missing" : "it differs"),
    );
  }
  return problems;
}

// Reads the config and both _headers files from the app directory and returns the problems.
export function checkApp(appDir) {
  const configPath = join(appDir, "wrangler.jsonc");
  if (!existsSync(configPath)) return ["wrangler.jsonc is missing"];
  let config;
  try {
    config = parseJsonc(readFileSync(configPath, "utf8"));
  } catch (error) {
    return [`wrangler.jsonc could not be read: ${error.message}`];
  }
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    return ["wrangler.jsonc must hold an object"];
  }
  const read = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);
  return problemsIn(config, {
    source: read(join(appDir, "public", "_headers")),
    deployed: read(join(appDir, ASSETS_DIRECTORY, "_headers")),
  });
}

function main() {
  const appDir = resolve(process.argv[2] ?? fileURLToPath(new URL("..", import.meta.url)));
  const problems = checkApp(appDir);
  if (problems.length > 0) {
    console.error(
      `Deploy refused: wrangler.jsonc no longer matches the book's deploy rules.\n- ${problems.join("\n- ")}`,
    );
    process.exit(1);
  }
  console.log(`Deploy guard passed: an assets-only Worker on ${DOMAIN}, with main's _headers in ${ASSETS_DIRECTORY}.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
