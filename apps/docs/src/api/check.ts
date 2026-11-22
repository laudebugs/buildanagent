/**
 * The undocumented-export check. It converts a package's entry points with TypeDoc and fails on a warning: an export
 * (function, class, interface, type alias, variable or enum) without TSDoc, an unresolved `{@link}`, or an error from
 * the TypeScript compiler. TypeDoc 0.28 reads TypeScript up to 6.0, so the docs app pins that release for TypeDoc.
 */
import { Application, LogLevel, ReflectionKind, type TypeDocOptions } from "typedoc";

/** What the check found: every message TypeDoc logged at warning level or above. */
export interface ApiCheckResult {
  readonly problems: readonly string[];
}

/** Converts the entry points in `options` and returns the problems, empty when every export is documented. */
export async function checkApiDocs(options: Partial<TypeDocOptions>): Promise<ApiCheckResult> {
  const problems: string[] = [];
  const app = await Application.bootstrap({ ...options, emit: "none", logLevel: "Warn" });
  // The logger passes each message to `log` before it counts it, so a custom logger collects them without printing.
  app.logger.log = (message, level) => {
    if (level === LogLevel.Warn || level === LogLevel.Error) problems.push(message);
  };
  const project = await app.convert();
  if (project === undefined) return { problems: [...problems, "TypeDoc could not convert the entry points"] };
  app.validate(project);
  return { problems };
}

/** One export of a package: its module (`index`, `testing`, `adapters/anthropic`), its name and its TypeDoc kind. */
export interface ApiExport {
  readonly module: string;
  readonly name: string;
  readonly kind: string;
}

/** Every export of every entry point in `options`, so a test can check each has a reference page. */
export async function listExports(options: Partial<TypeDocOptions>): Promise<ApiExport[]> {
  const app = await Application.bootstrap({ ...options, emit: "none", logLevel: "None" });
  const project = await app.convert();
  if (project === undefined) throw new Error("TypeDoc could not convert the entry points");
  // A re-export has the kind Reference and is documented where it is declared, so only declarations count.
  return (project.children ?? []).flatMap((module) =>
    (module.children ?? [])
      .filter((member) => member.kind !== ReflectionKind.Reference)
      .map((member) => ({
        module: module.name,
        name: member.name,
        kind: ReflectionKind[member.kind],
      })),
  );
}
