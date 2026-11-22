// Adapted from src/lib/markdown/split-text.mjs in the owner's garment engineering textbook
// (tajistudios/garment-engineering-textbook, commit bca44b0), reused with the owner's permission.
// SPDX-License-Identifier: Apache-2.0
// As a file derived from that repository, this file is licensed under Apache-2.0 only, not Apache-2.0 OR MIT
// (LICENSE, THIRD-PARTY-NOTICES.md).
//
// Changed from the original: typed for mdast, `split` may return nodes of any phrasing type, and every new node keeps
// the position of the text it replaces.
//
// Shared by the remark plugins that turn pieces of plain text into other nodes (citations, glossary terms).
// CommonMark leaves those pieces inside text nodes, so each plugin splits the text nodes it is allowed to touch.

import type { PhrasingContent, Root, Text } from "mdast";
import { SKIP, visit } from "unist-util-visit";
import { slicePosition } from "./position.js";

/** Text nodes inside any node of the given types (link text, headings, code and so on). */
export function textInside(tree: Root, types: ReadonlySet<string>): Set<Text> {
  const inside = new Set<Text>();
  visit(tree, (node) => {
    if (!types.has(node.type)) return;
    visit(node, "text", (text) => {
      inside.add(text);
    });
    return SKIP;
  });
  return inside;
}

const rendersAsElement = (node: Text): boolean =>
  node.data?.hName !== undefined || node.data?.hProperties !== undefined;

/** One piece of a text node to replace: where it starts, how long it is and what replaces it. */
export interface TextPiece {
  readonly index: number;
  readonly length: number;
  readonly node: PhrasingContent | readonly PhrasingContent[];
}

/**
 * Replaces each text node not in `skip` with the pieces `split(value, node)` returns, in order. Text between them stays
 * text. Returning an empty list leaves the node as it is. Every new node gets the position of the characters it
 * replaces, so a later plugin's error inside it still names the right line. A text node that another plugin renders
 * as an element of its own, through `hName` or `hProperties`, is never split.
 */
export function splitText(
  tree: Root,
  skip: ReadonlySet<Text>,
  split: (value: string, node: Text) => readonly TextPiece[],
): void {
  visit(tree, "text", (node, index, parent) => {
    // Such a node is one a plugin made, such as a listing caption's verified line: its data renders it as its own
    // element, a <span> with a class, and the plain text nodes a split makes would drop that element.
    if (!parent || index === undefined || skip.has(node) || rendersAsElement(node)) return;
    const value = node.value;
    const text = (from: number, to: number): Text => {
      const position = slicePosition(node.position, value, from, to);
      return { type: "text", value: value.slice(from, to), ...(position ? { position } : {}) };
    };
    const out: PhrasingContent[] = [];
    let last = 0;
    for (const piece of split(value, node)) {
      if (piece.index > last) out.push(text(last, piece.index));
      const position = slicePosition(node.position, value, piece.index, piece.index + piece.length);
      for (const replacement of [piece.node].flat()) out.push(position ? { ...replacement, position } : replacement);
      last = piece.index + piece.length;
    }
    if (out.length === 0) return;
    if (last < value.length) out.push(text(last, value.length));
    (parent.children as PhrasingContent[]).splice(index, 1, ...out);
    return [SKIP, index + out.length];
  });
}
