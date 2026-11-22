import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { commentsOf, findTodoIds, todoIds } from "./todo-ids.mjs";

/** A repo with two todos, B4 (done) and E2a (ready), and one source file under packages/demo/src. */
function repo(source) {
  const root = mkdtempSync(path.join(tmpdir(), "todo-ids-"));
  for (const [state, name] of [
    ["done", "B4-usage.md"],
    ["ready", "E2a-keys.md"],
  ]) {
    mkdirSync(path.join(root, "docs", "todos", state), { recursive: true });
    writeFileSync(path.join(root, "docs", "todos", state, name), "# todo\n");
  }
  mkdirSync(path.join(root, "packages", "demo", "src"), { recursive: true });
  writeFileSync(path.join(root, "packages", "demo", "src", "index.ts"), source);
  return root;
}

test("the ids come from the todo files' names", () => {
  const root = repo("");
  try {
    assert.deepEqual([...todoIds(root)].sort(), ["B4", "E2a"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a todo id in a line or block comment fails, with its file and line", () => {
  const root = repo("export const a = 1; // see B4\n/**\n * Added for E2a.\n */\nexport const b = 2;\n");
  try {
    assert.deepEqual(findTodoIds(root), [
      { file: path.join("packages", "demo", "src", "index.ts"), line: 1, id: "B4" },
      { file: path.join("packages", "demo", "src", "index.ts"), line: 3, id: "E2a" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("decision ids, strings that hold an id, and longer names are not todo ids", () => {
  const root = repo(
    [
      "// D3 and HD15 are decisions; SG4 is a plan section; B40 and XB4 are other names.",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test holds a template literal
      'export const when = `${day}T00:00:00Z`; export const label = "B4 and E2a";',
      "export const re = /B4/; // fine",
    ].join("\n"),
  );
  try {
    assert.deepEqual(findTodoIds(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("commentsOf reads comments only, across lines, and a // inside a string starts none", () => {
  const comments = commentsOf('const url = "https://x.test"; // after\n/* a\n b */ const c = `// no`;\n');
  assert.deepEqual(
    comments.map((c) => [c.line, c.text.trim()]),
    [
      [1, "// after"],
      [2, "/* a"],
      [3, "b */"],
    ],
  );
});
