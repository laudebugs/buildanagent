/** The remark plugin that fills a ` ```ts file="…" ` fence from its example file (example-code.ts). */
import type { Code, Root } from "mdast";
import { visit } from "unist-util-visit";
import { exampleSource, exampleTitle, parseExampleRef } from "./example-code.js";

export function exampleFile() {
  return (tree: Root) => {
    visit(tree, "code", (node: Code) => {
      const ref = parseExampleRef(node.meta);
      if (ref === undefined) return;
      node.value = exampleSource(ref);
      node.meta = `title="${exampleTitle(ref)}"`;
    });
  };
}
