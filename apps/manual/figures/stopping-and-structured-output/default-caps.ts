// Chapter 4's figure of the SDKs' default caps on one logarithmic scale of model calls. The values are the defaults
// in the harness pins of November 2026: generateText's isStepCount(1), which is also streamText's default and so
// AIChatAgent's when the streamText call your onChatMessage makes sets no stopWhen, OpenAI's maxTurns of 10,
// Cloudflare Think's maxSteps of 10, LangChain's recursion limit of 25 super-steps (13 model calls in
// verify/langchain/examples/06-recursion-limit.ts), ToolLoopAgent's isStepCount(20) and ADK's maxLlmCalls of 500.
import { Figure } from "../lib/svgkit.js";

const LEFT = 40;
const RIGHT = 480;
const AXIS = 170;
const MAX = 500;

/** Where a number of model calls sits on the logarithmic scale. */
function at(calls: number): number {
  return LEFT + ((RIGHT - LEFT) * Math.log(calls)) / Math.log(MAX);
}

export default function draw(): Figure {
  const figure = new Figure({ id: "default-caps", width: 520, height: 280 });

  figure.group("axis", () => {
    figure.line(
      [
        { x: LEFT, y: AXIS },
        { x: RIGHT, y: AXIS },
      ],
      { tone: "muted" },
    );
    for (const tick of [1, 10, 100, 500]) {
      figure.line(
        [
          { x: at(tick), y: AXIS + 4 },
          { x: at(tick), y: AXIS + 9 },
        ],
        { tone: "muted" },
      );
      figure.text({ x: at(tick), y: AXIS + 24 }, String(tick), { tone: "muted" });
    }
    figure.text({ x: 260, y: AXIS + 46 }, "model calls before the default cap fires (log scale)", { tone: "muted" });
  });

  figure.group("caps", () => {
    // Each label sits on its own row, left-aligned on its mark and higher for marks further left, so no leader
    // line crosses another mark's label. ADK's label ends on its mark instead, at the scale's right end.
    const caps = [
      { calls: 1, row: 146, label: "AIChatAgent: 1", anchor: "start" },
      { calls: 10, row: 40, label: "OpenAI run() and Think: 10", anchor: "start" },
      { calls: 13, row: 72, label: "LangChain createAgent: 13", anchor: "start" },
      { calls: 20, row: 104, label: "ToolLoopAgent: 20", anchor: "start" },
      { calls: 500, row: 136, label: "Google ADK: 500", anchor: "end" },
    ] as const;
    // The mark at 1 serves two entry points, so its label takes two lines to stay clear of the leader lines at 10,
    // 13 and 20.
    figure.text({ x: at(1), y: 130 }, "generateText and", { anchor: "start", tone: "text" });
    for (const cap of caps) {
      const x = at(cap.calls);
      figure.text({ x, y: cap.row }, cap.label, { anchor: cap.anchor, tone: "text" });
      figure.line(
        [
          { x, y: cap.row + 6 },
          { x, y: AXIS - 5 },
        ],
        { tone: "muted", dashed: true },
      );
      figure.dot({ x, y: AXIS }, 4, "terracotta");
    }
  });

  figure.group("uncapped", () => {
    figure.box(
      { x: 24, y: 232, width: 472, height: 36 },
      { label: "no default cap: Pi, Claude Agent SDK; none exposed: Copilot SDK", tone: "accent" },
    );
  });

  return figure;
}
