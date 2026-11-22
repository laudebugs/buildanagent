// Chapter 25's flat figure of pass@k against pass^k on the same results: an agent that succeeds on 75% of single
// attempts looks better and better under pass@k as k grows, and worse and worse under pass^k. The values are computed
// from the per-attempt rate p: pass@k = 1 - (1 - p)^k and pass^k = p^k.
import { Figure } from "../lib/svgkit.js";

const RATE = 0.75;
const KS = [1, 2, 3, 4, 5] as const;
const BAR = 170;

export default function draw(): Figure {
  const figure = new Figure({ id: "pass-k", width: 520, height: 270 });

  figure.text({ x: 120, y: 14 }, "pass@k: any one of k succeeds", { tone: "muted" });
  figure.text({ x: 360, y: 14 }, "pass^k: all k succeed", { tone: "accent" });

  for (const [index, k] of KS.entries()) {
    const y = 28 + index * 42;
    const atK = 1 - (1 - RATE) ** k;
    const allK = RATE ** k;
    figure.text({ x: 14, y: y + 14 }, `k=${k}`, { tone: "muted" });
    const left = figure.box({ x: 40, y, width: Math.round(BAR * atK), height: 28 });
    figure.text({ x: left.x + left.width + 30, y: y + 14 }, `${(atK * 100).toFixed(1)}%`);
    const right = figure.box({ x: 290, y, width: Math.round(BAR * allK), height: 28 }, { tone: "accent" });
    figure.text({ x: right.x + right.width + 30, y: y + 14 }, `${(allK * 100).toFixed(1)}%`, { tone: "accent" });
  }

  figure.text({ x: 260, y: 252 }, "75% per attempt: pass^3 is 42%, pass@3 is 98%", { tone: "muted" });

  return figure;
}
