// Chapter 7's map of where each harness's mock model sits: as an object inside the process, behind a shim inside
// workerd, or as a mock HTTP API that a real CLI or runtime calls. The accent box in each row is the part that is mocked.
import { Figure } from "../lib/svgkit.js";

const COLUMNS = [20, 190, 360] as const;
const WIDTH = 140;
const HEIGHT = 44;

export default function draw(): Figure {
  const figure = new Figure({ id: "mock-seams", width: 520, height: 262 });

  /** One row: a heading, then three boxes joined by arrows, the last one mocked. */
  function row(name: string, y: number, heading: string, labels: readonly (readonly string[])[]) {
    figure.group(name, () => {
      figure.text({ x: 20, y: y - 8 }, heading, { tone: "muted", anchor: "start" });
      const boxes = labels.map((label, index) =>
        figure.box(
          { x: COLUMNS[index] ?? 0, y, width: WIDTH, height: HEIGHT },
          { label: [...label], tone: index === labels.length - 1 ? "accent" : "text" },
        ),
      );
      for (let index = 1; index < boxes.length; index += 1) {
        const from = boxes[index - 1];
        const to = boxes[index];
        if (from && to) figure.connect(from, to);
      }
    });
  }

  row("in-process", 34, "in your process: AI SDK, OpenAI, LangChain, Pi, ADK", [
    ["your code"],
    ["the SDK's loop"],
    ["a mock model", "object"],
  ]);
  row("workerd", 118, "inside workerd: Cloudflare", [["your agent class"], ["a provider shim"], ["a mock model"]]);
  row("http", 202, "over HTTP: Claude Agent SDK, Copilot SDK", [
    ["your code"],
    ["the real CLI", "or runtime"],
    ["a mock API on", "127.0.0.1"],
  ]);

  return figure;
}
