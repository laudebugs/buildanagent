import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";
import {
  blockedMarkup,
  builtPages,
  CSP_HEADER,
  cspLine,
  DIRECTIVES,
  documentStyles,
  headerOf,
  headersFile,
  inlineScriptHashes,
  isJavascriptUrl,
  MAX_CSP_LINE,
  MAX_HEADERS_LINE,
  MAX_HEADERS_RULES,
  pageProblems,
  parseHeaders,
  parsePolicy,
  policyFor,
  runsInlineText,
  scriptElements,
  scriptHash,
  siteHeaders,
  svgPolicyFor,
  unreadScriptTags,
} from "../src/csp/policy.js";
import { builtSite } from "./built.js";

// The content security policy in public/_headers, which the deploy serves from main. src/csp/policy.ts derives it from
// the built site, and these tests fail when the committed file and a fresh build disagree.

const COMMITTED = fileURLToPath(new URL("../public/_headers", import.meta.url));
const FAVICON = fileURLToPath(new URL("../public/favicon.svg", import.meta.url));
const committed = () => readFileSync(COMMITTED, "utf8");
const committedRules = () => parseHeaders(committed());
const committedPolicy = () => parsePolicy(headerOf(committedRules(), "/*", CSP_HEADER) ?? "");

// The parser

test("a hash is the base64 SHA-256 of the UTF-8 text", () => {
  // The SHA-256 of nothing, a published test vector.
  assert.equal(scriptHash(""), "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  assert.notEqual(scriptHash("é"), scriptHash("e"));
});

test("a script's text runs to the first </script that a space, a slash or > follows, with line ends normalized", () => {
  const scripts = scriptElements(
    `<script>a()</script><SCRIPT type="module" data-x='>'>b()</SCRIPT ><script>if (x</scriptx) y()</script>` +
      `<script>\r\nc()\r</script>`,
  );
  assert.deepEqual(
    scripts.map((script) => script.text),
    ["a()", "b()", "if (x</scriptx) y()", "\nc()\n"],
  );
});

test("only scripts whose own text runs are hashed: no src, no data block", () => {
  const html = `<script>a()</script><script src="/x.js"></script><script type="application/ld+json">{}</script>`;
  assert.deepEqual(scriptElements(html).map(runsInlineText), [true, false, false]);
  assert.deepEqual(inlineScriptHashes(html), [scriptHash("a()")]);
});

test("a script the policy cannot judge fails loudly", () => {
  assert.throws(() => scriptElements("<script>a()"), /no end tag/);
  assert.throws(() => inlineScriptHashes(`<script type="importmap">{}</script>`), /needs a decision/);
  // Inside <svg> a browser decodes "&amp;" before it hashes, so the text would not match.
  assert.throws(() => scriptElements("<svg><script>a &amp;&amp; b</script></svg>"), /inside <svg> or <math>/);
  // "<!--" moves an HTML parser into the escaped script states, where the end tag can move.
  assert.throws(() => scriptElements("<script><!-- a() --></script>"), /holds "<!--"/);
});

test("markup inside an attribute value, a comment or another script's text is not a tag", () => {
  const html = `<div data-code="const xs: Array<Script> = []"></div><p>hi</p><script>real()</script>`;
  assert.deepEqual(
    scriptElements(html).map((script) => script.text),
    ["real()"],
  );
  assert.deepEqual(scriptElements(`<!-- <script>x()</script> --><script>y()</script>`).length, 1);
  assert.deepEqual(unreadScriptTags(`<script>document.write("<script")</script><b title="<script>">`), []);
});

test("an event handler after a code sample is still found", () => {
  const html = `<div data-code="Array<Script>"></div><button onclick="x()">go</button>`;
  assert.deepEqual(blockedMarkup(html), ["<button> has an inline event handler, onclick="]);
});

test("a quote inside an unquoted attribute value is a literal character", () => {
  assert.deepEqual(blockedMarkup(`<a title=x"y onclick=alert(1) href=/>t</a>`), [
    "<a> has an inline event handler, onclick=",
  ]);
});

test("a javascript: URL is found in a URL attribute, encoded or spaced", () => {
  assert.deepEqual(blockedMarkup(`<a HREF=" JaVa&#x53;cript&colon;x()">`), ["<a> has a javascript: URL in href="]);
  assert.deepEqual(blockedMarkup(`<img srcset="/a.png 1x, javascript:x() 2x">`), [
    "<img> has a javascript: URL in srcset=",
  ]);
  assert.equal(isJavascriptUrl("java\tscript:x()"), true);
  assert.equal(isJavascriptUrl("&#0;"), false);
});

test("text that only starts with javascript: in a non-URL attribute is not a URL", () => {
  assert.deepEqual(blockedMarkup(`<p title="javascript: the language" data-code="javascript:x()">`), []);
  assert.deepEqual(blockedMarkup(`<a href="/javascript:/">`), []);
  assert.deepEqual(blockedMarkup(`<code>&lt;a onclick="x()"&gt;</code><!-- <a href="javascript:x()"> -->`), []);
});

test("a page with a <style> element is a problem", () => {
  assert.deepEqual(pageProblems("<p>a</p>"), []);
  assert.deepEqual(pageProblems("<style>p{}</style>"), ["a <style> element, which style-src-elem 'self' blocks"]);
});

test("a served SVG's <style> is allowed by its hash, and a script or a changed text is a problem", () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg"><title>t</title><style>.f { stroke: red }</style></svg>`;
  assert.deepEqual(documentStyles(svg), { styleHashes: [scriptHash(".f { stroke: red }")], problems: [] });
  assert.deepEqual(documentStyles(`<svg><script>x()</script></svg>`).problems, ["a <script> element"]);
  assert.deepEqual(documentStyles(`<svg><style>a::after{content:"&amp;"}</style></svg>`).problems, [
    "a <style> whose text an XML parser would change",
  ]);
  assert.deepEqual(documentStyles(`<svg><a href="javascript:x()"/></svg>`).problems, [
    "<a> has a javascript: URL in href=",
  ]);
});

test("characters that change length when lower-cased do not move where a script, style, title or textarea ends", () => {
  // "İ" (U+0130) lower-cases to two UTF-16 units; "ẞ" and "Ω" keep their length but are not ASCII.
  for (const before of ["<p>İİİ</p>", "<title>İİİİİİ</title>", "<textarea>İİİ</textarea>", "<style>/*İİ*/</style>"]) {
    assert.deepEqual(
      scriptElements(`${before}<script>x()</script>`).map((script) => script.text),
      ["x()"],
      before,
    );
  }
  assert.deepEqual(
    scriptElements("<script>'İẞΩ'</script><script>y()</script>").map((script) => script.text),
    ["'İẞΩ'", "y()"],
  );
  assert.deepEqual(unreadScriptTags("<p>İİ<ſcript></p>"), []);
});

test("a served SVG with CRLF line ends hashes its style from the same text the tokenizer read", () => {
  const svg = "<svg>\r\n<g/>\r\n<g/>\r\n<g/>\r\n<g/>\r\n<g/><style>.a{}</style></svg>";
  assert.deepEqual(documentStyles(svg), { styleHashes: [scriptHash(".a{}")], problems: [] });
  assert.deepEqual(documentStyles("<svg><style>.a{\r\n}</style></svg>").styleHashes, [scriptHash(".a{\n}")]);
});

test("a / inside an unquoted value does not close the tag, so the <svg> stays open", () => {
  // "/ >" is not self-closing either: the slash must come right before the ">".
  for (const svg of ["<svg a=b/>", "<svg a=/>", "<svg / >"]) {
    assert.throws(() => scriptElements(`${svg}<script>a&amp;b</script></svg>`), /inside <svg> or <math>/, svg);
  }
  // A real self-closing <svg/> opens no foreign content.
  assert.deepEqual(scriptElements("<svg/><script>a()</script>").length, 1);
});

test("an SVG animation that targets href, and a <noscript>, are problems", () => {
  assert.deepEqual(blockedMarkup(`<svg><a><set attributeName="href" to="javascript:x()"/></a></svg>`), [
    "<set> animates href",
  ]);
  assert.deepEqual(blockedMarkup(`<svg><animate attributeName="xlink:href" values="javascript:x()"/></svg>`), [
    "<animate> animates xlink:href",
  ]);
  assert.deepEqual(blockedMarkup(`<svg><animate attributeName="opacity" values="0;1"/></svg>`), []);
  assert.deepEqual(pageProblems("<noscript><style>p{}</style></noscript>"), [
    "a <noscript> element, whose content is not checked",
  ]);
});

// The policy

test("the site-wide policy lists each directive once, with sorted, unique hashes in script-src", () => {
  const policy = parsePolicy(policyFor(["'sha256-b'", "'sha256-a'", "'sha256-b'"]));
  assert.deepEqual(
    [...policy.keys()],
    DIRECTIVES.map(([name]) => name),
  );
  assert.deepEqual(policy.get("script-src"), ["'self'", "'wasm-unsafe-eval'", "'sha256-a'", "'sha256-b'"]);
});

test("no directive but style-src allows anything unsafe or any host", () => {
  for (const [name, sources] of parsePolicy(policyFor(["'sha256-a'"]))) {
    if (name.startsWith("style-src")) continue;
    for (const source of sources) {
      assert.doesNotMatch(source, /^'(unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic)'$|^\*$|^https?:$/, name);
    }
  }
});

test("a document rule detaches the site-wide policy and then sets its own", () => {
  const text = headersFile("default-src 'none'", new Map([["/a.svg", svgPolicyFor(["'sha256-x'"])]]));
  const rules = parseHeaders(text);
  assert.deepEqual(
    rules.map((rule) => rule.path),
    ["/*", "/a.svg"],
  );
  assert.deepEqual(rules[1]?.headers, [
    { name: CSP_HEADER, value: "", detach: true },
    { name: CSP_HEADER, value: "default-src 'none'; style-src 'sha256-x'; frame-ancestors 'none'", detach: false },
  ]);
});

test("the committed policy holds the directives the docs need, and style-src makes its one stated exception", () => {
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

test(`the CSP line stays within ${MAX_CSP_LINE} characters and every line within Cloudflare's ${MAX_HEADERS_LINE}`, () => {
  const policy = headerOf(committedRules(), "/*", CSP_HEADER);
  assert.ok(policy !== undefined, "public/_headers has no Content-Security-Policy on /*");
  assert.ok(cspLine(policy).length <= MAX_CSP_LINE, `the CSP line has ${cspLine(policy).length} characters`);
  for (const line of committed().split("\n")) assert.ok(line.length <= MAX_HEADERS_LINE, `a long line: ${line}`);
  assert.ok(committedRules().length <= MAX_HEADERS_RULES);
});

// scripts/ci/site-stage-dist.mjs --noindex adds X-Robots-Tag: noindex to the one /* rule for a preview, and refuses a
// file with more than one such rule or an X-Robots-Tag of its own.
test("the committed file has the one /* rule and no X-Robots-Tag, as the preview deploy requires", () => {
  const lines = committed().split("\n");
  assert.equal(lines.filter((line) => line === "/*").length, 1);
  assert.equal(lines.filter((line) => /^\s*X-Robots-Tag:/i.test(line)).length, 0);
});

test("the favicon, which colours itself with a <style>, gets a policy that allows exactly that style", () => {
  const { styleHashes } = documentStyles(readFileSync(FAVICON, "utf8"));
  assert.equal(styleHashes.length, 1);
  assert.equal(headerOf(committedRules(), "/favicon.svg", CSP_HEADER), svgPolicyFor(styleHashes));
});

// The built site

test("public/_headers is exactly what a fresh build derives from the built site", () => {
  const dist = builtSite();
  const built = readFileSync(join(dist, "_headers"), "utf8");
  assert.equal(built, siteHeaders(dist).headers);
  assert.equal(
    committed(),
    built,
    "public/_headers is stale: run `pnpm --filter @buildanagent/docs headers` and commit the file",
  );
}, 60_000);

test("every inline script on every built page has its hash in the committed policy", () => {
  const allowed = new Set(committedPolicy().get("script-src")?.slice(2));
  for (const { path, html } of builtPages(builtSite())) {
    for (const hash of inlineScriptHashes(html)) {
      assert.ok(allowed.has(hash), `${path}: an inline script whose hash ${hash} is not in public/_headers`);
    }
  }
}, 60_000);

test("every hash in the committed policy belongs to a built inline script", () => {
  const used = new Set(builtPages(builtSite()).flatMap(({ html }) => inlineScriptHashes(html)));
  assert.deepEqual(
    committedPolicy()
      .get("script-src")
      ?.slice(2)
      .filter((hash) => !used.has(hash)),
    [],
  );
}, 60_000);

test("no built page or served document carries markup the policy blocks", () => {
  assert.deepEqual(siteHeaders(builtSite()).problems, []);
}, 60_000);

test("a built page's code sample holding <script> and <style> text changes nothing the checks read", () => {
  const page = builtPages(builtSite()).find(({ html }) => html.includes('data-code="'));
  assert.ok(page !== undefined, "no built page has an Expressive Code block");
  const at = page.html.indexOf('data-code="') + 'data-code="'.length;
  const sample = `<script>evil()</script><style>p{}</style><a onclick=x()> `;
  const html = page.html.slice(0, at) + sample + page.html.slice(at);
  assert.deepEqual(inlineScriptHashes(html), inlineScriptHashes(page.html));
  assert.deepEqual(pageProblems(html), []);
});
