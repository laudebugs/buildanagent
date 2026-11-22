// Renders public/favicon.svg at 16 and 32 px on a light and a dark ground, scaled up 8 times for viewing, into the
// folder given as the first argument (default: the current folder). Run by hand once; it is not part of `test`.
// It needs Playwright: set PLAYWRIGHT_DIR to a folder whose node_modules holds it if it is not installed here.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(process.env.PLAYWRIGHT_DIR ? join(process.env.PLAYWRIGHT_DIR, "/") : import.meta.url);
const { chromium } = require("playwright");

const svg = readFileSync(fileURLToPath(new URL("../public/favicon.svg", import.meta.url)), "utf8");
const out = process.argv[2] ?? ".";
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
const GROUNDS = { light: "#ffffff", dark: "#1f1f1f" };

const browser = await chromium.launch();
for (const [scheme, ground] of Object.entries(GROUNDS)) {
  // colorScheme decides which variant inside the SVG applies, as a tab strip's theme would.
  const context = await browser.newContext({
    viewport: { width: 200, height: 80 },
    deviceScaleFactor: 1,
    colorScheme: scheme,
  });
  const page = await context.newPage();
  for (const size of [16, 32]) {
    await page.setContent(
      `<body style="margin:0;background:${ground}"><img src="${dataUrl}" width="${size}" height="${size}" style="margin:24px"></body>`,
    );
    await page.screenshot({
      path: join(out, `favicon-${size}-${scheme}.png`),
      clip: { x: 0, y: 0, width: size + 48, height: size + 48 },
    });
  }
  await context.close();
}
await browser.close();
console.log(`wrote four PNGs to ${out}`);
