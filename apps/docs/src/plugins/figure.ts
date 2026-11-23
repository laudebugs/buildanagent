/**
 * The `::figure` directive. A page writes a leaf directive whose label is the caption:
 *
 *     ::figure[The six packages and what each one imports]{id="package-map" alt="The CLI sits on the harness, …"}
 *
 * The plugin inlines the committed `figures/<id>.svg`, checked by figure-svg.ts, in a `<figure>` with its caption, on
 * the book's grid-paper panel. The drawing keeps its natural size, so its labels stay at 12 px, and the panel scrolls
 * sideways on a screen narrower than the drawing. The build fails, naming the page and line, on a figure without an id
 * the registry names, alt text or a caption, with any other attribute, shown twice on a page, or whose SVG fails the
 * check. Starlight's remark-directive parses the syntax; this plugin runs before Starlight puts unknown directives back
 * as text, so a figure is never shown as its source.
 */
import { readFileSync } from "node:fs";
import type { Element, ElementContent } from "hast";
import type { Paragraph, PhrasingContent, Root } from "mdast";
import type {} from "remark-directive";
import { visit } from "unist-util-visit";
import { isFigureId, svgOf } from "../../figures/registry.js";
import { figureSvg } from "./figure-svg.js";

/** The note under a figure that shows only while its panel is narrower than the drawing, as in the book. */
export const SCROLL_HINT = "Scroll sideways to see the whole figure →";

const ATTRIBUTES = new Set(["id", "alt"]);

/** A figure directive the build refuses; the message names the page and line. */
export class FigureDirectiveError extends Error {
  override readonly name = "FigureDirectiveError";
}

/** The caption's content as hast: plain text and inline code, which is all a caption needs. */
function captionOf(children: readonly PhrasingContent[], where: string): ElementContent[] {
  return children.map((child): ElementContent => {
    if (child.type === "text") return { type: "text", value: child.value };
    if (child.type === "inlineCode") {
      return { type: "element", tagName: "code", properties: {}, children: [{ type: "text", value: child.value }] };
    }
    throw new FigureDirectiveError(`${where}: a figure caption holds only text and inline code, not ${child.type}`);
  });
}

/** The `<figure>` a page shows: the panel with its scrolling stage and hint, then the caption that names the stage. */
function figureElement(id: string, svg: Element, caption: ElementContent[]): Element {
  const captionId = `figure-${id}--caption`;
  const element = (tagName: string, properties: Element["properties"], children: ElementContent[]): Element => ({
    type: "element",
    tagName,
    properties,
    children,
  });
  return element(
    "figure",
    { className: ["docs-figure", "not-content"], id: `figure-${id}`, ariaLabelledBy: [captionId] },
    [
      element("div", { className: ["figure__panel", "panel"] }, [
        // The stage takes keyboard focus so a reader without a pointer can scroll it; the caption names it.
        element(
          "div",
          {
            className: ["figure__stage", "figure__stage--scroll", "panel--grid"],
            tabIndex: 0,
            role: "group",
            ariaLabelledBy: [captionId],
          },
          [svg],
        ),
        element("p", { className: ["figure__scroll-hint"], ariaHidden: "true" }, [
          { type: "text", value: SCROLL_HINT },
        ]),
      ]),
      element("figcaption", { className: ["figure__caption"], id: captionId }, caption),
    ],
  );
}

/** The remark plugin. Pass it in `markdown.remarkPlugins`; Starlight adds remark-directive itself. */
export function figureDirective() {
  return (tree: Root, file: { readonly path?: string }) => {
    const shown = new Set<string>();
    visit(tree, (node, index, parent) => {
      if (node.type !== "leafDirective" && node.type !== "containerDirective" && node.type !== "textDirective") return;
      if (node.name !== "figure") return;
      const where = `${file.path ?? "a page"}:${node.position?.start.line ?? "?"}`;
      const fail = (message: string): never => {
        throw new FigureDirectiveError(`${where}: ${message}`);
      };
      if (node.type !== "leafDirective") {
        return fail("a figure is a leaf directive on a line of its own, ::figure[caption]{…}");
      }
      const attributes = node.attributes ?? {};
      const extra = Object.keys(attributes).find((name) => !ATTRIBUTES.has(name));
      if (extra !== undefined) fail(`a figure takes only id and alt, not ${extra}`);
      const id = attributes.id ?? "";
      if (!isFigureId(id)) fail(`no registered figure has the id "${id}"; add it to figures/registry.ts`);
      const alt = (attributes.alt ?? "").trim();
      if (alt === "") fail(`figure "${id}" needs alt text that states its point, alt="…"`);
      const caption = captionOf(node.children, where);
      if (node.children.every((child) => ("value" in child ? child.value.trim() === "" : true))) {
        fail(`figure "${id}" needs a caption, ::figure[caption]{…}`);
      }
      if (shown.has(id)) fail(`figure "${id}" is shown twice on this page; its ids would clash`);
      shown.add(id);
      let svg: Element;
      try {
        svg = figureSvg(readFileSync(svgOf(id), "utf8"), { figureId: id, alt });
      } catch (error) {
        return fail(`figures/${id}.svg can't be inlined: ${error instanceof Error ? error.message : String(error)}`);
      }
      // The directive becomes an empty paragraph that renders as the figure, so later plugins, Starlight's directive
      // restoration among them, see an ordinary node.
      const figure = figureElement(id, svg, caption);
      const replacement: Paragraph = {
        type: "paragraph",
        children: [],
        // mdast-util-to-hast reads these three fields; its types, which declare them, are not a dependency here.
        data: {
          hName: figure.tagName,
          hProperties: figure.properties,
          hChildren: figure.children,
        } as Paragraph["data"],
      };
      if (parent !== undefined && index !== undefined) parent.children.splice(index, 1, replacement as never);
    });
  };
}
