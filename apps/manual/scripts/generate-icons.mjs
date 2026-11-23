// Draws the installed app's icons from public/favicon.svg into public/icons/, as scripts/icons.json lists them, and
// records the favicon's SHA-256 there. Each icon is the favicon's light-theme mark centred on the book's light page
// colour, opaque, at the share of the width the list gives. It renders in Playwright's Chromium, as figures:audit does,
// with an allowlisted environment, and the PNGs are committed, so the build never needs a browser.
//
//   node scripts/generate-icons.mjs

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const app = fileURLToPath(new URL("..", import.meta.url));
const listFile = join(app, "scripts", "icons.json");
const list = JSON.parse(readFileSync(listFile, "utf8"));
const svg = readFileSync(join(app, list.source));
const env = { PATH: process.env.PATH ?? "", HOME: tmpdir(), LANG: "C.UTF-8" };
if (process.env.PLAYWRIGHT_BROWSERS_PATH) env.PLAYWRIGHT_BROWSERS_PATH = process.env.PLAYWRIGHT_BROWSERS_PATH;

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try {
    return require("playwright");
  } catch {
    const global = execFileSync("npm", ["root", "-g"], { encoding: "utf8", env }).trim();
    return createRequire(join(global, "x.js"))("playwright");
  }
}
const { chromium } = loadPlaywright();

const page = (size, mark) => {
  const box = Math.round(size * mark);
  const source = `data:image/svg+xml;base64,${svg.toString("base64")}`;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${list.background}; }
    body { display: grid; place-items: center; }
    img { width: ${box}px; height: ${box}px; display: block; }
  </style></head><body><img src="${source}" alt=""></body></html>`;
};

const browser = await chromium.launch({ env });
try {
  const outDir = join(app, "public", "icons");
  mkdirSync(outDir, { recursive: true });
  for (const icon of list.icons) {
    // The light colour scheme, so the favicon's own media query draws its light-theme strokes.
    const context = await browser.newContext({
      viewport: { width: icon.size, height: icon.size },
      deviceScaleFactor: 1,
      colorScheme: "light",
      offline: true,
    });
    const tab = await context.newPage();
    await tab.setContent(page(icon.size, icon.mark));
    await tab.waitForFunction(() => document.querySelector("img")?.complete);
    const png = await tab.screenshot({ type: "png", omitBackground: false });
    writeFileSync(join(outDir, icon.file), png);
    console.log(`wrote public/icons/${icon.file} (${icon.size}x${icon.size}, ${png.length} bytes)`);
    await context.close();
  }
} finally {
  await browser.close();
}
list.sha256 = createHash("sha256").update(svg).digest("hex");
writeFileSync(listFile, `${JSON.stringify(list, null, 2)}\n`);
console.log(`recorded ${list.source}'s SHA-256 in scripts/icons.json`);
