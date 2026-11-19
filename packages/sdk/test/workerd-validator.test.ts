import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { convertV4MiniflareOptions, Log, LogLevel, Miniflare, type V4MiniflareOptions } from "miniflare";
import { afterAll, beforeAll, test } from "vitest";

// Cloudflare Workers forbid `eval` and `new Function`, so a validator that generates code fails there. This test
// loads pi-schema, the SDK's validator, inside workerd and checks a schema with it.
const COMPATIBILITY_DATE = "2026-11-03"; // the pinned workerd's release date

// The entry may resolve through pi-schema's `source` condition to a src/ file it doesn't ship, so the built files
// are found beside it, in the package's own dist/.
function piSchemaDist(): string {
  return fileURLToPath(new URL("../dist/", import.meta.resolve("@earendil-works/pi-schema")));
}

function jsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith(".js") ? [path] : [];
  });
}

const WORKER = `
import { compile } from "./pi-schema/index.js";
import { formats } from "./pi-schema/formats/index.js";
const schema = { type: "object", properties: { order: { type: "integer" }, email: { type: "string", format: "email" } },
  required: ["order"], additionalProperties: false };
function evalBlocked() {
  try {
    new Function("return 1")();
    return false;
  } catch {
    return true;
  }
}
export default {
  async fetch() {
    const validator = compile(schema, { formats });
    const errors = validator.errors({ order: "x", email: "no" });
    return Response.json({ evalBlocked: evalBlocked(), valid: validator.check({ order: 1 }), errors });
  },
};
`;

let mf: Miniflare;

beforeAll(async () => {
  const dist = piSchemaDist();
  const modules = jsFiles(dist).map((file) => ({
    type: "ESModule" as const,
    path: join("/worker/pi-schema", relative(dist, file)),
    contents: readFileSync(file, "utf8"),
  }));
  // Miniflare 5 takes a new options shape; the converter accepts the documented version 4 shape.
  const options: V4MiniflareOptions = {
    log: new Log(LogLevel.WARN),
    workers: [
      {
        name: "validator",
        compatibilityDate: COMPATIBILITY_DATE,
        modulesRoot: "/worker",
        modules: [{ type: "ESModule", path: "/worker/worker.js", contents: WORKER }, ...modules],
      },
    ],
  };
  mf = new Miniflare(convertV4MiniflareOptions(options));
  await mf.ready;
}, 60_000);

afterAll(async () => {
  await mf?.dispose();
});

test("pi-schema compiles a schema and reports JSON Pointer errors inside workerd", async () => {
  const response = await mf.dispatchFetch("http://localhost/");
  assert.deepEqual(await response.json(), {
    evalBlocked: true,
    valid: true,
    errors: [
      { path: "/order", keyword: "type", message: "expected integer, got string" },
      { path: "/email", keyword: "format", message: "expected format email" },
    ],
  });
});
