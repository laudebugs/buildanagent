import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import type ts from "typescript-api";
import { typescript } from "./typescript.js";

// The owner's decision (2026-11-19): names that TypeScript's standard library declares, such as `Promise`,
// `JSON.parse`, `fetch` and `process`, resolve without a marker, as the listing's harness compiles them. Environment
// variables, and any other name, still need a listing or a marker.

/** The standard library one harness compiles against, as the inline-code check reads it. */
export interface LibraryScope {
  /** The harness's tsconfig and what it selects: `verify/vercel-ai-sdk/tsconfig.json (lib es2024; types node)`. */
  readonly label: string;
  /** Whether the library declares a global of this name: a value, a type or a namespace. */
  has(name: string): boolean;
  /**
   * How many names of a member path resolve through the library: its root, when the library declares it, then each
   * property of the type before it, stopping at the first name that is no property. `JSON.parse` gives 2, and
   * `process.env.OPENAI_API_KEY` gives 2, because an index signature names no property.
   */
  resolvedPrefix(path: readonly string[]): number;
}

/** The nearest `tsconfig.json` at or above a listed file's directory, inside the repository, as `tsc -p` finds it. */
export function nearestTsconfig(file: string, repoRoot: string): string | undefined {
  // resolve() drops a trailing separator, so the segment-wise comparison holds.
  const root = resolve(repoRoot);
  for (let dir = dirname(resolve(file)); dir === root || dir.startsWith(`${root}${sep}`); dir = dirname(dir)) {
    const config = join(dir, "tsconfig.json");
    if (existsSync(config)) return config;
    if (dir === root) break;
  }
  return undefined;
}

/** A lib file's name as a tsconfig writes it: `lib.es2024.d.ts` is `es2024`. */
const libName = (file: string): string =>
  file
    .replace(/^.*[\\/]/, "")
    .replace(/^lib\./, "")
    .replace(/\.d\.ts$/, "");

/** The standard libraries one book load reads, one for each harness tsconfig, each read on first use. */
export class StandardLibraries {
  readonly #repoRoot: string;
  readonly #scopes = new Map<string, LibraryScope>();

  constructor(repoRoot: string) {
    this.#repoRoot = repoRoot;
  }

  /** The library the tsconfig at `config` selects; with no tsconfig, the compiler's defaults. */
  scope(config: string | undefined): LibraryScope {
    const key = config ?? "";
    let scope = this.#scopes.get(key);
    if (scope === undefined) {
      scope = this.#read(config);
      this.#scopes.set(key, scope);
    }
    return scope;
  }

  #read(config: string | undefined): LibraryScope {
    const ts = typescript();
    const parsed =
      config === undefined
        ? undefined
        : ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
    const options: ts.CompilerOptions = { ...(parsed?.options ?? {}), noEmit: true, skipLibCheck: true, noLib: false };
    // An empty module beside the tsconfig, so the program holds only the library and the types the tsconfig selects,
    // and `types` resolves from the harness's own node_modules.
    const probe = join(config === undefined ? this.#repoRoot : dirname(config), "__book_standard_library__.ts");
    const host = ts.createCompilerHost(options);
    const read = host.getSourceFile.bind(host);
    const exists = host.fileExists.bind(host);
    host.fileExists = (file) => file === probe || exists(file);
    host.getSourceFile = (file, version, onError, create) =>
      file === probe ? ts.createSourceFile(probe, "export {};\n", version) : read(file, version, onError, create);
    const program = ts.createProgram({ rootNames: [probe], options, host });
    const checker = program.getTypeChecker();
    const file = program.getSourceFile(probe);
    const { Value, Type, Namespace, Alias } = ts.SymbolFlags;
    const globals = new Map(
      (file === undefined ? [] : checker.getSymbolsInScope(file, Value | Type | Namespace | Alias)).map((symbol) => [
        symbol.name,
        symbol,
      ]),
    );
    const libs = (options.lib ?? [ts.getDefaultLibFileName(options)]).map(libName);
    const types = options.types === undefined ? "every @types package" : options.types.join(", ") || "none";
    const shown =
      config === undefined ? "the compiler's defaults" : relative(this.#repoRoot, config).split(sep).join("/");
    return {
      label: `${shown} (lib ${libs.join(", ")}; types ${types})`,
      has: (name) => globals.has(name),
      resolvedPrefix: (path) => {
        const root = path[0] === undefined ? undefined : globals.get(path[0]);
        if (root === undefined || file === undefined) return 0;
        let type: ts.Type = checker.getTypeOfSymbolAtLocation(root, file);
        let count = 1;
        for (const name of path.slice(1)) {
          const property = checker.getPropertyOfType(checker.getApparentType(type), name);
          if (property === undefined) break;
          type = checker.getTypeOfSymbolAtLocation(property, file);
          count++;
        }
        return count;
      },
    };
  }
}
