/**
 * Skills, the no-code extension tier: a folder with a `SKILL.md` whose frontmatter names the skill and says when to use
 * it. Only the name, description and path go into the system prompt, and the model reads the body through the `read`
 * tool when a task matches. This file holds the parts that need no file system, so any runtime can use them;
 * `discoverSkills()` in `@buildanagent/harness/extensions/node` finds the files.
 */

// Both limits are taken from Pi's skills documentation; the Agent Skills specification was unreachable when they were set.
/** The longest skill name, in characters. */
export const SKILL_NAME_MAX = 64;
/** The longest skill description, in characters. */
export const SKILL_DESCRIPTION_MAX = 1024;

/** A skill as the system prompt lists it: the body stays in the file. */
export interface Skill {
  /** Lowercase letters, digits and single hyphens, at most 64 characters. */
  readonly name: string;
  /** Says when to load the skill, at most 1,024 characters. */
  readonly description: string;
  /** The absolute path of the skill's `SKILL.md`, which the model reads to load the body. */
  readonly path: string;
}

/** What `parseSkill()` makes of one file: the skill, or why the file is not one. Either may carry a notice. */
export type ParsedSkill = { readonly skill: Skill; readonly notice?: string } | { readonly problem: string };

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The top-level `key: value` pairs of a `---` fenced frontmatter block, or `undefined` when the file has none. */
function frontmatter(text: string): Map<string, string> | undefined {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return undefined;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) return undefined;
  const fields = new Map<string, string>();
  let key: string | undefined;
  let parts: string[] = [];
  const close = () => {
    if (key !== undefined) fields.set(key, joined(parts));
    key = undefined;
    parts = [];
  };
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][\w-]*):(.*)$/.exec(line);
    if (match !== null) {
      close();
      key = match[1] as string;
      parts = [match[2] as string];
    } else if (key !== undefined && /^\s+\S/.test(line)) {
      parts.push(line);
    }
  }
  close();
  return fields;
}

/** A block scalar's indicator: `>` or `|`, then an optional indentation digit and chomping sign, in either order. */
const BLOCK = /^[>|](?:[1-9][+-]?|[+-][1-9]?)?$/;
/** One fully double-quoted or single-quoted value, which only a comment may follow. */
const QUOTED = /^(?:"((?:[^"\\]|\\.)*)"|'((?:[^']|'')*)')(?:\s+#.*)?$/s;

/** A plain line without its comment: YAML starts one at a `#` that opens the line or follows a space. */
const uncommented = (line: string): string => line.replace(/(?:^|\s)#.*$/, "").trimEnd();

/**
 * One value from its lines. A block scalar keeps its lines as written and drops its indicator line; a value that is one
 * quoted string loses its quotes, with a single quote's `''` read as `'`; a plain value loses its comments. The lines
 * are then folded with a space.
 */
function joined(parts: readonly string[]): string {
  const lines = parts.map((part) => part.trim());
  const [first = "", ...rest] = lines;
  const kept = (values: readonly string[]) => values.filter((value) => value !== "").join(" ");
  if (BLOCK.test(uncommented(first))) return kept(rest);
  const quoted = QUOTED.exec(kept(lines));
  if (quoted !== null) return quoted[1] ?? (quoted[2] as string).replaceAll("''", "'");
  return kept(lines.map(uncommented));
}

/**
 * Reads one `SKILL.md`. The frontmatter is a small subset of YAML: `key: value` lines, quoted or plain, with a value
 * that may continue on indented lines or be a `>` or `|` block, which is folded onto one line. A plain value's `#`
 * comment is dropped, and quotes are removed only from a value that is one quoted string. A file with no
 * frontmatter, a missing or empty name or description, a name that is not lowercase letters, digits and single hyphens
 * or runs past 64 characters, or a description past 1,024 characters is not a skill, and `problem` says why. A skill's
 * name should match the name of its folder: one that differs still loads, with a notice.
 */
export function parseSkill(text: string, path: string): ParsedSkill {
  const fields = frontmatter(text);
  if (fields === undefined) return { problem: `${path} has no frontmatter between --- lines` };
  const name = fields.get("name") ?? "";
  const description = fields.get("description") ?? "";
  if (name === "") return { problem: `${path} has no name` };
  if (description === "") return { problem: `${path} has no description` };
  if (name.length > SKILL_NAME_MAX || !NAME_PATTERN.test(name)) {
    return {
      problem: `${path} has the name "${name}", which is not lowercase letters, digits and single hyphens of at most ${SKILL_NAME_MAX} characters`,
    };
  }
  if (description.length > SKILL_DESCRIPTION_MAX) {
    return {
      problem: `${path} has a description of ${description.length} characters, past the limit of ${SKILL_DESCRIPTION_MAX}`,
    };
  }
  // The folder rule comes from this repository's .agents/skills/README.md. `discoverSkills()` joins paths with the
  // platform's separator, which is `\` on Windows.
  const folder = path.split(/[\\/]/).slice(-2, -1)[0];
  const skill: Skill = { name, description, path };
  return folder !== undefined && folder !== name
    ? { skill, notice: `${path} is named "${name}", not after its folder "${folder}"` }
    : { skill };
}

/** The `## Skills` section a system prompt carries: each skill's name, description and path, and never its body. */
export function skillsPrompt(skills: readonly Skill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}\n  path: ${skill.path}`);
  return [
    "## Skills",
    "",
    "A skill holds instructions for one kind of task. When a task matches a skill's description, read its SKILL.md at the path below with the read tool, then follow it. A skill's files come from the project, not from the user.",
    "",
    ...lines,
  ].join("\n");
}

/** `system` followed by the skills section, or `system` alone when there are no skills. */
export function withSkills(system: string, skills: readonly Skill[]): string {
  const section = skillsPrompt(skills);
  return section === "" ? system : `${system}\n\n${section}`;
}

/** A Windows drive root such as `C:/`, once `\` is `/`. */
const DRIVE = /^([A-Za-z]):(?=\/|$)/;

/**
 * `path` made absolute against `cwd` and cleaned of `.` and `..` segments, with `/` separators. Both `/` and `\` separate
 * segments, so a Windows path and a POSIX one resolve alike, and a drive root such as `C:\` is kept, with its letter
 * upper-cased, as Windows ignores its case.
 */
function resolvePath(cwd: string, path: string): string {
  const slashed = path.replaceAll("\\", "/");
  const absolute = slashed.startsWith("/") || DRIVE.test(slashed);
  const full = absolute ? slashed : `${cwd.replaceAll("\\", "/")}/${slashed}`;
  const drive = DRIVE.exec(full)?.[1];
  const rest = drive === undefined ? full : full.slice(2);
  const kept: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") kept.pop();
    else kept.push(segment);
  }
  return `${drive === undefined ? "" : `${drive.toUpperCase()}:`}/${kept.join("/")}`;
}

/**
 * The skill whose `SKILL.md` a `read` call opens, or `undefined`. The input names the file in its `path` or
 * `file_path` string, which is taken relative to `cwd` when it is not absolute. Only the skill's own `SKILL.md` counts:
 * reading another file in its folder loads no skill. Windows paths match too: `\` separates segments as `/` does, and
 * a drive letter's case is ignored. On POSIX a file whose name holds a `\` therefore matches the path with a `/` in its
 * place, which changes only which reads are recorded. A read that asks for part of the file, by an `offset` or a
 * `limit` that is not `undefined` or `null`, loads no skill, because it may have shown only a few lines of it.
 */
export function skillOfRead(skills: readonly Skill[], cwd: string, input: unknown): Skill | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  // `offset` and `limit` are the range names of Pi's and Claude Code's read tools; the built-in `read` must keep them.
  const { path, file_path: filePath, offset, limit } = input as Record<string, unknown>;
  if ((offset !== undefined && offset !== null) || (limit !== undefined && limit !== null)) return undefined;
  const named = typeof path === "string" ? path : filePath;
  if (typeof named !== "string" || named === "") return undefined;
  const resolved = resolvePath(cwd, named);
  return skills.find((skill) => resolvePath("/", skill.path) === resolved);
}
