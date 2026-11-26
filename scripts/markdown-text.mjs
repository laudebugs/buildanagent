// Two small, dependency-free pieces of Markdown text handling, shared by scripts/package-docs.mjs (a package's
// README headings, level 2 and 3 only) and scripts/ci/markdown-links.mjs (every tracked file's headings, every
// level). Kept dependency-free on purpose: markdown-links.mjs runs as a CI check and should not need node_modules
// resolved just to strip a fence or slug a heading, which importing package-docs.mjs would otherwise force (its
// top-level `import.meta.resolve("typescript/package.json")`).

/** The Markdown text with its fenced blocks blanked out, line for line, so line numbers still match. */
export function prose(markdown) {
  const lines = markdown.split("\n");
  let fence;
  return lines.map((line) => {
    const open = /^(`{3,})/.exec(line)?.[1];
    if (fence === undefined && open !== undefined) {
      fence = open;
      return "";
    }
    if (fence !== undefined) {
      if (line.trim() === fence) fence = undefined;
      return "";
    }
    return line;
  });
}

/**
 * GitHub's slug for one heading's text: lower case, punctuation dropped, spaces as hyphens. It names the text alone;
 * a repeat's `-1`, `-2` … lives in whoever counts repeats across one document (`headingAnchors` in package-docs.mjs,
 * or markdown-links.mjs's own version for heading levels that one doesn't read).
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}
