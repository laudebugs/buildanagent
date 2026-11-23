import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "vitest";
import { type CopyButton, type CopyEnvironment, STATUS, wireCopyButton } from "../src/components/copy-markdown.js";

// The button's behaviour with fakes for the browser: what matters is that the clipboard write starts inside the click,
// before anything awaits, because Safari allows it only there.
class FakeBlob {
  readonly parts: string[];
  readonly options: { type: string };
  constructor(parts: string[], options: { type: string }) {
    this.parts = parts;
    this.options = options;
  }
}
class FakeItem {
  readonly items: Record<string, Promise<unknown>>;
  constructor(items: Record<string, Promise<unknown>>) {
    this.items = items;
  }
}

function setup(overrides: Partial<CopyEnvironment> = {}, twin = "/a.md") {
  const handlers: Record<string, () => void> = {};
  const said: string[] = [];
  const fetched: string[] = [];
  const written: unknown[][] = [];
  const texts: string[] = [];
  const env: CopyEnvironment = {
    fetch: async (url) => {
      fetched.push(url);
      return { ok: true, text: async () => "# The page\n" };
    },
    clipboard: {
      // A real clipboard rejects the write when a promise in its item rejects, so the fake waits for it.
      write: async (items) => {
        written.push(items);
        await Promise.all(Object.values((items[0] as FakeItem).items));
      },
      writeText: async (text) => {
        texts.push(text);
      },
    },
    ClipboardItem: FakeItem,
    Blob: FakeBlob,
    ...overrides,
  };
  const button: CopyButton = {
    dataset: { twin },
    addEventListener: (type, listener) => {
      handlers[type] = listener;
    },
    announce: (message) => {
      said.push(message);
    },
  };
  wireCopyButton(button, env);
  return { handlers, said, fetched, written, texts };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a click starts the clipboard write before it returns, with a promise that settles to a text/plain blob", async () => {
  const { handlers, written, said } = setup();
  handlers.click?.();
  assert.equal(written.length, 1, "the write started inside the click handler, before any await");
  const item = written[0]?.[0] as FakeItem;
  const blob = (await item.items["text/plain"]) as FakeBlob;
  assert.deepEqual(blob.parts, ["# The page\n"]);
  assert.equal(blob.options.type, "text/plain", "ClipboardItem needs a blob whose type is the key's");
  await settle();
  assert.deepEqual(said, [STATUS.copied]);
});

test("a refused write falls back to writeText with the text, and a refused fallback says the copy failed", async () => {
  const refuse = async () => {
    throw new Error("NotAllowedError");
  };
  const ok = setup({
    clipboard: { write: refuse, writeText: async () => {} },
  });
  ok.handlers.click?.();
  await settle();
  assert.deepEqual(ok.said, [STATUS.copied]);
  const bad = setup({ clipboard: { write: refuse, writeText: refuse } });
  bad.handlers.click?.();
  await settle();
  assert.deepEqual(bad.said, [STATUS.failed]);
});

test("without ClipboardItem the text a hover fetched ahead goes to writeText, and a failed fetch says so", async () => {
  const { handlers, texts, said, fetched } = setup({ ClipboardItem: undefined });
  handlers.pointerenter?.();
  await settle();
  handlers.click?.();
  await settle();
  assert.deepEqual(texts, ["# The page\n"]);
  assert.deepEqual(fetched, ["/a.md"], "one fetch serves the hover and the click");
  assert.deepEqual(said, [STATUS.copied]);
  const down = setup({ fetch: async () => ({ ok: false, text: async () => "" }) });
  down.handlers.click?.();
  await settle();
  assert.deepEqual(down.said, [STATUS.failed]);
});

test("a clipboard with no writeText says the copy failed, whether write was refused or missing", async () => {
  const refuse = async () => {
    throw new Error("NotAllowedError");
  };
  const refused = setup({ clipboard: { write: refuse } });
  refused.handlers.click?.();
  await settle();
  assert.deepEqual(refused.said, [STATUS.failed], "write refused and no writeText: nothing was copied");
  const noItem = setup({ ClipboardItem: undefined, clipboard: { write: refuse } });
  noItem.handlers.click?.();
  await settle();
  assert.deepEqual(noItem.said, [STATUS.failed]);
});

test("no clipboard at all says the copy failed, and a button with no twin address gets no handler", () => {
  const none = setup({ clipboard: undefined });
  none.handlers.click?.();
  assert.deepEqual(none.said, [STATUS.failed]);
  assert.deepEqual(Object.keys(setup({}, "").handlers), []);
});

test("the source starts the clipboard write inside the click handler, ahead of any await", () => {
  const source = readFileSync(new URL("../src/components/copy-markdown.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const handler = code.slice(code.indexOf('addEventListener("click"'));
  assert.ok(handler.length > 0, "found the click handler");
  const write = handler.indexOf("clipboard.write([");
  assert.ok(write > 0, "the click handler calls clipboard.write");
  assert.doesNotMatch(handler.slice(0, write), /\bawait\b|\basync\b|setTimeout|queueMicrotask/, "nothing waits first");
  assert.doesNotMatch(code, /\basync\s*\(\s*\)\s*=>\s*\{[^}]*clipboard/, "the click handler is not async");
});

test("PageTitle's script is static: it fetches no value from the build and splices none in", () => {
  const astro = readFileSync(new URL("../src/components/PageTitle.astro", import.meta.url), "utf8");
  const script = /<script>([\s\S]*?)<\/script>/.exec(astro)?.[1] ?? "";
  assert.ok(script.includes("wireCopyButton"));
  assert.doesNotMatch(astro, /define:vars|set:html|is:inline/);
  assert.doesNotMatch(script, /\{Astro|\$\{/);
});
