// Adapted from src/lib/markdown/rehype-figures.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// The garment plugin turns an image and its caption into a figure, fails when the alt text or the caption is missing,
// and inlines a generated HTML fragment in place of the image. Here the book's `:::figure` directive already carries
// the caption and the number (remark-book-directives and rehype-numbering), so this plugin keeps the other two rules:
// it inlines the figure's generated SVG and fails without alt text.
import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import type { Paragraph, Parent, Root, RootContent } from "mdast";
import type { VFile } from "vfile";
import { figureFiles, inlineSvg } from "../book/figures.js";
import type { Book } from "../book/load.js";
import { checkedChapter } from "./chapter-file.js";
import { failAt } from "./fail.js";

// remark-directive's types add these node types to mdast's content unions.
type ContainerDirective = Extract<RootContent, { type: "containerDirective" }>;
type LeafDirective = Extract<RootContent, { type: "leafDirective" }>;

const FIGURE_ATTRIBUTES = new Set(["id", "analogy"]);
const DRAWING = "svg";

/** The analogy each figure in the chapter illustrates, by figure id, for the analogy-figure plugin to check. */
export function figureAnalogies(file: VFile): Map<string, string> {
  const data = file.data as { figureAnalogies?: Map<string, string> };
  data.figureAnalogies ??= new Map();
  return data.figureAnalogies;
}

const isDrawing = (node: RootContent): node is LeafDirective => node.type === "leafDirective" && node.name === DRAWING;
const isFigure = (node: Parent): boolean =>
  node.type === "containerDirective" && (node as ContainerDirective).name === "figure";
const isLabel = (node: RootContent): boolean => node.type === "paragraph" && node.data?.directiveLabel === true;

/**
 * Inlines each figure's generated drawing. A figure holds one `::svg{alt="…"}` and nothing else besides its caption;
 * the plugin reads `<figures dir>/<chapter>/<figure id>.svg`, which the figure's script writes, and puts it in the
 * figure's panel with the alt text as its accessible name. A figure without its drawing or alt text, a drawing that is
 * missing or was not drawn for this figure, an `::svg` outside a figure, and an unknown attribute each fail with the
 * chapter's file and line. It runs before remark-book-directives, which numbers the figure and builds its caption.
 */
export function remarkFigures(options: { readonly book: Book }) {
  const { book } = options;
  return (tree: Root, file: VFile): void => {
    const { outline } = checkedChapter(file);
    visitParents(tree, (node, parent) => {
      if (node.type === "containerDirective" && node.name === "figure") {
        return figure(node, { book, slug: outline.slug, file });
      }
      if (isDrawing(node) && !isFigure(parent)) {
        return failAt(file, "::svg must sit inside a :::figure block, which gives it a number and a caption", node);
      }
      return undefined;
    });
  };
}

/** Visits every node depth first with its parent; a returned node replaces the visited one. */
function visitParents(parent: Parent, visit: (node: RootContent, parent: Parent) => RootContent | undefined): void {
  parent.children = parent.children.map((child) => {
    const replaced = visit(child, parent) ?? child;
    if ("children" in replaced) visitParents(replaced, visit);
    return replaced;
  }) as typeof parent.children;
}

function figure(
  node: ContainerDirective,
  where: { readonly book: Book; readonly slug: string; readonly file: VFile },
): ContainerDirective {
  const { book, slug, file } = where;
  const attributes = node.attributes ?? {};
  const unknown = Object.keys(attributes).find((name) => !FIGURE_ATTRIBUTES.has(name));
  if (unknown !== undefined) {
    return failAt(file, `a figure takes only the attributes id and analogy, not "${unknown}"`, node);
  }
  const id = attributes.id;
  // The book index has already failed on a figure without a kebab-case id, so the build never renders one.
  if (id === undefined || id === null) return node;
  const drawings = node.children.filter(isDrawing);
  const [drawing] = drawings;
  if (drawing === undefined || drawings.length > 1 || node.children.some((c) => !isDrawing(c) && !isLabel(c))) {
    return failAt(
      file,
      `figure "${id}" must hold one generated drawing, written ::svg{alt="…"}, and nothing else; put any prose in ` +
        "its caption or in the text around it",
      node,
    );
  }
  const analogy = attributes.analogy;
  if (analogy !== undefined) {
    if (analogy === null || analogy.trim() === "") {
      return failAt(file, `figure "${id}" names no analogy; write {#${id} analogy="<register id>"}`, node);
    }
    figureAnalogies(file).set(id, analogy);
  }
  const inlined = drawingHtml(drawing, { book, slug, id, file });
  return { ...node, children: node.children.map((child) => (child === drawing ? inlined : child)) };
}

function drawingHtml(
  node: LeafDirective,
  where: { readonly book: Book; readonly slug: string; readonly id: string; readonly file: VFile },
): Paragraph {
  const { book, slug, id, file } = where;
  const attributes = node.attributes ?? {};
  const unknown = Object.keys(attributes).find((name) => name !== "alt");
  if (unknown !== undefined) return failAt(file, `::svg takes only the attribute alt, not "${unknown}"`, node);
  const alt = attributes.alt?.trim() ?? "";
  if (alt === "") {
    return failAt(file, `figure "${id}" needs alt text that says what its drawing shows: ::svg{alt="…"}`, node);
  }
  const { svg, script } = figureFiles(book.inputs.figuresDir, slug, id);
  const name = (path: string) => relative(book.inputs.repoRoot, path);
  if (!existsSync(svg)) {
    return failAt(
      file,
      `figure "${id}" has no drawing at ${name(svg)}; write ${name(script)} and run ` +
        "pnpm --filter @buildanagent/manual figures:build",
      node,
    );
  }
  let html: string;
  try {
    html = inlineSvg(readFileSync(svg, "utf8"), { figureId: id, alt });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return failAt(file, `${name(svg)} cannot be inlined: ${reason}; redraw it with figures:build`, node);
  }
  // The panel and the grid paper match the FigureFrame component, so a chapter's figure looks like the gallery's.
  return {
    type: "paragraph",
    data: { hName: "div", hProperties: { className: ["panel"] } },
    children: [
      {
        type: "emphasis",
        data: { hName: "div", hProperties: { className: ["figure__stage", "panel--grid"] } },
        children: [{ type: "html", value: html }],
      },
    ],
    ...(node.position ? { position: node.position } : {}),
  };
}
