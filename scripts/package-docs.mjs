// The docs checks for our packages (agent-SDK guide §10; SDK plan D8). Every TypeScript block in a package's README
// type-checks against the packages, and every export name the README documents is in the package's declaration files.
// Public unstable names carry `experimental_`. The package's llms.txt is built from the same README and declarations,
// so it can't describe another commit. Each package's scripts/docs-check.mjs configures these checks, and its
// test/docs-check.test.ts runs them under `pnpm test`.
//
// Everything here reads the working tree, never a branch or a published package, so the docs it checks and writes
// describe the commit they sit in. It runs the workspace's pinned TypeScript and needs no network and no build: the
// declarations come from `tsc --emitDeclarationOnly` into a temp folder, and README blocks resolve our packages
// through their `source` condition (ADR 0050), which points at the same src/ the declarations come from.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prose, slugify } from "./markdown-text.mjs";

export { prose, slugify };

// The root devDependency, resolved by package rather than by a node_modules/.bin path (AGENTS.md, "Tool paths").
const TSC = fileURLToPath(new URL("bin/tsc", import.meta.resolve("typescript/package.json")));
const TS_FENCES = new Set(["ts", "typescript"]);

/** The TypeScript fenced blocks of a Markdown text, each with the 1-based line of its opening fence. */
export function codeBlocks(markdown) {
  const lines = markdown.split("\n");
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(`{3,})(\S*)/.exec(lines[i]);
    if (!open) continue;
    const end = lines.findIndex((line, j) => j > i && line.startsWith(open[1]) && line.trim() === open[1]);
    const close = end === -1 ? lines.length : end;
    if (TS_FENCES.has(open[2].toLowerCase()))
      blocks.push({
        line: i + 1,
        code: lines
          .slice(i + 1, close)
          .join("\n")
          .replaceAll("\r", ""),
      });
    i = close;
  }
  return blocks;
}

// An inline code span that names an export: `name()`, a name that starts with a capital, such as `SdkError`,
// `SDKFoo` or `CAPABILITIES`, or an UPPER_SNAKE_CASE constant. Spans such as `maxSteps`, `run.steer()` or `done` are
// fields, members or values, which the export diff doesn't cover.
const EXPORT_SPAN = /`((?:[a-z_$][\w$]*\(\))|(?:[A-Z][A-Za-z0-9]+)|(?:[A-Z][A-Z0-9]*_[A-Z0-9_]+))`/g;
const IMPORT = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](@buildanagent\/[\w-]+(?:\/[\w/-]+)?)["']/g;

/**
 * The export names a README documents: the names its TypeScript blocks import from `@buildanagent/*`, with the module,
 * and the inline code spans in its prose that look like export names. Each comes with its 1-based line.
 */
export function documentedNames(markdown) {
  const imports = [];
  for (const block of codeBlocks(markdown)) {
    for (const match of block.code.matchAll(IMPORT)) {
      const line = block.line + 1 + block.code.slice(0, match.index).split("\n").length - 1;
      for (const name of specifierNames(match[1])) imports.push({ name, from: match[2], line });
    }
  }
  const spans = prose(markdown).flatMap((text, index) =>
    [...text.matchAll(EXPORT_SPAN)].map((match) => ({ name: match[1].replace(/\(\)$/, ""), line: index + 1 })),
  );
  return { imports, spans };
}

/** The exported names of an `export { … }` or `import { … }` list, aliases resolved to the name they export. */
function specifierNames(list) {
  return list
    .split(",")
    .map((item) => item.trim().replace(/^type\s+/, ""))
    .filter(Boolean)
    .map((item) => item.split(/\s+as\s+/).at(-1));
}

function specifiers(list) {
  return list
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const typeOnly = /^type\s/.test(item);
      const [local, exported = local] = item.replace(/^type\s+/, "").split(/\s+as\s+/);
      return { local, exported, typeOnly };
    });
}

/**
 * The entry points a package's `exports` map declares, each with the source file its `source` condition names:
 * `[{ specifier: "@buildanagent/sdk/testing", source: "src/testing/index.ts" }, …]`.
 */
export function entryPoints(packageDir) {
  const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  return Object.entries(manifest.exports).map(([key, conditions]) => ({
    specifier: key === "." ? manifest.name : `${manifest.name}${key.slice(1)}`,
    source: conditions.source.replace(/^\.\//, ""),
  }));
}

/** A scratch folder inside the package, so module resolution from it finds the package's own dependencies. */
function scratch(packageDir, prefix) {
  const parent = path.join(packageDir, ".tmp");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(path.join(parent, prefix));
}

// tsc is third-party code, so it gets an allowlisted environment, never ours with its tokens (AGENTS.md, "Running
// third-party code"). It reads no variables, and its HOME is a scratch folder.
function tscEnv(home) {
  return { PATH: process.env.PATH ?? "", HOME: home, TMPDIR: tmpdir(), LANG: process.env.LANG ?? "C.UTF-8" };
}

/**
 * Runs the pinned tsc and returns `{ ok, output }`: `ok` is true only when it exited 0, so a crash, a signal or a
 * spawn failure that prints no diagnostic still counts as a failure.
 */
function runTsc(args, cwd, tsc = TSC) {
  const home = mkdtempSync(path.join(tmpdir(), "package-docs-home-"));
  const options = { cwd, encoding: "utf8", stdio: "pipe", maxBuffer: 64e6, env: tscEnv(home) };
  try {
    execFileSync(process.execPath, [tsc, ...args], options);
    return { ok: true, output: "" };
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    return { ok: false, output: output === "" ? String(error.message ?? error) : output };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * Emits the package's declaration files with its own build settings into a temp folder and returns, for each entry
 * point, the names it exports: `{ name, kind, typeOnly, doc, from }`. `kind` is the declaration's keyword (`function`,
 * `const`, `class`, `interface`, `type` …), `doc` its TSDoc text, and `from` the package a re-export comes from when
 * that is not this one. Throws when tsc reports an error, so a broken build can't pass for an empty export list.
 */
export function declarationExports(packageDir) {
  const out = scratch(packageDir, "dts-");
  try {
    const args = ["-p", "tsconfig.build.json", "--emitDeclarationOnly", "--declarationMap", "false", "--outDir", out];
    // The build settings resolve sibling packages through their dist/ types; `source` reads their src/ instead, so
    // no build has to come first. The root stays the package's src/, so only its own files are emitted. A third-party
    // package can ship a `source` condition too: eventsource-parser, which `ai` reaches, points it at src/*.ts files
    // that import `.ts` specifiers, so those are allowed here as in agent-safety's tsconfig.json. The build config
    // still forbids them in our own files.
    const conditions = ["--customConditions", "source", "--allowImportingTsExtensions"];
    const emitted = runTsc([...args, ...conditions], packageDir);
    if (!emitted.ok) throw new Error(`tsc could not emit ${packageDir}'s declarations:\n${emitted.output}`);
    return entryPoints(packageDir).map(({ specifier, source }) => {
      const file = path.join(out, path.relative("src", source).replace(/\.ts$/, ".d.ts"));
      return { specifier, exports: exportsOf(file, new Set()) };
    });
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** The text of the TSDoc comment that ends right before `index`, or undefined when another statement comes between. */
function docBefore(text, index) {
  const before = text.slice(0, index).trimEnd();
  if (!before.endsWith("*/")) return undefined;
  const start = before.lastIndexOf("/**");
  if (start === -1) return undefined;
  return before
    .slice(start + 3, -2)
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
}

const DECLARATION =
  /^(?:export\s+)?(?:declare\s+)?(?:abstract\s+)?(const\s+enum|const|let|var|function|class|enum|namespace|interface|type)\s+([\w$]+)/gm;

/** Finds where `name` is declared, starting in `file` and following relative imports and re-exports. */
function declarationOf(file, name, seen) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(DECLARATION)) {
    if (match[2] === name) return { kind: match[1], doc: docBefore(text, match.index) };
  }
  for (const match of text.matchAll(/(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"([^"]+)"/g)) {
    // For `a as b`, `b` is the name in this file and `a` the name in the module it comes from.
    const found = specifiers(match[1]).find((item) => item.exported === name);
    if (found !== undefined) return followed(file, match[2], found.local, seen);
  }
  throw new Error(`no declaration of ${name} in ${file}`);
}

function followed(file, from, name, seen) {
  if (!from.startsWith(".")) return { kind: undefined, doc: undefined, from };
  const target = path.resolve(path.dirname(file), from.replace(/\.js$/, ".d.ts"));
  const key = `${target}#${name}`;
  if (seen.has(key)) throw new Error(`a re-export cycle reaches ${key}`);
  seen.add(key);
  return declarationOf(target, name, seen);
}

/** The names a declaration file exports, in source order, each resolved to its declaration. */
export function exportsOf(file, seen = new Set()) {
  const text = readFileSync(file, "utf8");
  if (/^export\s+\*/m.test(text)) throw new Error(`${file} uses export *, which the docs checks can't list`);
  if (/^export\s+default\b/m.test(text)) throw new Error(`${file} has a default export`);
  const found = [];
  for (const match of text.matchAll(/^export\s+(type\s+)?\{([^}]*)\}(?:\s*from\s*"([^"]+)")?\s*;/gm)) {
    for (const item of specifiers(match[2])) {
      const target =
        match[3] === undefined ? declarationOf(file, item.local, seen) : followed(file, match[3], item.local, seen);
      found.push({ name: item.exported, typeOnly: match[1] !== undefined || item.typeOnly, ...target });
    }
  }
  for (const match of text.matchAll(DECLARATION)) {
    if (!match[0].startsWith("export")) continue;
    const typeOnly = match[1] === "interface" || match[1] === "type";
    found.push({ name: match[2], kind: match[1], typeOnly, doc: docBefore(text, match.index) });
  }
  // Overloads and a class with a namespace of the same name declare one export more than once. The first declaration
  // that carries a doc comment stands for the name, because overloads often document only the first signature.
  const byName = new Map();
  for (const item of found) {
    const kept = byName.get(item.name);
    if (kept === undefined || (kept.doc === undefined && item.doc !== undefined)) byName.set(item.name, item);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Lists each public name whose stability marker and prefix disagree: a name whose TSDoc carries `@experimental` must
 * start with `experimental_`, and a name that starts with `experimental_` must carry `@experimental`.
 */
export function experimentalViolations(entries) {
  return entries.flatMap(({ specifier, exports }) =>
    exports.flatMap((item) => {
      const tagged = /(^|\s)@experimental\b/.test(item.doc ?? "");
      const prefixed = item.name.startsWith("experimental_");
      if (tagged === prefixed || item.from !== undefined) return [];
      const why = tagged
        ? "is marked @experimental but lacks the experimental_ prefix"
        : "has the experimental_ prefix but no @experimental tag";
      return [`${specifier}: ${item.name} ${why}`];
    }),
  );
}

/**
 * Lists each name the README documents that no declaration file exports. `entries` holds the entry points of every
 * package the README may name; an imported name must come from the entry point it is imported from, and a prose name
 * from any of them. `notExports` maps each prose name that is not ours, such as a method or a global, to the reason.
 */
export function missingNames({ documented, entries, notExports = {} }) {
  const bySpecifier = new Map(
    entries.map(({ specifier, exports }) => [specifier, new Set(exports.map((e) => e.name))]),
  );
  const all = new Set([...bySpecifier.values()].flatMap((names) => [...names]));
  const imports = documented.imports
    .filter(({ name, from }) => !(bySpecifier.get(from)?.has(name) ?? false))
    .map(({ name, from, line }) => `line ${line}: ${name} is imported from ${from}, which doesn't export it`);
  const spans = documented.spans
    .filter(({ name }) => !all.has(name) && !Object.hasOwn(notExports, name) && !(name in globalThis))
    .map(({ name, line }) => `line ${line}: \`${name}\` looks like an export, but no entry point exports it`);
  return [...imports, ...spans];
}

/**
 * Type-checks each block against the packages and returns the errors per block, with README line numbers. Each block
 * becomes a module of its own in a scratch folder inside the package, beside `globals`, a declaration file that
 * declares the names the README's blocks use without defining, such as `model` or `run`. A block's own imports and
 * declarations shadow those globals. A test passes its own `tsc` in place of the pinned compiler's entry script.
 */
export function typecheckBlocks({ packageDir, blocks, globals, tsc = TSC }) {
  const dir = scratch(packageDir, "readme-");
  try {
    const files = blocks.map((block) => {
      const name = `block-${block.line}.ts`;
      writeFileSync(path.join(dir, name), `${block.code}\nexport {};\n`);
      return name;
    });
    writeFileSync(path.join(dir, "globals.ts"), readFileSync(globals, "utf8"));
    // tsc reports only syntax errors while any file fails to parse, so a block that doesn't parse is reported on its
    // own and the rest are checked again without it.
    let output = "";
    let remaining = files;
    for (;;) {
      writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(blockConfig([...remaining, "globals.ts"])));
      const { ok, output: pass } = runTsc(["-p", "tsconfig.json", "--pretty", "false"], dir, tsc);
      // tsc exits non-zero on any diagnostic, so a failed run that reports none crashed instead of checking.
      if (!ok && !/error TS\d+:/.test(pass))
        throw new Error(`tsc failed without checking the README's blocks:\n${pass}`);
      const unparsed = new Set([...pass.matchAll(/^(block-\d+\.ts)\(\d+,\d+\): error TS1\d{3}:/gm)].map((m) => m[1]));
      const kept = pass.split("\n").filter((line) => unparsed.size === 0 || unparsed.has(line.split("(")[0]));
      output += `${kept.join("\n")}\n`;
      if (unparsed.size === 0) break;
      remaining = remaining.filter((file) => !unparsed.has(file));
    }
    return errorsByBlock(output, blocks);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// A user's settings, not ours: strict, ESM and Node, without the extra flags tsconfig.packages.json adds for our own
// code. `source` resolves our packages to their src/.
function blockConfig(files) {
  return {
    compilerOptions: {
      target: "es2024",
      lib: ["es2024"],
      module: "esnext",
      moduleResolution: "bundler",
      customConditions: ["source"],
      // A third-party `source` condition may lead to `.ts` specifiers, as in declarationExports().
      allowImportingTsExtensions: true,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      isolatedModules: true,
      types: ["node"],
    },
    files,
  };
}

function errorsByBlock(output, blocks) {
  const errors = new Map(blocks.map((block) => [block.line, []]));
  for (const match of output.matchAll(/^block-(\d+)\.ts\((\d+),(\d+)\): error (TS\d+): (.*)$/gm)) {
    const start = Number(match[1]);
    errors.get(start)?.push(`line ${start + Number(match[2])}: ${match[4]} ${match[5]}`);
  }
  const other = output.split("\n").filter((line) => /error TS/.test(line) && !/^block-\d+\.ts\(/.test(line));
  if (other.length > 0) throw new Error(`the README check's setup failed to type-check:\n${other.join("\n")}`);
  return blocks.map((block) => ({ line: block.line, errors: errors.get(block.line) ?? [] }));
}

/** The most lines a README block may hold without coming from a tested example (docs-writing guideline). */
const MAX_INLINE_LINES = 5;

/**
 * Lists each block of more than five lines that no TypeScript file under the package's examples/ holds word for word:
 * its lines must appear in one file, together and in order. The examples are tested, so a long block then shows code
 * that runs.
 */
export function blocksNotFromExamples(packageDir, blocks) {
  const dir = path.join(packageDir, "examples");
  const files = existsSync(dir)
    ? readdirSync(dir, { recursive: true })
        .filter((file) => String(file).endsWith(".ts"))
        .map((file) => `\n${readFileSync(path.join(dir, String(file)), "utf8").replaceAll("\r\n", "\n")}\n`)
    : [];
  return blocks
    .filter((block) => block.code.split("\n").length > MAX_INLINE_LINES)
    .filter((block) => !files.some((text) => text.includes(`\n${block.code}\n`)))
    .map(
      (block) =>
        `README block at line ${block.line}: over ${MAX_INLINE_LINES} lines, and no file in examples/ holds it`,
    );
}

/** GitHub's heading anchor: `slugify`'s slug (imported from `./markdown-text.mjs`), with `-1`, `-2` … for a repeat. */
export function headingAnchors(markdown) {
  const counts = new Map();
  return prose(markdown).flatMap((line) => {
    const match = /^(#{2,3})\s+(.*)$/.exec(line);
    if (!match) return [];
    const slug = slugify(match[2]);
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    return [{ depth: match[1].length, title: match[2], anchor: count === 0 ? slug : `${slug}-${count}` }];
  });
}

/** The first sentence of a TSDoc text, on one line, with its `@` tags left out. */
export function summaryOf(doc) {
  if (doc === undefined) return undefined;
  const body = doc
    .split(/\n\s*@/)[0]
    .replace(/\s+/g, " ")
    .trim();
  if (body === "") return undefined;
  return /^.*?[.!?](?=\s|$)/.exec(body)?.[0] ?? body;
}

function exportLine(item) {
  const label =
    item.kind === "function"
      ? `${item.name}()`
      : item.kind === "class" || item.kind === "interface" || item.kind === "type"
        ? `${item.kind} ${item.name}`
        : item.name;
  const note = item.from === undefined ? summaryOf(item.doc) : `re-exported from \`${item.from}\`.`;
  return `- \`${label}\`${note === undefined ? "" : `: ${note}`}`;
}

/**
 * Renders the package's llms.txt (llmstxt.org): its name, its description, an index of the README's sections, and
 * every public export of every entry point with the first sentence of its TSDoc. Links are relative to the package
 * folder, where npm ships README.md beside llms.txt, so the file names no branch and no version.
 */
export function renderLlmsTxt({ packageDir, readme, entries }) {
  const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
  const sections = headingAnchors(readme).map(
    ({ depth, title, anchor }) => `${depth === 3 ? "  " : ""}- [${title}](README.md#${anchor})`,
  );
  const exports = entries.flatMap(({ specifier, exports: list }) => [
    "",
    `## Exports from \`${specifier}\``,
    "",
    ...list.map(exportLine),
  ]);
  return [
    `# ${manifest.name}`,
    "",
    `> ${manifest.description}`,
    "",
    "The sections of README.md and every public export, generated from this package's README and declaration files " +
      "in the same commit as its code.",
    "",
    "## Docs",
    "",
    ...sections,
    ...exports,
    "",
  ].join("\n");
}

/**
 * Runs every check on one package and returns `{ problems, llms }`: the problems found, as lines, and the llms.txt the
 * package should have. `config` gives the README's globals file, the packages its prose may name, its
 * `notExports`, and `blocksFromExamples`, which requires every block of more than five lines to come from examples/.
 */
export function checkPackage(packageDir, config) {
  const readme = readFileSync(path.join(packageDir, "README.md"), "utf8");
  const own = declarationExports(packageDir);
  const others = (config.alsoNames ?? []).flatMap((dir) => declarationExports(path.resolve(packageDir, dir)));
  const readmeBlocks = codeBlocks(readme);
  const blocks = typecheckBlocks({ packageDir, blocks: readmeBlocks, globals: path.join(packageDir, config.globals) });
  const problems = [
    ...blocks.flatMap(({ line, errors }) => errors.map((error) => `README block at line ${line}: ${error}`)),
    ...missingNames({
      documented: documentedNames(readme),
      entries: [...own, ...others],
      notExports: config.notExports,
    }),
    ...experimentalViolations(own),
    ...(config.blocksFromExamples === true ? blocksNotFromExamples(packageDir, readmeBlocks) : []),
  ];
  return { problems, llms: renderLlmsTxt({ packageDir, readme, entries: own }), blocks: blocks.length };
}

/** The command line of a package's scripts/docs-check.mjs: checks, and with `--write` rewrites llms.txt first. */
export function main(packageDir, config, argv = process.argv.slice(2)) {
  const { problems, llms } = checkPackage(packageDir, config);
  const target = path.join(packageDir, "llms.txt");
  if (argv.includes("--write")) writeFileSync(target, llms);
  else if (!existsSync(target) || readFileSync(target, "utf8") !== llms) {
    problems.push("llms.txt is out of date: run this script with --write");
  }
  for (const problem of problems) console.error(problem);
  return problems.length === 0 ? 0 : 1;
}
