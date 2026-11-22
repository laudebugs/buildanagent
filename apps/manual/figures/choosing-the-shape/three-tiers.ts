// Chapter 8's flat figure: three tiers of loop ownership, with the eight SDKs this book verifies placed in them and
// the loop this book builds as the third tier's example. Tier one is a vendor's program that owns the loop, tier two
// is a loop that runs in your process, and tier three is a loop you own and can change.
import { Figure, type Rect } from "../lib/svgkit.js";

const COLUMN = 160;
const GAP = 10;
const BOX = { width: 140, height: 34 };
const TOP = 62;
const STEP = 44;

const centre = (column: number) => 10 + column * (COLUMN + GAP) + COLUMN / 2;

/** A box in a column, centred, on one of the rows. */
function cell(column: number, row: number): Rect {
  return { x: centre(column) - BOX.width / 2, y: TOP + row * STEP, ...BOX };
}

export default function draw(): Figure {
  const figure = new Figure({ id: "three-tiers", width: 520, height: 350 });

  figure.group("buy", () => {
    figure.text({ x: centre(0), y: 20 }, "Buy", { style: "heading" });
    figure.text({ x: centre(0), y: 40 }, "a vendor's program", { tone: "muted" });
    figure.box(cell(0, 0), { label: "Claude Agent SDK" });
    figure.box(cell(0, 1), { label: "Copilot SDK" });
  });

  figure.group("adopt", () => {
    figure.text({ x: centre(1), y: 20 }, "Adopt", { style: "heading" });
    figure.text({ x: centre(1), y: 40 }, "a library loop", { tone: "muted" });
    figure.box(cell(1, 0), { label: "OpenAI Agents SDK" });
    figure.box(cell(1, 1), { label: "Vercel AI SDK" });
    figure.box(cell(1, 2), { label: "LangChain.js" });
    figure.box(cell(1, 3), { label: "Google ADK" });
    figure.box(cell(1, 4), { label: "Pi" });
    figure.box(cell(1, 5), { label: "Cloudflare Agents" });
  });

  figure.group("build", () => {
    figure.text({ x: centre(2), y: 20 }, "Build", { style: "heading" });
    figure.text({ x: centre(2), y: 40 }, "a loop you own", { tone: "muted" });
    figure.box(cell(2, 0), { label: "@buildanagent/sdk", tone: "accent" });
  });

  figure.group("owners", () => {
    figure.line(
      [
        { x: 10, y: 322 },
        { x: 510, y: 322 },
      ],
      { tone: "muted", dashed: true },
    );
    figure.text({ x: centre(0), y: 342 }, "the vendor runs it", { tone: "muted" });
    figure.text({ x: centre(1), y: 342 }, "your code runs it", { tone: "muted" });
    figure.text({ x: centre(2), y: 342 }, "you change it", { tone: "accent" });
  });

  return figure;
}
