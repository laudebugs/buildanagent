// Skills: discovery from .agents/skills up to the repository root, the prompt section, and the skill_loaded entry.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createModel, type Model } from "@buildanagent/gateway";
import {
  memoryTrustStore,
  parseSkill,
  SKILL_DESCRIPTION_MAX,
  skillOfRead,
  skillsPrompt,
  withSkills,
} from "@buildanagent/harness/extensions";
import {
  type DiscoverSkillsOptions,
  discoverSkills,
  loadProjectExtensions,
} from "@buildanagent/harness/extensions/node";
import { createHarness } from "@buildanagent/harness/server";
import { openSession, runTurn, type SessionEntry } from "@buildanagent/harness/session";
import { createToolRegistry } from "@buildanagent/harness/tools";
import { defineTool } from "@buildanagent/sdk";
import { ScriptedModel } from "@buildanagent/sdk/testing";
import { afterAll, describe, test } from "vitest";
import { KEY, memoryBackend } from "../session/session-helpers.js";

const here = dirname(fileURLToPath(import.meta.url));
// This repository: packages/harness/test/extensions is four folders below the root.
const REPO = resolve(here, "../../../..");
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A temporary repository: a `.git` folder and the given files, with folders made as needed. */
function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "harness-skills-"));
  dirs.push(root);
  mkdirSync(join(root, ".git"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** Trusts every project, for the tests that are not about the trust gate. */
const OPEN = { trust: { isTrusted: async () => true, trust: async () => {} } } satisfies DiscoverSkillsOptions;

const skillFile = (name: string, description: string, body = "Body text."): string =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

describe("discoverSkills", () => {
  test("finds this repository's own skills from a package folder, each with a name, a description and an absolute path", async () => {
    const expected = readdirSync(join(REPO, ".agents/skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const { skills, records, notices } = await discoverSkills(join(REPO, "packages/harness"), OPEN);
    assert.deepEqual(skills.map((skill) => skill.name).sort(), expected);
    for (const skill of skills) {
      assert.ok(skill.description.length > 0 && skill.description.length <= SKILL_DESCRIPTION_MAX);
      assert.equal(skill.path, join(REPO, ".agents/skills", skill.name, "SKILL.md"));
    }
    assert.equal(records.length, skills.length);
    assert.ok(records.every((record) => record.tier === "skill" && /^sha256:[0-9a-f]{64}$/.test(record.contentHash)));
    assert.deepEqual(notices, []);
  });

  test("the system prompt lists each skill's three fields and none of its body", async () => {
    const { skills } = await discoverSkills(REPO, OPEN);
    const prompt = withSkills("You help.", skills);
    assert.ok(prompt.startsWith("You help.\n\n## Skills"));
    for (const skill of skills) {
      assert.ok(prompt.includes(`- ${skill.name}: ${skill.description}`));
      assert.ok(prompt.includes(`path: ${skill.path}`));
      // The first body line after the frontmatter, which is never in the three fields.
      const body = readFileSync(skill.path, "utf8")
        .split(/\r?\n---\r?\n/)
        .slice(1)
        .join("\n")
        .trim()
        .split("\n")
        .find((line) => line.trim() !== "");
      assert.ok(body !== undefined && !prompt.includes(body), `the body of ${skill.name} is not in the prompt`);
    }
  });

  test("with no skills the prompt is the system prompt alone", () => {
    assert.equal(withSkills("You help.", []), "You help.");
    assert.equal(skillsPrompt([]), "");
  });

  test("searches the working directory and every folder up to the repository root, nearest first", async () => {
    const root = repo({
      ".agents/skills/outer/SKILL.md": skillFile("outer", "Outer."),
      ".agents/skills/shared/SKILL.md": skillFile("shared", "From the root."),
      "pkg/app/.agents/skills/inner/SKILL.md": skillFile("inner", "Inner."),
      "pkg/app/.agents/skills/shared/SKILL.md": skillFile("shared", "From the app."),
    });
    const { skills, notices } = await discoverSkills(join(root, "pkg/app/src"), OPEN);
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["inner", "shared", "outer"],
    );
    assert.equal(skills.find((skill) => skill.name === "shared")?.description, "From the app.");
    assert.ok(notices.some((notice) => notice.includes('a nearer skill is already named "shared"')));
  });

  test("stops at the repository root, and a folder in no repository searches only itself", async () => {
    const outer = mkdtempSync(join(tmpdir(), "harness-skills-"));
    dirs.push(outer);
    mkdirSync(join(outer, ".agents/skills/above"), { recursive: true });
    writeFileSync(join(outer, ".agents/skills/above/SKILL.md"), skillFile("above", "Above the repository."));
    mkdirSync(join(outer, "work/.git"), { recursive: true });
    mkdirSync(join(outer, "work/.agents/skills/here"), { recursive: true });
    writeFileSync(join(outer, "work/.agents/skills/here/SKILL.md"), skillFile("here", "In the repository."));
    assert.deepEqual(
      (await discoverSkills(join(outer, "work"), OPEN)).skills.map((skill) => skill.name),
      ["here"],
    );
    // No `.git` anywhere up to the filesystem root, so only the folder itself counts.
    mkdirSync(join(outer, "loose/.agents/skills/own"), { recursive: true });
    writeFileSync(join(outer, "loose/.agents/skills/own/SKILL.md"), skillFile("own", "Own."));
    const found = await discoverSkills(join(outer, "loose"), OPEN);
    assert.ok(!found.skills.some((skill) => skill.name === "above"));
  });

  test("a bad file is skipped with a notice and the good skills still load", async () => {
    const root = repo({
      ".agents/skills/good/SKILL.md": skillFile("good", "Good."),
      ".agents/skills/nofront/SKILL.md": "No frontmatter here.\n",
      ".agents/skills/Bad_Name/SKILL.md": skillFile("Bad_Name", "Bad name."),
    });
    const { skills, notices } = await discoverSkills(root, OPEN);
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["good"],
    );
    assert.equal(notices.length, 2);
  });

  test("a record hashes the file's bytes as stored, not the text they decode to", async () => {
    const root = repo({});
    // 0xFF is never valid UTF-8, so the decoded text holds U+FFFD and hashing the text would give another digest.
    const bytes = Buffer.concat([Buffer.from(skillFile("raw", "Raw bytes.")), Buffer.from([0xff, 0x0a])]);
    mkdirSync(join(root, ".agents/skills/raw"), { recursive: true });
    writeFileSync(join(root, ".agents/skills/raw/SKILL.md"), bytes);
    const { records } = await discoverSkills(root, OPEN);
    assert.equal(records[0]?.contentHash, `sha256:${createHash("sha256").update(bytes).digest("hex")}`);
  });

  test("a SKILL.md past 256 KiB is skipped with a notice, so no record hashes half a file", async () => {
    const root = repo({
      ".agents/skills/big/SKILL.md": skillFile("big", "Big.", "b".repeat(256 * 1024)),
      ".agents/skills/small/SKILL.md": skillFile("small", "Small."),
    });
    const { skills, notices } = await discoverSkills(root, OPEN);
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["small"],
    );
    assert.ok(notices.some((notice) => notice.includes("big/SKILL.md is longer than 262144 bytes")));
  });

  test("a SKILL.md that is a link out of the project is skipped", async () => {
    const root = repo({ ".agents/skills/real/SKILL.md": skillFile("real", "Real.") });
    const outside = mkdtempSync(join(tmpdir(), "harness-outside-"));
    dirs.push(outside);
    writeFileSync(join(outside, "SKILL.md"), skillFile("stolen", "Outside the project."));
    mkdirSync(join(root, ".agents/skills/stolen"));
    symlinkSync(join(outside, "SKILL.md"), join(root, ".agents/skills/stolen/SKILL.md"));
    const { skills, notices } = await discoverSkills(root, OPEN);
    assert.deepEqual(
      skills.map((skill) => skill.name),
      ["real"],
    );
    assert.ok(notices.some((notice) => notice.includes("outside")));
  });

  test("the trust gate skips an untrusted or headless project's skills and a trusted one's load", async () => {
    const root = repo({ ".agents/skills/a/SKILL.md": skillFile("a", "A.") });
    const trust = memoryTrustStore();
    const untrusted = await discoverSkills(root, { trust, headless: false });
    assert.deepEqual(untrusted.skills, []);
    assert.ok(untrusted.notices[0]?.includes("not trusted"));
    await trust.trust(root);
    assert.equal((await discoverSkills(root, { trust, headless: false })).skills.length, 1);
    const headless = await discoverSkills(root, { trust, headless: true });
    assert.deepEqual(headless.skills, []);
    assert.ok(headless.notices[0]?.includes("headless"));
    assert.equal((await discoverSkills(root, { trust, headless: true, loadInHeadless: true })).skills.length, 1);
  });

  test("a trust store is required: without one the call does not type-check", async () => {
    const root = repo({ ".agents/skills/a/SKILL.md": skillFile("a", "A.") });
    // @ts-expect-error `trust` is required, so an untrusted checkout cannot list its skills by omission.
    const call = () => discoverSkills(root);
    // @ts-expect-error the same with an options object that leaves it out.
    const withoutTrust = () => discoverSkills(root, { headless: false });
    assert.equal(typeof call, "function");
    assert.equal(typeof withoutTrust, "function");
  });

  test("a project reached through a link is trusted under the path as the host wrote it, for skills and extensions alike", async () => {
    const real = repo({
      ".agents/skills/a/SKILL.md": skillFile("a", "A."),
      ".agents/extensions/demo/index.mjs": 'export default { name: "demo", version: "1.0.0" };\n',
    });
    const holder = mkdtempSync(join(tmpdir(), "harness-link-"));
    dirs.push(holder);
    const linked = join(holder, "proj");
    symlinkSync(real, linked);
    const trust = memoryTrustStore([linked]);
    const skills = await discoverSkills(linked, { trust });
    assert.deepEqual(
      skills.skills.map((skill) => skill.name),
      ["a"],
    );
    const extensions = await loadProjectExtensions(linked, { trust, headless: false });
    assert.deepEqual(
      extensions.extensions.map((extension) => extension.name),
      ["demo"],
    );
    // The real path still counts, as the file trust store has always compared.
    assert.equal((await discoverSkills(linked, { trust: memoryTrustStore([realpathSync(real)]) })).skills.length, 1);
    assert.deepEqual((await discoverSkills(linked, { trust: memoryTrustStore([holder]) })).skills, []);
  });
});

describe("parseSkill", () => {
  const path = "/p/.agents/skills/demo/SKILL.md";
  const parse = (text: string) => parseSkill(text, path);

  test("reads quoted values and a folded block", () => {
    const quoted = parse(`---\nname: "demo"\ndescription: 'Use when asked.'\n---\n`);
    assert.ok("skill" in quoted && quoted.skill.description === "Use when asked.");
    const folded = parse("---\nname: demo\ndescription: >\n  Use when\n  asked.\nlicense: MIT\n---\n");
    assert.ok("skill" in folded && folded.skill.description === "Use when asked.");
  });

  test("applies Pi's limits: a name past 64 characters or with a bad shape, and a description past 1,024", () => {
    for (const name of ["a".repeat(65), "Upper", "-lead", "trail-", "dou--ble", "has space"]) {
      assert.ok("problem" in parse(`---\nname: ${name}\ndescription: ok\n---\n`), name);
    }
    assert.ok("skill" in parse(`---\nname: ${"a".repeat(64)}\ndescription: ${"d".repeat(1024)}\n---\n`));
    assert.ok("problem" in parse(`---\nname: demo\ndescription: ${"d".repeat(1025)}\n---\n`));
  });

  test("a missing name, a missing description or no frontmatter is not a skill", () => {
    assert.ok("problem" in parse("---\ndescription: x\n---\n"));
    assert.ok("problem" in parse("---\nname: demo\n---\n"));
    assert.ok("problem" in parse("# Just a heading\n"));
    assert.ok("problem" in parse("---\nname: demo\ndescription: x\n"));
  });

  test("a name that differs from its folder loads with a notice", () => {
    const parsed = parse("---\nname: other\ndescription: x\n---\n");
    assert.ok("skill" in parsed && parsed.notice?.includes('"demo"'));
  });
});

describe("skillOfRead", () => {
  const skills = [{ name: "demo", description: "d", path: "/work/.agents/skills/demo/SKILL.md" }];
  test("matches the skill's own SKILL.md by absolute or relative path, and nothing else", () => {
    assert.equal(skillOfRead(skills, "/work", { path: "/work/.agents/skills/demo/SKILL.md" })?.name, "demo");
    assert.equal(skillOfRead(skills, "/work", { path: ".agents/skills/demo/./SKILL.md" })?.name, "demo");
    assert.equal(skillOfRead(skills, "/work/src", { file_path: "../.agents/skills/demo/SKILL.md" })?.name, "demo");
    assert.equal(skillOfRead(skills, "/work", { path: ".agents/skills/demo/reference.md" }), undefined);
    assert.equal(skillOfRead(skills, "/work", { path: 3 }), undefined);
    assert.equal(skillOfRead(skills, "/work", undefined), undefined);
  });
});

describe("the skill_loaded entry", () => {
  async function run(readInputs: unknown[], files: Record<string, string>, failRead = false) {
    const root = repo(files);
    const { skills } = await discoverSkills(root, OPEN);
    const registry = createToolRegistry();
    registry.register({
      source: "builtin",
      name: "read",
      definition: defineTool({
        name: "read",
        description: "Reads a file.",
        inputSchema: { type: "object", properties: { path: { type: "string" } } },
        async execute() {
          return { content: [{ type: "text", text: "file text" }], ...(failRead ? { isError: true } : {}) };
        },
      }) as never,
    });
    const adapter = new ScriptedModel([
      ...readInputs.map((input, i) => ({
        usage: {},
        content: [{ type: "tool_call" as const, callId: `c${i}`, name: "read", input }],
      })),
      { usage: {}, content: [{ type: "text" as const, text: "Done." }] },
    ]);
    const harness = createHarness({
      registry,
      model: createModel({ adapter, id: "m", retries: 0 }) as Model,
      system: withSkills("You help.", skills),
      skills,
      env: { cwd: root },
    });
    const backend = memoryBackend();
    const session = await openSession({ store: backend.store, index: backend.index, lock: backend.lock, key: KEY });
    await runTurn(session, harness, { input: "Go" });
    const entries: SessionEntry[] = [];
    for await (const entry of backend.store.load(KEY)) entries.push(entry);
    return { entries, adapter, root };
  }
  const files = {
    ".agents/skills/demo/SKILL.md": skillFile("demo", "Use for demos."),
    ".agents/skills/demo/reference.md": "Reference.",
    "README.md": "Readme.",
  };

  test("the system prompt of the first request lists the skill and the body stays in the file", async () => {
    const { adapter, root } = await run([], files);
    const system = adapter.calls[0]?.context.system ?? "";
    assert.ok(system.includes("- demo: Use for demos."));
    assert.ok(system.includes(`path: ${join(root, ".agents/skills/demo/SKILL.md")}`));
    assert.ok(!system.includes("Body text."));
  });

  test("reading a SKILL.md writes one skill_loaded entry, right after the read's result", async () => {
    const { entries, root } = await run([{ path: ".agents/skills/demo/SKILL.md" }], files);
    const loaded = entries.filter((entry) => entry.type === "skill_loaded");
    assert.equal(loaded.length, 1);
    const [entry] = loaded;
    assert.ok(entry?.type === "skill_loaded");
    assert.equal(entry.name, "demo");
    assert.equal(entry.path, join(root, ".agents/skills/demo/SKILL.md"));
    assert.equal(entry.origin, "harness");
    const before = entries[entries.indexOf(entry) - 1];
    assert.ok(before?.type === "tool_result" && before.tool === "read");
  });

  test("a read of another file, of a skill's reference file or one that failed writes none", async () => {
    assert.equal(
      (await run([{ path: "README.md" }, { path: ".agents/skills/demo/reference.md" }], files)).entries.filter(
        (e) => e.type === "skill_loaded",
      ).length,
      0,
    );
    assert.equal(
      (await run([{ path: ".agents/skills/demo/SKILL.md" }], files, true)).entries.filter(
        (e) => e.type === "skill_loaded",
      ).length,
      0,
    );
  });

  test("each read is a load: two reads write two entries", async () => {
    const two = await run(
      [{ path: ".agents/skills/demo/SKILL.md" }, { path: `${"."}/.agents/skills/demo/SKILL.md` }],
      files,
    );
    assert.equal(two.entries.filter((entry) => entry.type === "skill_loaded").length, 2);
  });
});
