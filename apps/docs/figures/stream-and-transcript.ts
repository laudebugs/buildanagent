// How one model answer becomes part of the transcript. The gateway streams the answer as a start event, block events
// (`text_start`, `text_delta`, `text_end` and the same for reasoning and tool input) and one terminal event, `done` or
// `error`, that carries the whole assistant message (packages/gateway/src/spec.ts, `ModelEvent`). The run appends that
// message to the transcript, beside the user messages and the tool results (packages/sdk/src/loop.ts, `record()` and
// `recordResult()`). Drawn 320 wide so it fits a 390 px phone whole.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const HEIGHT = 36;
const box = (x: number, y: number, width: number): Rect => ({ x, y, width, height: HEIGHT });

export default function draw(): Figure {
  const figure = new Figure({ id: "stream-and-transcript", width: 320, height: 248 });

  // The stream: three kinds of event, in the order they arrive.
  const start = figure.box(box(8, 16, 64), { label: "start" });
  const blocks = figure.box(box(88, 16, 112), { label: "block events" });
  const terminal = figure.box(box(216, 16, 96), { label: "done|error", tone: "accent" });
  figure.connect(start, blocks);
  figure.connect(blocks, terminal);

  // The terminal event carries the finished message, which is the one entry the stream adds to the transcript.
  const assistant = figure.box(box(216, 96, 96), { label: "assistant" });
  figure.connect(terminal, assistant, { tone: "accent" });
  figure.text({ x: 256, y: 78 }, "carries", { anchor: "end", tone: "accent" });

  // The other two kinds of message in a transcript.
  const user = figure.box(box(8, 96, 64), { label: "user" });
  const result = figure.box(box(88, 96, 112), { label: "tool result" });

  // The transcript holds all three kinds, in order.
  const transcript = figure.box({ x: 8, y: 184, width: 304, height: 48 }, { label: "transcript", tone: "accent" });
  figure.connect(user, transcript);
  figure.connect(result, transcript);
  figure.connect(assistant, transcript, { tone: "accent" });
  return figure;
}
