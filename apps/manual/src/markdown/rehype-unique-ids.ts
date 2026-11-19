import { rehypeHeadingIds } from "@astrojs/markdown-remark";
import type { Root, RootContent } from "hast";
import type { Position } from "unist";
import type { VFile } from "vfile";
import { failAt } from "./fail.js";

/** An `id` attribute inside raw HTML, such as a listing's code panel or a replay. */
const RAW_ID = /\sid="([^"]+)"/g;

/**
 * Fails the chapter when two elements on its page share an id, since a link to that id would land on the first and
 * the second could not be reached. The ids are those the page will have: a heading's slug, which Astro adds after
 * every rehype plugin, so this plugin works it out on a copy of the tree with Astro's own plugin; a box's id; a
 * figure's, listing's or table's id such as `lst-greet`; and any id in raw HTML. So a box written
 * `:::box[…]{#exercises}` fails against the `## Exercises` heading, and one written `{#lst-greet}` fails against
 * Listing `greet`. It runs after the other rehype plugins, when every id is in place.
 */
export function rehypeUniqueIds() {
  return (tree: Root, file: VFile): void => {
    const page = structuredClone(tree);
    const astro = { data: { astro: { frontmatter: {} } }, history: [] } as unknown as VFile;
    (rehypeHeadingIds() as (tree: Root, file: VFile) => void)(page, astro);
    const seen = new Map<string, string>();
    const claim = (id: string, what: string, at: Position | undefined): void => {
      const first = seen.get(id);
      if (first !== undefined) {
        failAt(
          file,
          `the id "${id}" is used twice on the page, by ${first} and by ${what}; give one of them another id`,
          {
            position: at,
          },
        );
      }
      seen.set(id, what);
    };
    // A box's title is built without a position, so an error names the line of the nearest element that has one.
    const walk = (node: Root | RootContent, around: Position | undefined): void => {
      const at = node.position ?? around;
      if (node.type === "element" && typeof node.properties.id === "string") {
        claim(node.properties.id, describe(node.tagName, node.properties), at);
      }
      if (node.type === "raw") {
        for (const [, id] of node.value.matchAll(RAW_ID)) if (id !== undefined) claim(id, "an element in raw HTML", at);
      }
      if ("children" in node) for (const child of node.children) walk(child, at);
    };
    walk(page, undefined);
  };
}

/** An element as a writer knows it, for the error message. */
function describe(tagName: string, properties: Record<string, unknown>): string {
  const classes = Array.isArray(properties.className) ? properties.className : [];
  if (classes.includes("box__heading")) return "a box";
  if (classes.includes("tabs__heading")) return "a tab's heading";
  const numbered = properties.dataNumbered;
  if (typeof numbered === "string") return `the ${numbered} "${String(properties.dataNumberedId)}"`;
  if (/^h[1-6]$/.test(tagName)) return "a heading";
  return `a <${tagName}>`;
}
