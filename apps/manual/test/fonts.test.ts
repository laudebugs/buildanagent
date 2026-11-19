import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { readTokens } from "../src/design/tokens.js";

const publicDir = new URL("../public/", import.meta.url);
const fontsDir = new URL("fonts/", publicDir);
const sources = JSON.parse(readFileSync(new URL("../fonts/sources.json", import.meta.url), "utf8")) as {
  commit: string;
  files: { path: string; sha256: string }[];
};
const tokens = readTokens();
const fonts = [tokens.font.display, tokens.font.body, tokens.font.code];

// Each served folder and the upstream folder its licence files come from, unchanged.
const LICENCES: Record<string, { upstream: string; files: string[] }> = {
  "instrument-serif": { upstream: "instrumentserif", files: ["OFL.txt"] },
  literata: { upstream: "literata", files: ["OFL.txt"] },
  "manual-code": { upstream: "googlesanscode", files: ["OFL.txt", "TRADEMARKS.md"] },
};

function sha256(url: URL): string {
  return createHash("sha256").update(readFileSync(url)).digest("hex");
}

test("every font file the tokens name is a WOFF2 file the site serves", () => {
  for (const font of fonts) {
    for (const file of font.files) {
      const bytes = readFileSync(new URL(`.${file.src}`, publicDir));
      assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${file.src} is WOFF2`);
    }
  }
});

test("each font folder ships its upstream OFL.txt, byte for byte, from the recorded google/fonts commit", () => {
  assert.match(sources.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(readdirSync(fontsDir).sort(), Object.keys(LICENCES).sort());
  for (const [folder, { upstream, files }] of Object.entries(LICENCES)) {
    for (const file of files) {
      const recorded = sources.files.find((entry) => entry.path === `${upstream}/${file}`);
      assert.ok(recorded, `fonts/sources.json records ${upstream}/${file}`);
      assert.equal(sha256(new URL(`${folder}/${file}`, fontsDir)), recorded.sha256, `${folder}/${file} is unchanged`);
    }
  }
});

test("the subsets derived from Google Sans Code carry a neutral name, as its TRADEMARKS.md asks", () => {
  for (const folder of readdirSync(fontsDir)) {
    for (const file of readdirSync(new URL(`${folder}/`, fontsDir))) {
      assert.doesNotMatch(`${folder}/${file}`, /google/i);
    }
  }
  assert.equal(tokens.font.code.cssFamily, "Manual Code");
  for (const file of tokens.font.code.files) assert.doesNotMatch(file.src, /google/i);
});

test("every served font folder holds only the subsets the tokens name and their licence files", () => {
  const named = new Set(fonts.flatMap((font) => font.files.map((file) => file.src)));
  for (const [folder, { files }] of Object.entries(LICENCES)) {
    for (const file of readdirSync(new URL(`${folder}/`, fontsDir))) {
      assert.ok(files.includes(file) || named.has(`/fonts/${folder}/${file}`), `${folder}/${file} is unexpected`);
    }
  }
});
