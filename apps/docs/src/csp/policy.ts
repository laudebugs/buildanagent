/**
 * The docs' Content Security Policy, derived from the built site. Every inline script a built page carries is hashed
 * into `script-src`, so a changed script changes its hash and the committed `public/_headers` goes stale, which
 * `test/csp.test.ts` catches. A served SVG that needs its own `<style>` gets a rule of its own. The module imports
 * nothing outside Node and is shared by the build step (`integration.ts`), the `headers` script and the tests.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { asciiLower, decodeReferences, type StartTag, type Tokens, tokenize } from "./html.js";

/**
 * The longest CSP line the build accepts, counting its indent and header name. Cloudflare reads at most
 * `MAX_HEADERS_LINE` characters on one `_headers` line; the margin leaves room for a few more hashes.
 */
export const MAX_CSP_LINE = 1900;
/** Cloudflare's limit on one `_headers` line, spacing, header name and value included. */
export const MAX_HEADERS_LINE = 2000;
/** Cloudflare's limit on the number of rules in one `_headers` file. */
export const MAX_HEADERS_RULES = 100;

/**
 * Each directive of the site-wide policy except the script hashes, in the order the header lists them. Why each
 * source is there:
 *
 * - `default-src 'none'`: anything the list below does not name, such as frames, media and manifests, is blocked.
 * - `script-src 'self'`: the bundled scripts under `/_astro/` and Pagefind's under `/pagefind/`. The hashes, appended
 *   after these, allow the inline scripts by their exact text. `'wasm-unsafe-eval'` lets Pagefind compile its
 *   WebAssembly search index; it allows no `eval()` of script text.
 * - `style-src 'self' 'unsafe-inline'`: the stylesheets, plus the `style=` attributes that Starlight's components and
 *   Expressive Code write on every page (custom properties such as `--depth` and the code colours `--0` and `--1`).
 * - `style-src-elem 'self'`: in a browser that knows this directive, a `<style>` element or stylesheet must come from a
 *   file, so the `'unsafe-inline'` above covers attributes only. The build writes no `<style>` element in a page.
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

/**
 * Attributes whose value a browser reads as a URL, from HTML's index of attributes plus SVG's `xlink:href`. Only these
 * can carry a `javascript:` URL, so a `title` or `data-code` that starts with "javascript:" is text.
 */
const URL_ATTRIBUTES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "itemid",
  "longdesc",
  "manifest",
  "ping",
  "poster",
  "src",
  "srcset",
  "xlink:href",
]);

/** The page's text with CR LF and lone CR turned to LF, as an HTML parser does before it reads anything. */
const normalized = (html: string) => html.replace(/\r\n?/g, "\n");

/**
 * Returns every `<script>` element of a page in order, read by the tokenizer in `html.ts`. Throws when a script has
 * no end tag, sits inside `<svg>` or `<math>` (where a browser decodes character references before it hashes), or
 * holds `<!--`, which switches an HTML parser into a state where the script may end later than its first `</script>`.
 */
export function scriptElements(html: string, tokens: Tokens = tokenize(normalized(html))): ScriptElement[] {
  return tokens.tags
    .filter((tag) => tag.name === "script")
    .map((tag) => {
      if (tag.foreign) throw new Error("a <script> inside <svg> or <math> needs a decision in the policy");
      if (tag.closed !== true) throw new Error(`a <script> at offset ${tag.offset} has no end tag`);
      const text = tag.text ?? "";
      if (text.includes("<!--")) throw new Error(`a <script> at offset ${tag.offset} holds "<!--"`);
      return { attributes: tag.attributes, text };
    });
}

/**
 * Whether the browser runs this element's own text as a script, which the policy must then allow by hash. A script
 * with `src` runs its file, not its text; a data block runs nothing. Throws on any other type, such as `importmap` or
 * `speculationrules`, which the policy treats differently and the docs do not use.
 */
export function runsInlineText(script: ScriptElement): boolean {
  if (script.attributes.has("src")) return false;
  const type = asciiLower((script.attributes.get("type") ?? "").trim());
  if (JAVASCRIPT_TYPES.has(type)) return true;
  if (DATA_TYPES.has(type)) return false;
  throw new Error(`a <script type="${type}"> needs a decision in the docs' content security policy`);
}

/** The CSP source that allows an inline element with exactly this text: `'sha256-<base64 of SHA-256 of its UTF-8>'`. */
export function scriptHash(text: string): string {
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

/** The hashes of every inline script on a page, in page order, repeats included. */
export function inlineScriptHashes(html: string, tokens?: Tokens): string[] {
  return scriptElements(html, tokens)
    .filter(runsInlineText)
    .map((script) => scriptHash(script.text));
}

/**
 * The offsets of every `<script` in the page that the tokenizer neither read as a script tag nor placed inside an
 * attribute value, a comment or raw text. A page with any such offset has a script the hash check could miss.
 */
export function unreadScriptTags(html: string, tokens?: Tokens): number[] {
  const text = normalized(html);
  const { tags, opaque } = tokens ?? tokenize(text);
  const read = new Set(tags.filter((tag) => tag.name === "script").map((tag) => tag.offset));
  const hidden = (at: number) => opaque.some(([start, end]) => at >= start && at < end);
  // ASCII letters only: with the `i` flag alone, a regex would also match "ſ" (U+017F) as "s".
  return [...text.matchAll(/<[sS][cC][rR][iI][pP][tT](?=[\s/>])/g)]
    .map((match) => match.index)
    .filter((at) => !read.has(at) && !hidden(at));
}

/** Builds the site-wide policy from the directives and the inline script hashes, sorted and deduplicated. */
export function policyFor(hashes: Iterable<string>): string {
  const sorted = [...new Set(hashes)].sort();
  return DIRECTIVES.map(([name, sources]) => {
    const all = name === "script-src" ? [...sources, ...sorted] : sources;
    return `${name} ${all.join(" ")}`;
  }).join("; ");
}

/** The policy for one SVG document that needs its own `<style>` elements, allowed by hash, and nothing else. */
export function svgPolicyFor(styleHashes: Iterable<string>): string {
  return `default-src 'none'; style-src ${[...new Set(styleHashes)].sort().join(" ")}; frame-ancestors 'none'`;
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

/** Whether an attribute value is a `javascript:` URL once its character references, spaces and controls are removed. */
export function isJavascriptUrl(value: string): boolean {
  // A URL parser drops C0 controls and spaces, so "java\tscript:" is still a javascript: URL.
  const bare = [...decodeReferences(value)].filter((char) => (char.codePointAt(0) ?? 0) > 0x20).join("");
  return asciiLower(bare).startsWith("javascript:");
}

/** The URLs an attribute carries: one for most, each candidate's URL for `srcset`. */
function urlsOf(name: string, value: string): string[] {
  if (name !== "srcset") return [value];
  return value.split(",").map((candidate) => candidate.trim().split(/\s+/)[0] ?? "");
}

/** SVG animation elements, which can set an `href` to any value, `javascript:` included, through other attributes. */
const SVG_ANIMATIONS = new Set(["animate", "set"]);

/**
 * What the policy blocks on one tag: an inline event handler, a `javascript:` URL in a URL attribute, or an SVG
 * animation that targets `href`, whose `to`, `from`, `by` or `values` could hold such a URL.
 */
function blockedOnTag(tag: StartTag): string[] {
  const problems: string[] = [];
  const target = asciiLower(tag.attributes.get("attributename") ?? "");
  if (SVG_ANIMATIONS.has(tag.name) && (target === "href" || target === "xlink:href")) {
    problems.push(`<${tag.name}> animates ${target}`);
  }
  for (const [name, value] of tag.attributes) {
    if (/^on[a-z]+$/.test(name)) problems.push(`<${tag.name}> has an inline event handler, ${name}=`);
    if (URL_ATTRIBUTES.has(name) && urlsOf(name, value).some(isJavascriptUrl)) {
      problems.push(`<${tag.name}> has a javascript: URL in ${name}=`);
    }
  }
  return problems;
}

/** The markup the policy blocks and the docs must not carry: an inline event handler or a `javascript:` URL. */
export function blockedMarkup(html: string): string[] {
  return tokenize(normalized(html)).tags.flatMap(blockedOnTag);
}

/** The problems of one built HTML page: blocked markup, a `<style>` element and any script the hash check missed. */
export function pageProblems(html: string, tokens: Tokens = tokenize(normalized(html))): string[] {
  const { tags } = tokens;
  const problems = tags.flatMap(blockedOnTag);
  if (tags.some((tag) => tag.name === "style")) problems.push("a <style> element, which style-src-elem 'self' blocks");
  // The tokenizer reads <noscript> as raw text, as a browser with scripts on does, so nothing inside it is checked.
  if (tags.some((tag) => tag.name === "noscript")) problems.push("a <noscript> element, whose content is not checked");
  for (const at of unreadScriptTags(html, tokens))
    problems.push(`a <script at offset ${at} that the tokenizer did not read`);
  return problems;
}

/**
 * Reads a served SVG or XML document. Any script or blocked markup is a problem, and so is a `<style>` whose text
 * holds `&`, `<` or CDATA, because an XML parser would change the text the browser hashes. Returns the hashes of
 * its `<style>` elements, which its own rule must allow.
 */
export function documentStyles(document: string): { styleHashes: string[]; problems: string[] } {
  // Every offset below is into this one normalized text, the text the tokenizer read.
  const text = normalized(document);
  const { tags } = tokenize(text);
  const problems = tags.flatMap(blockedOnTag);
  const styleHashes: string[] = [];
  if (/<\?xml-stylesheet/i.test(text)) problems.push("an <?xml-stylesheet?> instruction");
  for (const tag of tags) {
    if (tag.name === "script") problems.push("a <script> element");
    if (tag.name !== "style") continue;
    // Inside <svg> the tokenizer reads <style> as markup, so its text is everything up to </style>.
    const start = text.indexOf(">", tag.offset) + 1;
    const end = asciiLower(text).indexOf("</style", start);
    const css = end === -1 ? undefined : text.slice(start, end);
    if (css === undefined || /[&<]/.test(css)) problems.push("a <style> whose text an XML parser would change");
    else styleHashes.push(scriptHash(css));
  }
  return { styleHashes, problems };
}

/** One `_headers` rule: its path line and its header lines, each a name, a value and whether it detaches. */
export interface HeadersRule {
  readonly path: string;
  readonly headers: readonly { readonly name: string; readonly value: string; readonly detach: boolean }[];
}

/** Parses a `_headers` file into its rules: a path at the start of a line, then indented header lines. */
export function parseHeaders(text: string): HeadersRule[] {
  const rules: { path: string; headers: HeadersRule["headers"][number][] }[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      rules.push({ path: line.trim(), headers: [] });
      continue;
    }
    const rule = rules.at(-1);
    if (rule === undefined) throw new Error(`a header line comes before any path: ${line.trim()}`);
    const detach = /^\s*!\s/.exec(line);
    if (detach !== null) {
      rule.headers.push({ name: line.slice(detach[0].length).trim(), value: "", detach: true });
      continue;
    }
    const colon = line.indexOf(":");
    rule.headers.push({ name: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim(), detach: false });
  }
  return rules;
}

/** The value of the header `name` that the rule for `path` sets, or undefined. */
export function headerOf(rules: readonly HeadersRule[], path: string, name: string): string | undefined {
  const rule = rules.find((entry) => entry.path === path);
  return rule?.headers.find((header) => !header.detach && header.name.toLowerCase() === name.toLowerCase())?.value;
}

export const CSP_HEADER = "Content-Security-Policy";

const COMMENT = `# Response headers for every file the docs' Worker serves. Cloudflare's asset server reads this file and never serves
# it. The deploy always uses main's copy of this file, never one from a pull request's build.
#
# Generated: do not edit. src/csp/policy.ts holds the policy and the reason for each directive. After a change to an
# inline script, run \`pnpm --filter @buildanagent/docs headers\`, which builds the docs and rewrites this file from the
# built site. test/csp.test.ts fails while this file differs from a fresh build's.
#
# A preview or next.docs.buildanagent.fyi also gets X-Robots-Tag: noindex as the first header of the /* rule, added by
# scripts/ci/site-stage-dist.mjs --noindex. Keep exactly one /* rule and no X-Robots-Tag here.`;

const SVG_COMMENT = `# A served SVG with its own <style> takes a policy of its own: the site-wide one would block that style when the
# file is opened. Rules apply in file order, so each detaches the /* policy first and then sets its own.`;

/** The CSP line of a `_headers` rule, indent included, which `MAX_CSP_LINE` limits for the site-wide policy. */
export function cspLine(policy: string): string {
  return `  ${CSP_HEADER}: ${policy}`;
}

/** The whole `_headers` file: the site-wide policy on `/*`, then one rule for each document with its own policy. */
export function headersFile(policy: string, documents: ReadonlyMap<string, string> = new Map()): string {
  const rules = [...documents].map(([path, own]) => `${path}\n  ! ${CSP_HEADER}\n${cspLine(own)}\n`);
  const tail = rules.length === 0 ? "" : `\n${SVG_COMMENT}\n${rules.join("\n")}`;
  return `${COMMENT}\n/*\n${cspLine(policy)}\n${tail}`;
}

/** Every file under `dist` whose name ends in one of `extensions`, as its path relative to `dist` and its text. */
function builtFiles(dist: string, extensions: readonly string[]): { path: string; text: string }[] {
  return readdirSync(dist, { recursive: true, encoding: "utf8" })
    .filter((path) => extensions.some((extension) => path.toLowerCase().endsWith(extension)))
    .sort()
    .map((path) => ({ path, text: readFileSync(join(dist, path), "utf8") }));
}

/** Every built HTML page under `dist`, as its path relative to `dist` and its text. */
export function builtPages(dist: string): { path: string; html: string }[] {
  return builtFiles(dist, [".html", ".htm", ".xhtml", ".xht"]).map(({ path, text }) => ({ path, html: text }));
}

/** What the build derives from the built site: the `_headers` text, the site-wide policy and the problems. */
export interface SiteHeaders {
  readonly headers: string;
  readonly policy: string;
  readonly hashes: readonly string[];
  /** Each served document with a policy of its own, by its URL path. */
  readonly documents: ReadonlyMap<string, string>;
  readonly problems: readonly string[];
}

/**
 * Derives the `_headers` file from every built page and every served SVG or XML document under `dist`. `problems`
 * lists each blocked construct by file, a CSP line over `MAX_CSP_LINE`, any line over `MAX_HEADERS_LINE` and more
 * rules than `MAX_HEADERS_RULES`.
 */
export function siteHeaders(dist: string): SiteHeaders {
  const hashes = new Set<string>();
  const problems: string[] = [];
  for (const { path, html } of builtPages(dist)) {
    const tokens = tokenize(normalized(html));
    try {
      for (const hash of inlineScriptHashes(html, tokens)) hashes.add(hash);
    } catch (error) {
      problems.push(`${path}: ${(error as Error).message}`);
    }
    for (const problem of pageProblems(html, tokens)) problems.push(`${path}: ${problem}`);
  }
  const documents = new Map<string, string>();
  for (const { path, text } of builtFiles(dist, [".svg", ".xml"])) {
    const found = documentStyles(text);
    for (const problem of found.problems) problems.push(`${path}: ${problem}`);
    if (found.styleHashes.length === 0) continue;
    const url = `/${path.split("\\").join("/")}`;
    if (!/^[A-Za-z0-9._/-]+$/.test(url)) problems.push(`${path}: a name that a _headers rule cannot match exactly`);
    documents.set(url, svgPolicyFor(found.styleHashes));
  }
  const policy = policyFor(hashes);
  const headers = headersFile(policy, documents);
  const line = cspLine(policy);
  if (line.length > MAX_CSP_LINE) {
    problems.push(`the CSP line has ${line.length} characters, over the ${MAX_CSP_LINE} the docs allow`);
  }
  for (const entry of headers.split("\n")) {
    if (entry.length > MAX_HEADERS_LINE) problems.push(`a _headers line has ${entry.length} characters`);
  }
  if (documents.size + 1 > MAX_HEADERS_RULES) problems.push(`_headers would hold ${documents.size + 1} rules`);
  return { headers, policy, hashes: [...hashes].sort(), documents, problems };
}

/** `siteHeaders()`, throwing one error that lists every problem. */
export function checkedSiteHeaders(dist: string): SiteHeaders {
  const site = siteHeaders(dist);
  if (site.problems.length > 0) {
    throw new Error(`The content security policy cannot be built:\n${site.problems.join("\n")}`);
  }
  return site;
}
