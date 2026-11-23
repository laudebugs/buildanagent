import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "vitest";
import { readTokens } from "../src/design/tokens.js";
import { woff2Names } from "../src/design/woff2.js";

const publicDir = new URL("../public/", import.meta.url);
const fontsDir = new URL("fonts/", publicDir);

interface Family {
  upstream: string;
  folder: string;
  neutralName: string | null;
  fonts: { upstream: string; served: string }[];
  licences: string[];
}

// fonts/sources.json is the one list of families, files and served names; the scripts read it too.
const sources = JSON.parse(readFileSync(new URL("../fonts/sources.json", import.meta.url), "utf8")) as {
  commit: string;
  families: Family[];
  files: { path: string; sha256: string }[];
};
const tokens = readTokens();
// The book's own fonts and the faces only the reader's pairings use (font.reading.faces).
const fonts = [tokens.font.display, tokens.font.body, tokens.font.code, ...Object.values(tokens.font.reading.faces)];

function sha256(url: URL): string {
  return createHash("sha256").update(readFileSync(url)).digest("hex");
}

function names(family: Family, served: string): Map<number, string> {
  return woff2Names(readFileSync(new URL(`${family.folder}/${served}`, fontsDir)));
}

test("every font file the tokens name is a WOFF2 file the site serves", () => {
  for (const font of fonts) {
    for (const file of font.files) {
      const bytes = readFileSync(new URL(`.${file.src}`, publicDir));
      assert.equal(bytes.subarray(0, 4).toString("latin1"), "wOF2", `${file.src} is WOFF2`);
    }
  }
});

test("each font folder ships its upstream licence files, byte for byte, from the recorded google/fonts commit", () => {
  assert.match(sources.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual(readdirSync(fontsDir).sort(), sources.families.map((family) => family.folder).sort());
  for (const family of sources.families) {
    assert.ok(family.licences.includes("OFL.txt"), `${family.folder} ships OFL.txt`);
    for (const file of family.licences) {
      const recorded = sources.files.find((entry) => entry.path === `${family.upstream}/${file}`);
      assert.ok(recorded, `fonts/sources.json records ${family.upstream}/${file}`);
      assert.equal(sha256(new URL(`${family.folder}/${file}`, fontsDir)), recorded.sha256, `${family.folder}/${file}`);
    }
  }
});

test("every served font folder holds exactly the subsets the tokens name and their licence files", () => {
  const named = fonts.flatMap((font) => font.files.map((file) => file.src)).sort();
  const listed = sources.families.flatMap((family) =>
    family.fonts.map((font) => `/fonts/${family.folder}/${font.served}`),
  );
  assert.deepEqual(listed.sort(), named, "fonts/sources.json and book-tokens.json name the same files");
  for (const family of sources.families) {
    const expected = [...family.fonts.map((font) => font.served), ...family.licences].sort();
    assert.deepEqual(readdirSync(new URL(`${family.folder}/`, fontsDir)).sort(), expected);
  }
});

test("the subsets derived from Google Sans Code carry a neutral name in their files and name tables", () => {
  const code = sources.families.find((family) => family.upstream === "googlesanscode");
  assert.ok(code?.neutralName, "Google Sans Code has a neutral name");
  assert.equal(tokens.font.code.cssFamily, code.neutralName);
  assert.doesNotMatch([code.folder, ...code.fonts.map((font) => font.served)].join(" "), /google/i);
  for (const font of code.fonts) {
    const records = names(code, font.served);
    assert.equal(records.get(1), code.neutralName, `${font.served}: family name`);
    // The records that identify the font: family, unique, full and PostScript names, and the instance names.
    for (const [id, text] of records) {
      if ([1, 3, 4, 6, 16, 18, 21, 25].includes(id) || id >= 256) {
        assert.doesNotMatch(text, /google/i, `${font.served}: name ${id} reads ${text}`);
      }
    }
  }
});

test("the Google Sans Code subsets drop the manufacturer records and keep the copyright and licence", () => {
  const code = sources.families.find((family) => family.upstream === "googlesanscode");
  assert.ok(code);
  for (const font of code.fonts) {
    const records = names(code, font.served);
    assert.equal(records.has(8), false, `${font.served} keeps the manufacturer record`);
    assert.equal(records.has(11), false, `${font.served} keeps the vendor URL record`);
    assert.match(records.get(0) ?? "", /Google Sans Code Project Authors/);
    assert.match(records.get(13) ?? "", /SIL Open Font License/);
  }
});

// A variable font's name 1 can name its default instance ("Bitter Thin"), so the typographic family, name 16, wins
// where the font has one.
test("every family but Manual Code keeps its own upstream name, which no OFL reserves", () => {
  for (const family of sources.families.filter((entry) => entry.neutralName === null)) {
    const token = fonts.find((font) => font.files.some((file) => file.src.startsWith(`/fonts/${family.folder}/`)));
    for (const font of family.fonts) {
      const records = names(family, font.served);
      assert.equal((records.get(16) ?? records.get(1))?.replace(/ Italic$/, ""), token?.cssFamily, font.served);
    }
  }
});

// A Reserved Font Name keeps a modified version, such as a subset, from using that name. Only Bitter's OFL reserves one,
// "Bitter Pro", which the served family, "Bitter", is not; the name appears in the subsets only inside the copyright
// notice's URL, which the OFL requires them to keep.
test("only Bitter's licence reserves a font name, Bitter Pro, and no served subset is named with it", () => {
  const reserved = sources.families.flatMap((family) => {
    const header = readFileSync(new URL(`${family.folder}/OFL.txt`, fontsDir), "utf8").split("PREAMBLE")[0] ?? "";
    return [...header.matchAll(/Reserved Font Names? "([^"]+)"/g)].map((match) => ({ family, name: match[1] ?? "" }));
  });
  assert.deepEqual(
    reserved.map(({ family, name }) => [family.folder, name]),
    [["bitter", "Bitter Pro"]],
  );
  for (const { family, name } of reserved) {
    for (const font of family.fonts) {
      for (const [id, text] of names(family, font.served)) {
        if (id === 0) continue;
        assert.doesNotMatch(
          text,
          new RegExp(`${name.replace(" ", " ?")}\\b`),
          `${font.served}: name ${id} reads ${text}`,
        );
      }
    }
  }
});
