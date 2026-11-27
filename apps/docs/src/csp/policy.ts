/**
 * The docs' Content Security Policy, derived from the built pages. Every inline script a built page carries is hashed
 * into `script-src`, so a changed script changes its hash and the committed `public/_headers` goes stale, which
 * `test/csp.test.ts` catches. The module reads HTML as text, imports nothing outside Node and is shared by the build
 * step (`integration.ts`), the script that rewrites `public/_headers` and the tests.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The longest CSP line the build accepts, counting its indent and header name. Cloudflare reads at most 2,000
 * characters on one `_headers` line; the margin leaves room for a hash or two before a change hits that limit.
 */
export const MAX_CSP_LINE = 1900;

/**
 * Each directive except the script hashes, in the order the header lists them. Why each source is there:
 *
 * - `default-src 'none'`: anything the list below does not name, such as frames, media and manifests, is blocked.
 * - `script-src 'self'`: the bundled scripts under `/_astro/` and Pagefind's under `/pagefind/`. The hashes, appended
 *   after these, allow the inline scripts by their exact text. `'wasm-unsafe-eval'` lets Pagefind compile its
 *   WebAssembly search index; it allows no `eval()` of script text.
 * - `style-src 'self' 'unsafe-inline'`: the stylesheets, plus the `style=` attributes that Starlight's components and
 *   Expressive Code write on every page (custom properties such as `--depth` and the code colours `--0` and `--1`).
 * - `style-src-elem 'self'`: in a browser that knows this directive, a `<style>` element or stylesheet must come from a
 *   file, so the `'unsafe-inline'` above covers attributes only. The build writes no `<style>` element.
 * - `img-src 'self' data:`: the favicon, plus the `data:` SVG icons that Starlight's and Pagefind's stylesheets draw.
 * - `font-src 'self'`, `connect-src 'self'`, `worker-src 'self'`: the self-hosted fonts; Pagefind's index fetches and
 *   the "Copy as Markdown" fetch of a page's twin; Pagefind's web worker.
 * - `object-src 'none'`: no plugin content (`default-src 'none'` already blocks it; stated for readers of the header).
 * - `base-uri 'none'`: no page uses `<base>`, so an injected one cannot redirect relative script addresses.
 * - `form-action 'self'`: no page submits a form; a form can only post to the docs' own origin.
 * - `frame-ancestors 'none'`: no other site may frame the docs, which stops clickjacking.
 */
export const DIRECTIVES: readonly (readonly [string, readonly string[]])[] = [
  ["default-src", ["'none'"]],
  ["script-src", ["'self'", "'wasm-unsafe-eval'"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["style-src-elem", ["'self'"]],
  ["img-src", ["'self'", "data:"]],
  ["font-src", ["'self'"]],
  ["connect-src", ["'self'"]],
  ["worker-src", ["'self'"]],
  ["object-src", ["'none'"]],
  ["base-uri", ["'none'"]],
  ["form-action", ["'self'"]],
  ["frame-ancestors", ["'none'"]],
];

/** One `<script>` element as the HTML holds it: its attributes and its raw text. */
export interface ScriptElement {
  readonly attributes: ReadonlyMap<string, string>;
  readonly text: string;
}

/** The `type` values whose inline text a browser runs as JavaScript (HTML's JavaScript MIME type essences). */
const JAVASCRIPT_TYPES = new Set([
  "",
  "module",
  "application/ecmascript",
  "application/javascript",
  "application/x-ecmascript",
  "application/x-javascript",
  "text/ecmascript",
  "text/javascript",
  "text/javascript1.0",
  "text/javascript1.1",
  "text/javascript1.2",
  "text/javascript1.3",
  "text/javascript1.4",
  "text/javascript1.5",
  "text/jscript",
  "text/livescript",
  "text/x-ecmascript",
  "text/x-javascript",
]);

/** Data blocks: the browser never runs them, and the policy does not apply to them. */
const DATA_TYPES = new Set(["application/json", "application/ld+json"]);

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** Reads a start tag's attribute text into a map of lower-case names to their raw values. */
export function attributesOf(text: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of text.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? "").toLowerCase();
    if (!attributes.has(name)) attributes.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

const SCRIPT_START = /<script\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const SCRIPT_END = /<\/script[\s/>]/gi;

/**
 * Returns every `<script>` element of a page in order. A script's text runs to the first `</script` that a space, a
 * slash or `>` follows, as an HTML parser reads it. Line ends are normalized to LF first, as the parser does before a
 * browser hashes the text. Throws when a script has no end tag.
 */
export function scriptElements(html: string): ScriptElement[] {
  const source = html.replace(/\r\n?/g, "\n");
  const scripts: ScriptElement[] = [];
  SCRIPT_START.lastIndex = 0;
  for (let start = SCRIPT_START.exec(source); start !== null; start = SCRIPT_START.exec(source)) {
    const textStart = start.index + start[0].length;
    SCRIPT_END.lastIndex = textStart;
    const end = SCRIPT_END.exec(source);
    if (end === null) throw new Error(`a <script> at offset ${start.index} has no end tag`);
    scripts.push({ attributes: attributesOf(start[1] ?? ""), text: source.slice(textStart, end.index) });
    SCRIPT_START.lastIndex = end.index;
  }
  return scripts;
}

/**
 * Whether the browser runs this element's own text as a script, which the policy must then allow by hash. A script
 * with `src` runs its file, not its text; a data block runs nothing. Throws on any other type, such as `importmap` or
 * `speculationrules`, which the policy treats differently and the docs do not use.
 */
export function runsInlineText(script: ScriptElement): boolean {
  if (script.attributes.has("src")) return false;
  const type = (script.attributes.get("type") ?? "").trim().toLowerCase();
  if (JAVASCRIPT_TYPES.has(type)) return true;
  if (DATA_TYPES.has(type)) return false;
  throw new Error(`a <script type="${type}"> needs a decision in the docs' content security policy`);
}

/** The CSP source that allows a script with exactly this text: `'sha256-<base64 of SHA-256 of its UTF-8>'`. */
export function scriptHash(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** The hashes of every inline script on a page, in page order, repeats included. */
export function inlineScriptHashes(html: string): string[] {
  return scriptElements(html)
    .filter(runsInlineText)
    .map((script) => scriptHash(script.text));
}

/** Builds the policy's value from the directives and the inline script hashes, which are sorted and deduplicated. */
export function policyFor(hashes: Iterable<string>): string {
  const sorted = [...new Set(hashes)].sort();
  return DIRECTIVES.map(([name, sources]) => {
    const all = name === "script-src" ? [...sources, ...sorted] : sources;
    return `${name} ${all.join(" ")}`;
  }).join("; ");
}

/** Parses a policy's value into its directives, each name mapped to its sources. */
export function parsePolicy(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name !== undefined && name !== "") directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

const HEADER_NAME = "Content-Security-Policy";
const COMMENT = `# Response headers for every file the docs' Worker serves. Cloudflare's asset server reads this file and never serves
# it. The deploy always uses main's copy of this file, never one from a pull request's build.
#
# Generated: do not edit. src/csp/policy.ts holds the policy and the reason for each directive. After a change to an
# inline script, run \`pnpm --filter @buildanagent/docs headers\`, which builds the docs and rewrites this file from the
# built pages. test/csp.test.ts fails while this file differs from a fresh build's.
#
# A preview or next.docs.buildanagent.fyi also gets X-Robots-Tag: noindex as the first header of the /* rule, added by
# scripts/ci/site-stage-dist.mjs --noindex. Keep exactly one /* rule and no X-Robots-Tag here.`;

/** The CSP line of a `_headers` file, indent included, which `MAX_CSP_LINE` limits. */
export function cspLine(policy: string): string {
  return `  ${HEADER_NAME}: ${policy}`;
}

/** The whole `_headers` file for a policy. */
export function headersFile(policy: string): string {
  return `${COMMENT}\n/*\n${cspLine(policy)}\n`;
}

/** Returns the CSP value of a `_headers` file's one `/*` rule, or undefined when it sets none. */
export function policyOfHeaders(text: string): string | undefined {
  const prefix = `${HEADER_NAME}:`;
  const line = text.split("\n").find((entry) => entry.trim().startsWith(prefix));
  return line?.trim().slice(prefix.length).trim();
}

/** The markup the policy blocks and the docs must not carry: an inline event handler or a `javascript:` URL. */
export function blockedMarkup(html: string): string[] {
  const problems: string[] = [];
  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  const tags = withoutScriptText(markup).matchAll(/<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g);
  for (const [, tag, rest] of tags) {
    for (const [name, value] of attributesOf(rest ?? "")) {
      if (/^on[a-z]+$/.test(name)) problems.push(`<${tag}> has an inline event handler, ${name}=`);
      if (isJavascriptUrl(value)) problems.push(`<${tag}> has a javascript: URL in ${name}=`);
    }
  }
  return problems;
}

/** The page's markup with each script's text removed, so a `<` inside a script cannot read as a tag. */
function withoutScriptText(html: string): string {
  let out = "";
  let at = 0;
  SCRIPT_START.lastIndex = 0;
  for (let start = SCRIPT_START.exec(html); start !== null; start = SCRIPT_START.exec(html)) {
    const textStart = start.index + start[0].length;
    SCRIPT_END.lastIndex = textStart;
    const end = SCRIPT_END.exec(html);
    out += html.slice(at, textStart);
    at = end === null ? html.length : end.index;
    SCRIPT_START.lastIndex = at;
  }
  return out + html.slice(at);
}

/** Whether an attribute value is a `javascript:` URL once its character references, spaces and controls are removed. */
export function isJavascriptUrl(value: string): boolean {
  const decoded = value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);?/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;|&newline;/gi, "");
  // A URL parser drops C0 controls and spaces, so "java\tscript:" is still a javascript: URL.
  const bare = [...decoded].filter((char) => (char.codePointAt(0) ?? 0) > 0x20).join("");
  return /^javascript:/i.test(bare);
}

/** Every built HTML page under `dist`, as its path relative to `dist` and its text. */
export function builtPages(dist: string): { path: string; html: string }[] {
  return readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".html"))
    .sort()
    .map((path) => ({ path, html: readFileSync(join(dist, path), "utf8") }));
}

/** What the build step derives from the built pages: the `_headers` text, the policy and its problems. */
export interface SiteHeaders {
  readonly headers: string;
  readonly policy: string;
  readonly hashes: readonly string[];
  readonly problems: readonly string[];
}

/**
 * Derives the `_headers` file from every built page under `dist`. `problems` lists each blocked construct by page,
 * each `<style>` element (which `style-src-elem 'self'` blocks) and a CSP line over `MAX_CSP_LINE`.
 */
export function siteHeaders(dist: string): SiteHeaders {
  const hashes = new Set<string>();
  const problems: string[] = [];
  for (const { path, html } of builtPages(dist)) {
    for (const hash of inlineScriptHashes(html)) hashes.add(hash);
    for (const problem of blockedMarkup(html)) problems.push(`${path}: ${problem}`);
    if (/<style[\s>]/i.test(withoutScriptText(html.replace(/<!--[\s\S]*?-->/g, "")))) {
      problems.push(`${path}: a <style> element, which style-src-elem 'self' blocks`);
    }
  }
  const policy = policyFor(hashes);
  const line = cspLine(policy);
  if (line.length > MAX_CSP_LINE) {
    problems.push(`the CSP line has ${line.length} characters, over the ${MAX_CSP_LINE} the docs allow`);
  }
  return { headers: headersFile(policy), policy, hashes: [...hashes].sort(), problems };
}
