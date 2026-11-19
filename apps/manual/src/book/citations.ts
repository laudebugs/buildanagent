// Adapted from src/lib/citations.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// Changed from the original: ids are kebab-case and written with an @ ([@anthropic-building-effective-agents]),
// several ids share one bracket with semicolons ([@a; @b]), the register comes in as an argument instead of a JSON
// import, and a citation shows the source's position in the chapter's `sources` list ([1]) instead of its id.

const ONE = "@[a-z0-9]+(?:-[a-z0-9]+)*";

/** One bracket holding one or more citations: `[@a]` or `[@a; @b]`. */
export const CITE = new RegExp(`\\[(${ONE}(?:\\s*;\\s*${ONE})*)\\]`, "g");

/**
 * Anything that starts like a citation, so a malformed one fails instead of rendering as plain text. The match may cross a soft line
 * break but stops after 200 characters, so a long run of unclosed brackets cannot make it scan the text again and
 * again.
 */
export const CITE_LIKE = /\[@[^\]]{0,200}\]/g;

/** Where a citation links: the source's entry on the sources page. */
export const citeHref = (id: string): string => `/sources/#${id}`;

/** One piece of a rendered citation: a link to a source, or the punctuation between links. */
export type CitePart = { readonly id: string; readonly text: string } | { readonly text: string };

/**
 * Splits the inside of one bracket into its pieces. Each id must be in the register and in `order`, the
 * chapter's `sources` list, and shows as its 1-based position there, so the numbers match the chapter's source list.
 */
export function citeParts(
  inner: string,
  register: { readonly ids: ReadonlySet<string>; readonly file: string },
  order: readonly string[],
): readonly CitePart[] {
  const ids = inner.split(/\s*;\s*/).map((id) => id.slice(1));
  const numbers = ids.map((id) => {
    if (!register.ids.has(id)) throw new Error(`[@${id}] is not in the source register (${register.file})`);
    const index = order.indexOf(id);
    if (index === -1) throw new Error(`[@${id}] is not in this chapter's \`sources\`; add it there`);
    return String(index + 1);
  });
  const out: CitePart[] = [{ text: "[" }];
  ids.forEach((id, k) => {
    if (k > 0) out.push({ text: ", " });
    out.push({ id, text: numbers[k] ?? "" });
  });
  out.push({ text: "]" });
  return out;
}
