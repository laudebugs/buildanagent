import { existsSync, readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { extname, join } from "node:path";
import type ts from "typescript-api";
import type { WrittenChapter } from "./book-index.js";
import type { ListingSource } from "./listings.js";
import { type LibraryScope, nearestTsconfig, StandardLibraries } from "./standard-library.js";
import { readTranscript, type Transcript, type TranscriptMessage } from "./transcripts.js";
import { typescript } from "./typescript.js";

// The workspace pins typescript 7.0.2, whose package exports no stable compiler API: only its version and
// `./unstable/*`, a client that drives the native compiler in a child process. The inline-code check therefore reads
// code with typescript 6.0.3, installed as `typescript-api`, whose compiler API is the stable one and runs in this
// process. It only parses listed files and lists the exports of `.d.ts` files; `tsc` 7.0.2 still type-checks every
// listed file. Our choice; switch once typescript 7 ships a stable API.

/**
 * The options the check reads code with, after the workspace's `tsconfig.base.json`: ES modules resolved as a bundler
 * does. `noLib` and an empty `types` keep the standard library and `@types` out, because only a package's own exports
 * count, and they keep each program small.
 */
function compilerOptions(): ts.CompilerOptions {
  const ts = typescript();
  return {
    target: ts.ScriptTarget.ES2024,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    noEmit: true,
    noLib: true,
    skipLibCheck: true,
    types: [],
  };
}

/**
 * The scope of our own workspace packages. Their `package.json` points `types` at a `dist/` that exists only after a
 * build, so the check reads them through their `source` condition, as their tests and type-checks do (ADR 0050). Only
 * our scope gets the condition: a third-party package may declare `source` for files its tarball leaves out.
 */
const WORKSPACE_SCOPE = "@buildanagent/";

/** The compiler options for a specifier or an entry: the shared ones, plus `source` for our own packages. */
const withSource = (options: ts.CompilerOptions): ts.CompilerOptions => ({ ...options, customConditions: ["source"] });

/** The extensions a resolved import may have for its exports to be read: declarations, or TypeScript source. */
const TYPED = new Set([".d.ts", ".d.mts", ".d.cts", ".ts", ".mts", ".cts", ".tsx"]);

/**
 * One place a chapter's inline code may resolve to, and the names found there. The label names it in a failure
 * message: a listing's path and region, a transcript's path, or a package import and its version, such as
 * `ai@7.0.162` or `ai/test from ai@7.0.162`.
 */
export interface NameSource {
  readonly label: string;
  readonly names: ReadonlySet<string>;
}

/**
 * Three of the places a chapter's inline code resolves to: its listings, their transcripts and their packages. The
 * fourth, the standard library, is read only for a name these three lack (`libraries`).
 */
export interface ChapterNames {
  readonly listings: readonly NameSource[];
  readonly transcripts: readonly NameSource[];
  readonly packages: readonly NameSource[];
}

/** Whether a name is in a chapter's listings, their transcripts or their packages; the library is checked apart. */
export const hasName = (names: ChapterNames, name: string): boolean =>
  [...names.listings, ...names.transcripts, ...names.packages].some((source) => source.names.has(name));

/** The values a transcript records that prose may name: tool names, roles, stop reasons and check messages. */
export function transcriptValues(transcript: Transcript): Set<string> {
  const values = new Set<string>();
  const addMessage = (message: TranscriptMessage) => {
    values.add(message.role);
    for (const part of message.parts)
      if (part.type === "tool-call" || part.type === "tool-result") values.add(part.name);
  };
  for (const event of transcript.events) {
    if (event.kind === "check") values.add(event.message);
    else if (event.kind === "response") {
      addMessage(event.message);
      values.add(event.finish);
    } else {
      for (const tool of event.tools) values.add(tool);
      for (const message of event.messages) addMessage(message);
    }
  }
  return values;
}

/**
 * The names and string values of the code a listing shows, read with the compiler from the real file: every
 * identifier, property names included, every keyword, such as `async` or `string`, and every string or template
 * literal's text, whose node starts on a line the listing shows. Comments are not code, so a name only a comment
 * holds does not count.
 */
export function listedNames(file: ts.SourceFile, shown: ReadonlySet<number>): Set<string> {
  const ts = typescript();
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    if (shown.has(line)) {
      if (ts.isIdentifier(node)) names.add(node.text);
      else if (node.kind >= ts.SyntaxKind.FirstKeyword && node.kind <= ts.SyntaxKind.LastKeyword) {
        names.add(ts.tokenToString(node.kind) ?? "");
      } else if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        names.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/**
 * The package imports of a file: each `import … from` and `export … from` that names neither a path nor a Node
 * built-in.
 */
export function packageImports(file: ts.SourceFile): string[] {
  const ts = typescript();
  const specifiers = new Set<string>();
  for (const statement of file.statements) {
    const specifier =
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier !== undefined &&
      ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined;
    if (specifier === undefined || /^[./]/.test(specifier) || isBuiltin(specifier)) continue;
    specifiers.add(specifier);
  }
  return [...specifiers];
}

/**
 * What the inline-code check reads, cached for one book load, so a chapter with many spans parses each listed file,
 * reads each transcript and lists each package's exports once. The book creates one with every load; each chapter's
 * names are worked out the first time one of its spans needs them.
 */
export class CodeNames {
  readonly #repoRoot: string;
  readonly #files = new Map<string, ts.SourceFile>();
  readonly #exports = new Map<string, ReadonlySet<string> | undefined>();
  readonly #resolved = new Map<string, { readonly label: string; readonly entry: string } | string>();
  readonly #chapters = new Map<string, ChapterNames | string>();
  readonly #declarations = new Map<string, ts.SourceFile | undefined>();
  #options: ts.CompilerOptions | undefined;
  #host: ts.CompilerHost | undefined;

  readonly #libraries: StandardLibraries;
  readonly #chapterLibraries = new Map<string, readonly LibraryScope[]>();

  constructor(repoRoot: string) {
    this.#repoRoot = repoRoot;
    this.#libraries = new StandardLibraries(repoRoot);
  }

  /**
   * The standard libraries a written chapter's inline code may resolve to: one for each tsconfig that compiles its
   * file listings, the nearest above each listed file. Read on first use, because a library and its `@types` take
   * the longest to read, and a chapter needs them only for a name the other places lack.
   */
  libraries(written: WrittenChapter): readonly LibraryScope[] {
    let scopes = this.#chapterLibraries.get(written.file);
    if (scopes === undefined) {
      const configs = new Set<string | undefined>();
      for (const { source } of written.blocks) {
        if (source !== undefined) configs.add(nearestTsconfig(join(this.#repoRoot, source.path), this.#repoRoot));
      }
      scopes = [...configs].map((config) => this.#libraries.scope(config));
      this.#chapterLibraries.set(written.file, scopes);
    }
    return scopes;
  }

  /** The check's compiler options, made on first use, so a load that checks no inline code never loads the compiler. */
  get #compilerOptions(): ts.CompilerOptions {
    this.#options ??= compilerOptions();
    return this.#options;
  }

  /**
   * One host for every program of this load, sharing each declaration file it parses: packages re-export from the
   * same files, so one parse serves every package that reaches it.
   */
  get #compilerHost(): ts.CompilerHost {
    if (this.#host === undefined) {
      const host = typescript().createCompilerHost(this.#compilerOptions);
      const read = host.getSourceFile.bind(host);
      host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
        if (!this.#declarations.has(fileName)) {
          this.#declarations.set(fileName, read(fileName, languageVersion, onError, shouldCreate));
        }
        return this.#declarations.get(fileName);
      };
      this.#host = host;
    }
    return this.#host;
  }

  /**
   * The names a written chapter's inline code may resolve to, from the file listings it includes, or why one listing's
   * import cannot be read.
   */
  chapter(written: WrittenChapter): ChapterNames | string {
    const cached = this.#chapters.get(written.file);
    if (cached !== undefined) return cached;
    const found = this.#chapterNames(written);
    this.#chapters.set(written.file, found);
    return found;
  }

  /**
   * The package imports of every file listing in the book, each as its label or the reason it cannot be read, for
   * the render dependencies: a new version of a package a listing imports changes what its inline code resolves to.
   */
  packageLabels(written: Iterable<WrittenChapter>): string[] {
    const labels = new Set<string>();
    for (const chapter of written) {
      for (const { source } of chapter.blocks) {
        if (source === undefined) continue;
        for (const specifier of packageImports(this.#sourceFile(source.path))) {
          const found = this.#resolve(source, specifier);
          labels.add(typeof found === "string" ? found : found.label);
        }
      }
    }
    return [...labels].sort();
  }

  /**
   * The source files of our own packages, for the render inputs, when a listing's import resolves into one of them.
   * Their label is `name@version`, which an edit to their source leaves unchanged, so the files themselves must be
   * hashed: our packages re-export one another, so every package's `src/` counts.
   */
  workspaceSources(written: Iterable<WrittenChapter>): string[] {
    const packagesDir = join(this.#repoRoot, "packages");
    let reached = false;
    for (const chapter of written) {
      for (const { source } of chapter.blocks) {
        if (source === undefined || reached) continue;
        for (const specifier of packageImports(this.#sourceFile(source.path))) {
          const found = this.#resolve(source, specifier);
          if (typeof found !== "string" && found.entry.startsWith(`${packagesDir}/`)) reached = true;
        }
      }
    }
    if (!reached || !existsSync(packagesDir)) return [];
    const files: string[] = [];
    for (const name of readdirSync(packagesDir).sort()) {
      const src = join(packagesDir, name, "src");
      if (!existsSync(src)) continue;
      for (const file of readdirSync(src, { recursive: true, encoding: "utf8" }).sort()) {
        if (file.endsWith(".ts")) files.push(join(src, file));
      }
    }
    return files;
  }

  #chapterNames(written: WrittenChapter): ChapterNames | string {
    const listings: NameSource[] = [];
    const transcripts = new Map<string, NameSource>();
    const packages = new Map<string, NameSource>();
    for (const { source } of written.blocks) {
      if (source === undefined) continue;
      const file = this.#sourceFile(source.path);
      const where = source.region === undefined ? source.path : `${source.path}#${source.region}`;
      listings.push({ label: where, names: listedNames(file, new Set(source.lines.map((line) => line.number))) });
      const transcript = this.#transcript(source);
      if (transcript !== undefined) transcripts.set(transcript.label, transcript);
      for (const specifier of packageImports(file)) {
        const exported = this.#packageExports(source, specifier);
        if (typeof exported === "string") return exported;
        packages.set(exported.label, exported);
      }
    }
    return { listings, transcripts: [...transcripts.values()], packages: [...packages.values()] };
  }

  /** The listed file, parsed once per load, whole, so a region cut from inside a block still parses. */
  #sourceFile(path: string): ts.SourceFile {
    let file = this.#files.get(path);
    if (file === undefined) {
      const text = readFileSync(join(this.#repoRoot, path), "utf8");
      const ts = typescript();
      const kind = extname(path) === ".tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
      file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, kind);
      this.#files.set(path, file);
    }
    return file;
  }

  /**
   * The values of the listed example's transcript: the one its replay shows, or else the one its harness recorded
   * for the file at the current pin. A transcript that is missing, malformed or stale offers nothing; a listing with
   * `replay` has already failed on it.
   */
  #transcript(source: ListingSource): NameSource | undefined {
    if (source.replay !== undefined) {
      return { label: source.replay.path, names: transcriptValues(source.replay.transcript) };
    }
    const read = readTranscript(this.#repoRoot, source);
    return "message" in read ? undefined : { label: read.transcriptPath, names: transcriptValues(read.transcript) };
  }

  /**
   * The exports of a package a listing imports, resolved by the compiler from the listed file, so the harness's own
   * `node_modules` and the package's `exports` map decide which `.d.ts` is read. The checker lists the module's
   * exports after every `export *` and `export { … } from`, across packages too.
   */
  #packageExports(source: ListingSource, specifier: string): NameSource | string {
    const resolved = this.#resolve(source, specifier);
    if (typeof resolved === "string") return resolved;
    const names = this.#exportsOf(resolved.entry);
    if (names === undefined) {
      return (
        `${source.path} imports ${specifier}, whose .d.ts (${resolved.label}) declares no module whose exports can ` +
        "be listed, as when a package only declares its module ambiently, with declare module"
      );
    }
    return { label: resolved.label, names };
  }

  /** The `.d.ts` entry a package import resolves to from the listed file, and its label, or why it has none. */
  #resolve(source: ListingSource, specifier: string): { readonly label: string; readonly entry: string } | string {
    const key = `${source.harness}\0${specifier}`;
    let found = this.#resolved.get(key);
    if (found === undefined) {
      const listed = join(this.#repoRoot, source.path);
      const ts = typescript();
      const options = specifier.startsWith(WORKSPACE_SCOPE) ? withSource(this.#compilerOptions) : this.#compilerOptions;
      const resolved = ts.resolveModuleName(specifier, listed, options, ts.sys).resolvedModule;
      if (resolved === undefined || !TYPED.has(resolved.extension)) {
        found =
          `${source.path} imports ${specifier}, whose .d.ts cannot be found from ${source.harness}; ` +
          `run pnpm install, or check that ${specifier} ships its types`;
      } else {
        const id = resolved.packageId;
        const version = id === undefined ? specifier : `${id.name}@${id.version}`;
        const label = id === undefined || id.name === specifier ? version : `${specifier} from ${version}`;
        found = { label, entry: resolved.resolvedFileName };
      }
      this.#resolved.set(key, found);
    }
    return found;
  }

  /**
   * The names a module's entry exports, or undefined when the entry is no module, such as an ambient declaration. An
   * entry in our own packages' source reads its re-exports of our other packages through `source` too.
   */
  #exportsOf(entry: string): ReadonlySet<string> | undefined {
    if (!this.#exports.has(entry)) {
      const ours = !entry.includes("/node_modules/") && entry.startsWith(join(this.#repoRoot, "packages/"));
      const program = typescript().createProgram({
        rootNames: [entry],
        options: ours ? withSource(this.#compilerOptions) : this.#compilerOptions,
        host: this.#compilerHost,
      });
      const checker = program.getTypeChecker();
      const file = program.getSourceFile(entry);
      const module = file === undefined ? undefined : checker.getSymbolAtLocation(file);
      const names = module === undefined ? undefined : checker.getExportsOfModule(module).map((symbol) => symbol.name);
      this.#exports.set(entry, names === undefined ? undefined : new Set(names));
    }
    return this.#exports.get(entry);
  }
}
