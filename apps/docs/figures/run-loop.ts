// One run of the SDK's loop (packages/sdk/src/loop.ts): the model is called, the tools it asks for run, their results
// go back to the next model call, and the run ends when the model answers without a tool call (`done`) or with another
// stop reason, such as `max_steps`, `budget`, `error` or `awaiting_approval`. The page beside the figure names every
// stop reason, so the figure keeps to the one cycle. It is drawn in two columns, 320 wide, so it fits a 390 px phone
// whole: the run on the left, the tools on the right.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const LEFT = 8;
const RIGHT = 202;
const COLUMN = 110;
const STEP = { y: 100, height: 70 };
const END = 230;

const box = (x: number, y: number, height = 40): Rect => ({ x, y, width: COLUMN, height });

export default function draw(): Figure {
  const figure = new Figure({ id: "run-loop", width: 320, height: 290 });

  const input = figure.box(box(LEFT, 16), { label: "input" });
  const model = figure.box(box(LEFT, STEP.y, STEP.height), { label: "model call", tone: "accent" });
  const tools = figure.box(box(RIGHT, STEP.y, STEP.height), { label: "run tools" });
  const done = figure.box(box(LEFT, END), { label: "done" });
  const stop = figure.box(box(RIGHT, END - 4, 48), {
    label: ["another", "stop reason"],
    tone: "muted",
    labelTone: "muted",
    dashed: true,
  });

  figure.connect(input, model);

  // The tool calls go right along the top of the step, their results come back left along its bottom: the cycle the
  // loop repeats.
  const [left, right] = [model.x + model.width, tools.x];
  figure.text({ x: (left + right) / 2, y: 112 }, "tool calls");
  figure.arrow({ x: left, y: 120 }, { x: right, y: 120 });
  figure.text({ x: (left + right) / 2, y: 148 }, "results", { tone: "accent" });
  figure.arrow({ x: right, y: 156 }, { x: left, y: 156 }, { tone: "accent" });

  // A text answer with no tool call ends the run `done`.
  const bottom = STEP.y + STEP.height;
  figure.arrow({ x: 40, y: bottom }, { x: 40, y: done.y });
  figure.text({ x: 48, y: 204 }, "text answer", { anchor: "start" });

  // Anything else that ends the run: a guard or a hook, a failed model call, an abort, or a tool call that waits for
  // approval or asks the user a question. The label names none of them, because the page lists all nine reasons.
  figure.arrow({ x: 280, y: bottom }, { x: 280, y: stop.y }, { tone: "muted", dashed: true });
  figure.text({ x: 272, y: 204 }, "another stop", { anchor: "end", tone: "muted" });
  return figure;
}
