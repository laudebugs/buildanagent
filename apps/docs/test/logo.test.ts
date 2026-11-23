import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "vitest";

// The mark is drawn twice: public/favicon.svg, with heavier strokes for the tab, and the inline drawing in
// SiteTitle.astro. The structure tests below always run. The render test draws the favicon at 16 pixels in headless
// Chromium and runs only where Playwright and a browser are installed, which CI does not have today, so it skips with
// its reason instead of failing there.
const favicon = readFileSync(new URL("../public/favicon.svg", import.meta.url), "utf8");
const title = readFileSync(new URL("../src/components/SiteTitle.astro", import.meta.url), "utf8");

test("the favicon is heavy enough for 16 pixels: every stroke is at least 2 pixels wide there", () => {
  const viewBox = /viewBox="0 0 (\d+) \1"/.exec(favicon);
  assert.ok(viewBox, "the favicon is square");
  const scale = 16 / Number(viewBox[1]);
  const widths = [...favicon.matchAll(/stroke-width="([\d.]+)"/g)].map((match) => Number(match[1]));
  assert.equal(widths.length, 3, "a frame, a chevron and a caret");
  for (const width of widths) assert.ok(width * scale >= 2, `a stroke of ${width * scale}px at 16px is too thin`);
});

test("the favicon sets its own colours for light and dark, and draws the caret in a second colour", () => {
  assert.match(favicon, /@media \(prefers-color-scheme: dark\)/);
  const frame = /\.f \{ stroke: (#\w+) \}/.exec(favicon)?.[1];
  const caret = /\.a \{ stroke: (#\w+) \}/.exec(favicon)?.[1];
  assert.ok(frame && caret && frame !== caret, "the frame and the caret take different colours");
  assert.match(favicon, /<title>Build An Agent<\/title>/);
});

test("the header's mark is logo 3, with colours from the docs tokens", () => {
  assert.match(title, /<rect x="7" y="7" width="50" height="50" rx="11"[^>]*stroke="currentColor"\s+stroke-width="5"/);
  assert.match(title, /d="M21 23L34 32L21 41"[^>]*stroke="currentColor"\s+stroke-width="5"/);
  assert.match(title, /d="M38 43H48"[^>]*stroke="var\(--color-accent\)" stroke-width="5"/);
  assert.match(title, /<svg[^>]*aria-hidden="true"/, "the wordmark names the link, so the drawing is hidden");
  assert.match(title, /Build An Agent<\/span> <span class="kind">docs<\/span>/);
});

type Rgb = [number, number, number];
interface Page {
  evaluate(expression: string): Promise<number[]>;
}
interface Browser {
  newContext(options: { colorScheme: "light" | "dark" }): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }>;
  close(): Promise<void>;
}

async function launch(): Promise<Browser | undefined> {
  let chromium: { launch(): Promise<Browser> };
  try {
    ({ chromium } = createRequire(import.meta.url)("playwright") as { chromium: { launch(): Promise<Browser> } });
  } catch (error) {
    // Only a missing module means "not installed"; anything else is a real failure.
    if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") return undefined;
    throw error;
  }
  try {
    return await chromium.launch();
  } catch (error) {
    // Playwright reports a missing browser binary as "Executable doesn't exist"; any other launch error is real.
    if (/Executable doesn't exist|playwright install/i.test(String(error))) return undefined;
    throw error;
  }
}

/**
 * A pixel inside the frame, derived from the 64-unit viewBox at a 16-pixel render (4 units per pixel). The frame's inner
 * edge is 9.5 units from the box edge, so it is pixels 3 to 12; the chevron spans x 18.5 to 36.5 and y 20.5 to 43.5 and the
 * caret sits at y 40.5 to 45.5. The point (46, 18), which is pixel (11, 4), is at least 1.5 pixels from each stroke.
 */
const WINDOW = { x: Math.floor(46 / 4), y: Math.floor(18 / 4) };

/** The luminance of a pixel from 0 to 1, from its red, green and blue bytes. */
const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

test("the favicon stays legible at 16 pixels in light and dark (renders in headless Chromium when it is installed)", async (context) => {
  const browser = await launch();
  if (browser === undefined) return context.skip();
  try {
    const src = `data:image/svg+xml;base64,${Buffer.from(favicon).toString("base64")}`;
    for (const [scheme, ground] of [
      ["light", "rgb(255,255,255)"],
      ["dark", "rgb(0,0,0)"],
    ] as const) {
      // The browser's colour scheme decides which colours the SVG's media query picks. The favicon is drawn on a 16 by
      // 16 canvas over a plain ground, and the canvas's bytes are read back, so no image decoder is needed here.
      const ctx = await browser.newContext({ colorScheme: scheme });
      const page = await ctx.newPage();
      const flat = await page.evaluate(`(async () => {
        const image = new Image();
        image.src = ${JSON.stringify(src)};
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const draw = canvas.getContext("2d");
        draw.fillStyle = ${JSON.stringify(ground)};
        draw.fillRect(0, 0, 16, 16);
        draw.drawImage(image, 0, 0, 16, 16);
        return Array.from(draw.getImageData(0, 0, 16, 16).data);
      })()`);
      await ctx.close();
      const pixels: Rgb[] = [];
      for (let i = 0; i < flat.length; i += 4) pixels.push([flat[i] ?? 0, flat[i + 1] ?? 0, flat[i + 2] ?? 0]);
      const background = luminance(...(pixels[0] as Rgb));
      const ink = pixels.filter((p) => Math.abs(luminance(...p) - background) >= 0.5);
      assert.ok(ink.length >= 40 && ink.length <= 160, `${scheme}: ${ink.length} of 256 pixels are ink`);
      // Inside the frame and beside the chevron, the drawing leaves the ground showing, so the window reads as a window.
      assert.ok(
        Math.abs(luminance(...(pixels[WINDOW.y * 16 + WINDOW.x] as Rgb)) - background) < 0.1,
        `${scheme}: the window is filled`,
      );
      // The caret's own colour, not the frame's: its red exceeds its blue by more than the frame's does.
      assert.ok(
        pixels.some(([r, , b]) => r - b >= 40),
        `${scheme}: no accent-coloured pixel for the caret`,
      );
    }
  } finally {
    await browser.close();
  }
}, 60_000);
