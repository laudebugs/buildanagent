import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, test } from "vitest";

// The docs show the same tab icon as the landing page, so public/favicon.svg must stay a byte-for-byte copy of the
// site's, and every built page must link it. The check builds the docs into a temporary folder, because Starlight
// writes the link at build time from its `favicon` option.
const app = fileURLToPath(new URL("..", import.meta.url));
const siteIcon = fileURLToPath(new URL("../../site/public/favicon.svg", import.meta.url));
let out = "";

function nearestBin(name: string): string {
  for (let dir = app; dir !== dirname(dir); dir = dirname(dir)) {
    const bin = join(dir, "node_modules", ".bin", name);
    if (existsSync(bin)) return bin;
  }
  throw new Error(`no node_modules/.bin/${name} above ${app}`);
}

beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), "docs-favicon-"));
  const home = mkdtempSync(join(tmpdir(), "docs-home-"));
  // An allowlisted environment, never ...process.env (AGENTS.md), with Astro's telemetry off so the build stays offline.
  const env = {
    PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    HOME: home,
    TMPDIR: tmpdir(),
    LANG: process.env.LANG ?? "C.UTF-8",
    ASTRO_TELEMETRY_DISABLED: "1",
  };
  try {
    await promisify(execFile)(nearestBin("astro"), ["build", "--outDir", out], { cwd: app, env });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 300_000);

afterAll(() => {
  if (out) rmSync(out, { recursive: true, force: true });
});

test("public/favicon.svg is a byte-for-byte copy of the site's, and the build ships it", () => {
  assert.ok(existsSync(join(app, "public", "favicon.svg")), "public/favicon.svg is missing");
  const site = readFileSync(siteIcon);
  assert.ok(
    readFileSync(join(app, "public", "favicon.svg")).equals(site),
    "public/favicon.svg differs from the site's",
  );
  assert.ok(readFileSync(join(out, "favicon.svg")).equals(site), "the build's favicon.svg differs from the site's");
});

test("every built page links /favicon.svg as its icon", () => {
  const pages = readdirSync(out, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".html"));
  assert.ok(pages.length > 0, "the build wrote no pages");
  for (const path of pages) {
    const html = readFileSync(join(out, path), "utf8");
    // Starlight writes rel="shortcut icon"; a page may use either spelling.
    assert.match(
      html,
      /<link rel="(?:shortcut )?icon" href="\/favicon\.svg" type="image\/svg\+xml"\s*\/?>/,
      `${path}: no icon link`,
    );
  }
});

test("every built page has the header title with the mark, the wordmark and the licence line, and the install tabs sync", () => {
  const pages = readdirSync(out, { recursive: true, encoding: "utf8" }).filter((path) => path.endsWith(".html"));
  for (const path of pages) {
    const html = readFileSync(join(out, path), "utf8");
    const link = /<a href="\/" class="site-title[^"]*">(.*?)<\/a>/.exec(html)?.[1] ?? "";
    assert.match(link, /<svg[^>]*aria-hidden="true"/, `${path}: no mark in the header title`);
    assert.match(link, /Build An Agent<\/span> <span class="kind[^"]*">docs<\/span>/, `${path}: no wordmark`);
    assert.match(
      html,
      /<a href="https:\/\/creativecommons\.org\/licenses\/by\/4\.0\/"[^>]*>CC BY 4\.0<\/a>/,
      `${path}: no licence`,
    );
  }
  // The Install page is MDX with package-manager tabs, so Starlight's synced tabs are on the page.
  const install = readFileSync(join(out, "start", "install", "index.html"), "utf8");
  assert.match(install, /data-sync-key="package-manager"/);
  const tabs = [...install.matchAll(/<a role="tab"[^>]*>([^<]*)<\/a>/g)].map((m) =>
    (m[1] ?? "").replace(/<[^>]*>/g, "").trim(),
  );
  assert.deepEqual(tabs, ["pnpm", "npm", "yarn"]);
});
