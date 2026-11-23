// An approval pause (packages/sdk/src/loop.ts, `pausedOutcome()`; the SDK README's approvals section). A gate asks for a
// call, the run ends `awaiting_approval` with a signed request and its context, a person answers, and `continueRun()`
// checks the answer against the signature and resumes from the stored context. Drawn 320 wide, in one column, so it
// fits a 390 px phone whole.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const WIDTH = 200;
const X = 60;
const box = (y: number, height = 40): Rect => ({ x: X, y, width: WIDTH, height });

export default function draw(): Figure {
  const figure = new Figure({ id: "approval-pause", width: 320, height: 352 });

  const ask = figure.box(box(16), { label: ["gate asks", "for a tool call"] });
  const ended = figure.box(box(88), { label: ["run ends", "awaiting_approval"], tone: "accent" });
  const stored = figure.box(box(160), { label: ["signed request", "and stored context"], tone: "muted", dashed: true });
  const person = figure.box(box(232), { label: ["a person", "allows or denies"] });
  const resumed = figure.box(box(304, 36), { label: "continueRun()" });

  figure.connect(ask, ended);
  figure.connect(ended, stored, { tone: "muted", dashed: true });
  figure.connect(stored, person, { tone: "muted", dashed: true });
  figure.connect(person, resumed);
  return figure;
}
