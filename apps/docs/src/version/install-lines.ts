/**
 * The install-line rule. While only alpha releases exist, npm's `latest` tag has no release to serve (or serves a
 * placeholder), so an install line that names a package without a tag gives the reader the wrong version. Every
 * `@buildanagent/*` package on an install line therefore carries `@alpha`. Once the SDK's version is stable, the
 * `alpha` tag points at old code, so the rule flips: no line may name `@alpha`. The test reads the SDK's version to
 * choose which rule applies, so the first stable release fails it until every line is updated.
 *
 * Only a command's own arguments count: the words after `pnpm add`, `npx` and the like, up to a shell separator, the end
 * of a code span or table cell, or the end of the line (a backslash continues it). A package named elsewhere on the
 * line is prose, and a subpath such as `@buildanagent/gateway/testing` is an import specifier, not an install target.
 */

/** Which tag the install lines must carry. */
export type InstallRule = "alpha" | "stable";

/**
 * `alpha` while the SDK's version is an `-alpha.` prerelease, `stable` for a version with no prerelease part. Any other
 * prerelease (`-beta.1`, `-rc.1`) throws: only the `alpha` dist-tag exists, so no tag rule is defined for it, and a
 * guess in either direction would pass install lines that give the reader the wrong version. The maintainer who
 * publishes such a version extends this function and the tests with the tag it gets.
 */
export function installRuleFor(version: string): InstallRule {
  const dash = version.indexOf("-");
  if (dash === -1) return "stable";
  if (version.slice(dash + 1).startsWith("alpha.")) return "alpha";
  throw new Error(
    `no install-line rule is defined for the prerelease ${version}: only the alpha dist-tag exists, so extend installRuleFor in src/version/install-lines.ts (and its tests) for this tag`,
  );
}

/** What the rule says, for a failure message. */
export function describeRule(rule: InstallRule): string {
  return rule === "alpha"
    ? "only alpha releases exist, so every @buildanagent/* package on an install line must end in @alpha"
    : "the SDK is stable, so no install line may name @alpha (use the bare package name or an exact version)";
}

/** One install line that breaks the rule. */
export interface InstallProblem {
  readonly line: string;
  /** The package token that breaks it, such as `@buildanagent/sdk`. */
  readonly token: string;
}

// A command that installs or runs a package from npm. A line that names a @buildanagent package without one is prose.
const COMMAND = /\b(?:pnpm (?:add|i|install|dlx)|npm (?:install|i|add)|yarn (?:add|dlx)|bun add|bunx|npx)\b/g;
// Where a command's own arguments end: a shell separator (`&&`, `||`, `;`, `|`, which is also a Markdown cell break), the
// end of a code span in Markdown source (a backtick) or the end of the line. `textOfHtml` turns the end of a code span
// and of a table cell into a line end.
const ARGUMENTS_END = /&&|\|\||;|\||`|\n/;
// `@buildanagent/<name>`, then an optional `@<tag or version>`. A token with a subpath, such as
// `@buildanagent/gateway/testing`, is an import specifier and npm cannot install it, so it is not an install target.
const PACKAGE = /^@buildanagent\/[a-z0-9-]+(?:@[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
// Prose punctuation and quotes around an argument, such as the full stop after `@buildanagent/sdk@alpha.`.
const AROUND_TOKEN = /^[("'[]+|[.,:)"'\]]+$/g;

/** The text of a built page's code, one line per row: tags removed, block, cell and code-span ends turned into line breaks, entities decoded. */
export function textOfHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<\/(?:div|p|li|pre|tr|td|th|code|h[1-6])>|<br\s*\/?>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(lt|gt|quot|amp);/g, (_, name: string) => ({ lt: "<", gt: ">", quot: '"', amp: "&" })[name] as string);
}

/** Every install line in `text` (Markdown, MDX or the output of `textOfHtml`). A line ending in a backslash continues on the next. */
export function installLines(text: string): string[] {
  return text
    .replace(/\\[ \t]*\r?\n[ \t]*/g, " ")
    .split("\n")
    .filter((line) => line.search(COMMAND) !== -1 && line.includes("@buildanagent/"));
}

/** The `@buildanagent/*` install targets among a command's own arguments, which end at a separator or a span end. */
function targets(afterCommand: string): string[] {
  const end = afterCommand.search(ARGUMENTS_END);
  const text = end === -1 ? afterCommand : afterCommand.slice(0, end);
  return text
    .split(/\s+/)
    .map((word) => word.replace(AROUND_TOKEN, ""))
    .filter((word) => PACKAGE.test(word));
}

/** The package tokens on install lines in `text` that break `rule`. */
export function installProblems(text: string, rule: InstallRule): InstallProblem[] {
  const problems: InstallProblem[] = [];
  for (const line of installLines(text)) {
    for (const command of line.matchAll(COMMAND)) {
      for (const token of targets(line.slice(command.index + command[0].length))) {
        const tagged = /^@buildanagent\/[a-z0-9-]+@/.test(token);
        const alpha = token.endsWith("@alpha");
        if (rule === "alpha" ? !alpha : tagged && alpha) problems.push({ line: line.trim(), token });
      }
    }
  }
  return problems;
}
