import { isTypeScriptLang } from "../src/plugins/pages.js";

// MDX can pass code to a component as a prop, as in `<Code code={...} lang="ts" />`. That is no fence, so the fence
// rules cannot see it. A regex stops at the first `>`, which an arrow function inside `{...}` contains, so this
// scanner walks each tag from `<Code` to its real end, skipping quoted strings and balanced braces.

/** The `lang` values of every `<Code ...>` tag in `source` whose lang is a plain string or a string expression. */
export function codeComponentLangs(source: string): string[] {
  const langs: string[] = [];
  for (const start of source.matchAll(/<Code(?=[\s/>])/g)) {
    langs.push(...tagLangs(source, start.index + 5));
  }
  return langs;
}

function tagLangs(source: string, from: number): string[] {
  const langs: string[] = [];
  let depth = 0;
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (depth === 0 && ch === ">") break;
    if (ch === "{") depth++;
    else if (ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === '"' || ch === "'" || ch === "`") {
      const end = closingQuote(source, i);
      const before = source.slice(from, i);
      if ((depth === 0 && /\blang=$/.test(before)) || (depth === 1 && /\blang=\{\s*$/.test(before))) {
        langs.push(source.slice(i + 1, end));
      }
      i = end;
    }
    i++;
  }
  return langs;
}

function closingQuote(source: string, open: number): number {
  const end = source.indexOf(source[open] ?? "", open + 1);
  return end === -1 ? source.length : end;
}

/** True when some `<Code>` tag in `source` has a TypeScript `lang`. */
export function showsTypeScriptThroughCode(source: string): boolean {
  return codeComponentLangs(source).some((lang) => isTypeScriptLang(lang));
}
