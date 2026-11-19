import assert from "node:assert/strict";
import { test } from "vitest";
import { numberChapters } from "../src/book/outline-rules.js";
import { outline } from "../src/outline.js";

test("the outline holds both parts and all eighteen chapters in the plan's reading order", () => {
  assert.deepEqual(
    outline.map((part) => [part.title, part.chapters.length]),
    [
      ["Part I: Foundations", 7],
      ["Part II: In depth", 11],
    ],
  );
  assert.deepEqual(
    numberChapters(outline).map(({ number, slug, opening }) => `${number} ${slug} ${opening}`),
    [
      "1 call-workflow-loop scenario",
      "2 talking-to-a-model code",
      "3 tools incident",
      "4 stopping-and-structured-output question",
      "5 memory-and-sessions analogy",
      "6 approvals-guardrails-and-injection fact",
      "7 testing-offline-and-a-first-agent scenario",
      "8 choosing-the-shape fact",
      "9 the-model-gateway code",
      "10 events-and-hooks question",
      "11 the-session-log-and-context analogy",
      "12 retrieval-and-long-term-memory scenario",
      "13 tools-at-scale fact",
      "14 permissions-sandboxes-and-credentials incident",
      "15 agents-people-can-watch question",
      "16 side-effects-that-can-fail incident",
      "17 durable-and-portable-agents code",
      "18 evals-observability-and-release analogy",
    ],
  );
});
