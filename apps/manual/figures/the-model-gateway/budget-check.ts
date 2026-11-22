// The model gateway chapter's figure of a pre-call budget check against a projected cost. The amounts are the refused
// call of verify/vercel-ai-sdk/examples/12-retries-caching-budget.ts: $0.0114 already spent, $0.0249 projected for the
// next call and a budget of $0.03. The call fits the budget alone and not on top of the spend, so it is refused before
// it is sent. One dollar is drawn 11,000 units wide.
import { Figure } from "../lib/svgkit.js";

const LEFT = 20;
const PER_DOLLAR = 11000;
const at = (dollars: number) => LEFT + Math.round(dollars * PER_DOLLAR);

export default function draw(): Figure {
  const figure = new Figure({ id: "budget-check", width: 520, height: 230 });

  figure.box({ x: LEFT, y: 80, width: at(0.0114) - LEFT, height: 56 }, { label: ["spent", "$0.0114"] });
  figure.box(
    { x: at(0.0114), y: 80, width: at(0.0363) - at(0.0114), height: 56 },
    { label: ["projected", "$0.0249"], tone: "accent", dashed: true },
  );

  figure.group("budget-line", () => {
    figure.line(
      [
        { x: at(0.03), y: 50 },
        { x: at(0.03), y: 160 },
      ],
      { tone: "text", dashed: true },
    );
    figure.text({ x: at(0.03) + 8, y: 40 }, "budget $0.0300", { tone: "text" });
  });

  figure.group("verdict", () => {
    figure.text({ x: 260, y: 188 }, "spent + projected = $0.0363, over the budget", { tone: "accent" });
    figure.text({ x: 260, y: 212 }, "the call is refused before it is sent", { tone: "muted" });
  });

  return figure;
}
