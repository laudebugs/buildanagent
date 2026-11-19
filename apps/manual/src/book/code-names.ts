import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { extname, join } from "node:path";
import ts from "typescript-api";
import type { WrittenChapter } from "./book-index.js";
import { type FactCheckRows, readFactCheckRows } from "./fact-check-log.js";
import type { ListingSource } from "./listings.js";
import { readTranscript, type Transcript } from "./transcripts.js";

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
const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2024,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true,
  noLib: true,
  skipLibCheck: true,
  types: [],
};

/** The extensions a resolved import may have for its exports to be read: declarations, or TypeScript source. */
const TYPED = new Set([".d.ts", ".d.mts", ".d.cts", ".ts", ".mts", ".cts", ".tsx"]);

/** One package a listing imports, at the version its harness resolves, and the names its `.d.ts` exports. */
export interface PackageExports {
  /** The import and its package's version, such as `ai@7.0.162` or `ai/test from ai@7.0.162`. */
  readonly label: string;
  readonly names: ReadonlySet<string>;
}

/** One place a chapter's inline code may resolve to, as a failure message names it, and the names found there. */
export interface NameSource {
  readonly label: string;
  readonly names: ReadonlySet<string>;
}

/** The three places a chapter's inline code resolves to: its listings, their transcripts and the packages they import. */
export interface ChapterNames {
  readonly listings: readonly NameSource[];
  readonly transcripts: readonly NameSource[];
  readonly packages: readonly NameSource[];
}

/** Whether a name is in any of a chapter's three places. */
export const hasName = (names: ChapterNames, name: string): boolean =>
  [...names.listings, ...names.transcripts, ...names.packages].some((source) => source.names.has(name));

type TranscriptMessage = Extract<Transcript["events"][number], { kind: "response" }>["message"];

/** The values a transcript records that prose may name: tool names, message roles, stop reasons and check messages. */
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
 * The identifiers and string values of the code a listing shows, read with the compiler from the real file: every
 * identifier, property names included, and every string or template literal's text whose node starts on a line the
 * listing shows. Comments are not code, so a name only a comment holds does not count.
 */
export function listedNames(file: ts.SourceFile, shown: ReadonlySet<number>): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    if (shown.has(line)) {
      if (ts.isIdentifier(node)) names.add(node.text);
      else if (
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

/** The package imports of a file: each `import … from` and `export … from` that names neither a path nor a Node built-in. */
export function packageImports(file: ts.SourceFile): string[] {
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
  readonly #exports = new Map<string, ReadonlySet<string>>();
  readonly #resolved = new Map<string, PackageExports | string>();
  readonly #chapters = new Map<string, ChapterNames | string>();
  readonly #rows = new Map<string, FactCheckRows | undefined>();
  readonly #declarations = new Map<string, ts.SourceFile | undefined>();
  readonly #host: ts.CompilerHost;

  constructor(repoRoot: string) {
    this.#repoRoot = repoRoot;
    // One host for every program of this load, sharing each declaration file it parses: packages re-export from the
    // same files, so one parse serves every package that reaches it.
    const host = ts.createCompilerHost(OPTIONS);
    const read = host.getSourceFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) => {
      if (!this.#declarations.has(fileName)) {
        this.#declarations.set(fileName, read(fileName, languageVersion, onError, shouldCreate));
      }
      return this.#declarations.get(fileName);
    };
    this.#host = host;
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

  /** A fact-check log's rows, or undefined when the log does not exist. */
  rows(file: string): FactCheckRows | undefined {
    if (!this.#rows.has(file)) {
      this.#rows.set(file, existsSync(file) ? readFactCheckRows(readFileSync(file, "utf8")) : undefined);
    }
    return this.#rows.get(file);
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
  #packageExports(source: ListingSource, specifier: string): PackageExports | string {
    const key = `${source.harness}\0${specifier}`;
    const cached = this.#resolved.get(key);
    if (cached !== undefined) return cached;
    const resolved = ts.resolveModuleName(specifier, join(this.#repoRoot, source.path), OPTIONS, ts.sys).resolvedModule;
    let found: PackageExports | string;
    if (resolved === undefined || !TYPED.has(resolved.extension)) {
      found =
        `${source.path} imports ${specifier}, whose .d.ts cannot be found from ${source.harness}; ` +
        `run pnpm install, or check that ${specifier} ships its types`;
    } else {
      const id = resolved.packageId;
      const version = id === undefined ? specifier : `${id.name}@${id.version}`;
      const label = id === undefined || id.name === specifier ? version : `${specifier} from ${version}`;
      found = { label, names: this.#exportsOf(resolved.resolvedFileName) };
    }
    this.#resolved.set(key, found);
    return found;
  }

  #exportsOf(entry: string): ReadonlySet<string> {
    let names = this.#exports.get(entry);
    if (names === undefined) {
      const program = ts.createProgram({ rootNames: [entry], options: OPTIONS, host: this.#host });
      const checker = program.getTypeChecker();
      const file = program.getSourceFile(entry);
      const module = file === undefined ? undefined : checker.getSymbolAtLocation(file);
      names = new Set(module === undefined ? [] : checker.getExportsOfModule(module).map((symbol) => symbol.name));
      this.#exports.set(entry, names);
    }
    return names;
  }
}
