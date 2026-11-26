// A forked session (packages/harness/src/session/session.ts, `Session.fork()`; the harness README's "HEAD moves by
// entries" section). A session's log is a file of entries, each following the one before it. A fork writes a new file
// whose header names the parent file and the entry it starts from, so the fork reads the entries up to that point from
// the parent and copies none. The parent file is not touched. Drawn 320 wide so it fits a 390 px phone whole.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const HEIGHT = 56;
const parentBox = (y: number): Rect => ({ x: 8, y, width: 128, height: HEIGHT });
const forkBox = (y: number): Rect => ({ x: 184, y, width: 128, height: HEIGHT });

export default function draw(): Figure {
  const figure = new Figure({ id: "session-log", width: 320, height: 192 });
  figure.text({ x: 72, y: 20 }, "chat-1");
  figure.text({ x: 248, y: 20 }, "the fork");

  const first = figure.box(parentBox(32), { label: ["session header", "and turn 1"] });
  const second = figure.box(parentBox(120), { label: ["turn 2"] });
  const header = figure.box(forkBox(32), { label: ["fork header:", "parent chat-1,", "after turn 1"], tone: "accent" });
  const own = figure.box(forkBox(120), { label: ["new turn", "in the fork"], tone: "accent" });

  figure.connect(first, second);
  figure.connect(first, header, { tone: "accent", dashed: true });
  figure.connect(header, own, { tone: "accent" });
  return figure;
}
