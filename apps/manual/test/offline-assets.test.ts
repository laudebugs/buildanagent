import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { test } from "vitest";
import tokens from "../../../docs/design/book-tokens.json" with { type: "json" };

// The installed app's files in public/: the manifest, the icons that scripts/generate-icons.mjs draws from the
// favicon, and the _headers rules for the worker and the manifest (ADR 0059). The service worker and its file list
// are checked against a real build in offline-build.test.ts.
const app = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(app, path));
const manifest = JSON.parse(read("public/manifest.webmanifest").toString("utf8"));
const iconList = JSON.parse(read("scripts/icons.json").toString("utf8")) as {
  source: string;
  sha256: string;
  background: string;
  icons: { file: string; size: number; mark: number; maskable?: boolean }[];
};
const page = tokens.color.light.values.background;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decodes an 8-bit, non-interlaced RGB or RGBA PNG into its width, height, channels and unfiltered pixels. */
function decodePng(png: Buffer) {
  assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE), "the PNG signature");
  let at = 8;
  let header: Buffer | undefined;
  const data: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("latin1", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") header = body;
    if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  assert.ok(header, "an IHDR chunk");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [depth, colour, , , interlace] = [header[8], header[9], header[10], header[11], header[12]];
  assert.equal(depth, 8);
  assert.equal(interlace, 0);
  const channels = colour === 2 ? 3 : colour === 6 ? 4 : 0;
  assert.ok(channels, `colour type ${colour}`);
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (pixels[y * stride + x - channels] ?? 0) : 0;
      const up = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const corner = x >= channels && y > 0 ? (pixels[(y - 1) * stride + x - channels] ?? 0) : 0;
      const paeth = () => {
        const p = left + up - corner;
        const [a, b, c] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        return a <= b && a <= c ? left : b <= c ? up : corner;
      };
      const predictor = [0, left, up, (left + up) >> 1, paeth()][filter ?? 0] ?? 0;
      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

const hex = (color: string) => [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));

test("the manifest names the book, starts and stays at the root, opens standalone and takes the tokens' colours", () => {
  assert.equal(manifest.name, "Build An Agent manual");
  assert.ok(manifest.short_name.length <= 12, "a short name a launcher shows whole");
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.background_color, page);
  assert.equal(manifest.theme_color, page);
  assert.equal(iconList.background, page, "the icons are drawn on the same page colour");
});

test("the manifest lists a 192 and a 512 pixel icon, and a maskable one, each a file the icon list draws", () => {
  const sizes = (purpose: string) =>
    manifest.icons
      .filter((icon: { purpose: string }) => icon.purpose === purpose)
      .map((i: { sizes: string }) => i.sizes);
  assert.deepEqual(sizes("any"), ["192x192", "512x512"]);
  assert.deepEqual(sizes("maskable"), ["512x512"]);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/icons\/[a-z0-9-]+\.png$/);
    assert.equal(icon.type, "image/png");
    const drawn = iconList.icons.find((entry) => `/icons/${entry.file}` === icon.src);
    assert.ok(drawn, `${icon.src} is drawn by the script`);
    assert.equal(icon.sizes, `${drawn.size}x${drawn.size}`);
    assert.equal(Boolean(drawn.maskable), icon.purpose === "maskable");
  }
});

test("the icons were drawn from the favicon as it is now; after an edit, run `pnpm --filter @buildanagent/manual icons`", () => {
  const svg = read(iconList.source);
  assert.equal(createHash("sha256").update(svg).digest("hex"), iconList.sha256);
});

test("every icon is an opaque PNG of its size whose corners are the page colour", () => {
  for (const icon of iconList.icons) {
    const path = join(app, "public", "icons", icon.file);
    assert.ok(existsSync(path), `${icon.file} is committed`);
    const { width, height, channels, pixels } = decodePng(readFileSync(path));
    assert.equal(width, icon.size, icon.file);
    assert.equal(height, icon.size, icon.file);
    const at = (x: number, y: number) => [
      ...pixels.subarray((y * width + x) * channels, (y * width + x) * channels + 3),
    ];
    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ] as const) {
      assert.deepEqual(at(x, y), hex(page), `${icon.file} corner ${x},${y}`);
    }
    if (channels === 4) {
      for (let i = 3; i < pixels.length; i += 4) assert.equal(pixels[i], 255, `${icon.file} is opaque`);
    }
  }
});

test("the maskable icon keeps every pixel of the mark inside the centre circle of 80% of its width", () => {
  const icon = iconList.icons.find((entry) => entry.maskable);
  assert.ok(icon);
  const { width, height, channels, pixels } = decodePng(read(join("public", "icons", icon.file)));
  const background = hex(page);
  const radius = 0.4 * width;
  let markPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const differs = [0, 1, 2].some((c) => Math.abs((pixels[i + c] ?? 0) - (background[c] ?? 0)) > 2);
      if (!differs) continue;
      markPixels++;
      const distance = Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2);
      assert.ok(distance <= radius, `a mark pixel at ${x},${y} lies ${distance.toFixed(1)} px out, past ${radius}`);
    }
  }
  assert.ok(markPixels > width * 10, "the icon draws the mark");
});

test("_headers sends the worker and its list with no-cache and the manifest with its media type", () => {
  const headers = read("public/_headers").toString("utf8");
  const rule = (path: string) => {
    const start = headers.indexOf(`\n${path}\n`);
    assert.ok(start >= 0, `a ${path} rule`);
    const end = headers.indexOf("\n\n", start + 1);
    return headers.slice(start + path.length + 2, end === -1 ? undefined : end).trimEnd();
  };
  assert.equal(rule("/sw.js"), "  Cache-Control: no-cache");
  assert.equal(rule("/offline-manifest.json"), "  Cache-Control: no-cache");
  assert.equal(rule("/manifest.webmanifest"), "  Content-Type: application/manifest+json");
  assert.equal(headers.split("\n").filter((line) => line === "/*").length, 1, "exactly one /* rule");
  const rules = headers
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  assert.doesNotMatch(rules, /Service-Worker-Allowed/, "the worker sits at the root and needs no wider scope");
});
