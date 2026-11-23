/**
 * The install-line rule. While only alpha releases exist, npm's `latest` tag has no release to serve (or serves a
 * placeholder), so an install line that names a package without a tag gives the reader the wrong version. Every
 * `@buildanagent/*` package on an install line therefore carries `@alpha`. Once the SDK's version is stable, the
 * `alpha` tag points at old code, so the rule flips: no line may name `@alpha`. The test reads the SDK's version to
 * choose which rule applies, so the first stable release fails it until every line is updated.
 */

/** Which tag the install lines must carry. */
export type InstallRule = "alpha" | "stable";

/** `alpha` while the SDK's version is a prerelease with an `-alpha.` part, otherwise `stable`. */
export function installRuleFor(version: string): InstallRule {
  return version.includes("-alpha.") ? "alpha" : "stable";
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
const COMMAND = /\b(?:pnpm add|pnpm dlx|npm install|npm i|yarn add|npx)\b/;
// `@buildanagent/<name>`, then an optional `@<tag or version>`. A subpath such as `/testing` is not part of an install.
const PACKAGE = /@buildanagent\/[a-z0-9-]+(?:@[0-9A-Za-z.-]+)?/g;

/** The text of a built page's code, one line per row: tags removed, block ends turned into line breaks, entities decoded. */
export function textOfHtml(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/g, "")
    .replace(/<\/(?:div|p|li|pre|tr|h[1-6])>|<br\s*\/?>/g, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&(lt|gt|quot|amp);/g, (_, name: string) => ({ lt: "<", gt: ">", quot: '"', amp: "&" })[name] as string);
}

/** Every install line in `text` (Markdown, MDX or the output of `textOfHtml`). */
export function installLines(text: string): string[] {
  return text.split("\n").filter((line) => COMMAND.test(line) && line.includes("@buildanagent/"));
}

/** The package tokens on install lines in `text` that break `rule`. */
export function installProblems(text: string, rule: InstallRule): InstallProblem[] {
  const problems: InstallProblem[] = [];
  for (const line of installLines(text)) {
    const afterCommand = line.slice(line.search(COMMAND));
    for (const match of afterCommand.matchAll(PACKAGE)) {
      const token = match[0];
      const tagged = /^@buildanagent\/[a-z0-9-]+@/.test(token);
      const alpha = token.endsWith("@alpha");
      if (rule === "alpha" ? !alpha : tagged && alpha) problems.push({ line: line.trim(), token });
    }
  }
  return problems;
}
