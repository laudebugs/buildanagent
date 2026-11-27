import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import {
  blockedMarkup,
  builtPages,
  cspLine,
  DIRECTIVES,
  headersFile,
  inlineScriptHashes,
  isJavascriptUrl,
  MAX_CSP_LINE,
  parsePolicy,
  policyFor,
  policyOfHeaders,
  runsInlineText,
  scriptElements,
  scriptHash,
  siteHeaders,
} from "../src/csp/policy.js";
import { builtSite } from "./built.js";

// The content security policy in public/_headers, which the deploy serves from main. src/csp/policy.ts derives it from
// the built pages, and these tests fail when the committed file and a fresh build disagree.

const COMMITTED = fileURLToPath(new URL("../public/_headers", import.meta.url));
const committed = () => readFileSync(COMMITTED, "utf8");
const committedPolicy = () => parsePolicy(policyOfHeaders(committed()) ?? "");

test("a script's hash is the base64 SHA-256 of its UTF-8 text", () => {
  // The SHA-256 of nothing, a published test vector.
  assert.equal(scriptHash(""), "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  assert.notEqual(scriptHash("é"), scriptHash("e"));
});

test("scripts are read as an HTML parser reads them", () => {
  const html = [
    `<script>a()</script>`,
    `<SCRIPT type="module" data-x='>'>b()</SCRIPT >`,
    `<script src="/x.js"></script>`,
    `<script type="application/ld+json">{"a":1}</script>`,
    `<script>if (x</scriptx) y()</script>`,
    `<script>\r\nc()\r</script>`,
  ].join("\n");
  const scripts = scriptElements(html);
  assert.deepEqual(
    scripts.map((script) => script.text),
    ["a()", "b()", "", `{"a":1}`, "if (x</scriptx) y()", "\nc()\n"],
  );
  assert.deepEqual(scripts.map(runsInlineText), [true, true, false, false, true, true]);
  assert.deepEqual(inlineScriptHashes(html), ["a()", "b()", "if (x</scriptx) y()", "\nc()\n"].map(scriptHash));
  assert.throws(() => scriptElements("<script>a()"), /no end tag/);
  assert.throws(() => inlineScriptHashes(`<script type="importmap">{}</script>`), /needs a decision/);
});

test("blocked markup is found: inline event handlers and javascript: URLs, but not text that only looks like them", () => {
  assert.deepEqual(blockedMarkup(`<img src="/a.svg" onerror="x()">`), ["<img> has an inline event handler, onerror="]);
  assert.deepEqual(blockedMarkup(`<a HREF=" JaVa&#x53;cript&colon;x()">`), ["<a> has a javascript: URL in href="]);
  assert.deepEqual(blockedMarkup(`<svg><g onclick='x()'></g></svg>`), ["<g> has an inline event handler, onclick="]);
  assert.equal(isJavascriptUrl("java\tscript:x()"), true);
  // Code samples, comments and script text are not markup.
  assert.deepEqual(blockedMarkup(`<code>&lt;a onclick="x()"&gt;</code>`), []);
  assert.deepEqual(blockedMarkup(`<!-- <a href="javascript:x()"> -->`), []);
  assert.deepEqual(blockedMarkup(`<script>el.innerHTML = '<a onclick="x()">'</script>`), []);
  assert.deepEqual(blockedMarkup(`<a href="/javascript:/">`), []);
});

test("the policy lists each directive once, with sorted, unique hashes in script-src and nothing unsafe for scripts", () => {
  const policy = parsePolicy(policyFor(["'sha256-b'", "'sha256-a'", "'sha256-b'"]));
  assert.deepEqual(
    [...policy.keys()],
    DIRECTIVES.map(([name]) => name),
  );
  assert.deepEqual(policy.get("script-src"), ["'self'", "'wasm-unsafe-eval'", "'sha256-a'", "'sha256-b'"]);
  for (const [name, sources] of policy) {
    if (name.startsWith("style-src")) continue;
    for (const source of sources) {
      assert.doesNotMatch(source, /^'(unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic)'$|^\*$|^https?:$/, name);
    }
  }
  assert.equal(policyOfHeaders(headersFile("default-src 'none'")), "default-src 'none'");
});

test("the policy holds the directives the docs need, and style-src makes its one stated exception", () => {
  const policy = committedPolicy();
  assert.deepEqual(policy.get("default-src"), ["'none'"]);
  assert.deepEqual(policy.get("script-src")?.slice(0, 2), ["'self'", "'wasm-unsafe-eval'"]);
  assert.ok(
    policy
      .get("script-src")
      ?.slice(2)
      .every((source) => /^'sha256-[A-Za-z0-9+/]{43}='$/.test(source)),
  );
  // 'unsafe-inline' for style attributes only: style-src-elem limits <style> and stylesheets to the docs' own files.
  assert.deepEqual(policy.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(policy.get("style-src-elem"), ["'self'"]);
  assert.deepEqual(policy.get("img-src"), ["'self'", "data:"]);
  for (const name of ["font-src", "connect-src", "worker-src", "form-action"]) {
    assert.deepEqual(policy.get(name), ["'self'"], name);
  }
  for (const name of ["object-src", "base-uri", "frame-ancestors"])
    assert.deepEqual(policy.get(name), ["'none'"], name);
});

test(`the CSP line stays within ${MAX_CSP_LINE} characters, under Cloudflare's 2,000 per _headers line`, () => {
  const line = committed()
    .split("\n")
    .find((entry) => entry.trim().startsWith("Content-Security-Policy:"));
  assert.ok(line !== undefined, "public/_headers has no Content-Security-Policy line");
  assert.equal(line, cspLine(policyOfHeaders(committed()) ?? ""));
  assert.ok(line.length <= MAX_CSP_LINE, `the CSP line has ${line.length} characters`);
  for (const entry of committed().split("\n"))
    assert.ok(entry.length <= 2000, `a _headers line is over 2,000: ${entry}`);
});

test("public/_headers is exactly what a fresh build derives from its pages", () => {
  const dist = builtSite();
  const built = readFileSync(join(dist, "_headers"), "utf8");
  assert.equal(built, siteHeaders(dist).headers);
  assert.equal(
    committed(),
    built,
    "public/_headers is stale: run `pnpm --filter @buildanagent/docs headers` and commit the file",
  );
});

test("every inline script on every built page has its hash in the committed policy, and every hash is used", () => {
  const allowed = new Set(committedPolicy().get("script-src")?.slice(2));
  const used = new Set<string>();
  for (const { path, html } of builtPages(builtSite())) {
    // Every <script> the page holds is one the parser read, so none escapes the hash check.
    const opened = html.match(/<script\b/gi)?.length ?? 0;
    assert.equal(scriptElements(html).length, opened, `${path}: a <script> the parser did not read`);
    for (const hash of inlineScriptHashes(html)) {
      assert.ok(allowed.has(hash), `${path}: an inline script whose hash ${hash} is not in public/_headers`);
      used.add(hash);
    }
  }
  assert.deepEqual([...allowed].sort(), [...used].sort(), "public/_headers allows a script no page carries");
});

test("no built page carries an inline event handler, a javascript: URL or a <style> element", () => {
  assert.deepEqual(siteHeaders(builtSite()).problems, []);
});

// scripts/ci/site-stage-dist.mjs --noindex adds X-Robots-Tag: noindex to the one /* rule for a preview, and refuses a
// file with more than one such rule or an X-Robots-Tag of its own.
test("the committed file has the one /* rule and no X-Robots-Tag, as the preview deploy requires", () => {
  const lines = committed().split("\n");
  assert.equal(lines.filter((line) => line === "/*").length, 1);
  assert.equal(lines.filter((line) => /^\s*X-Robots-Tag:/i.test(line)).length, 0);
});
