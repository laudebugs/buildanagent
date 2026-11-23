// The six published packages and how they depend on each other, read from each package.json's `dependencies` on
// another @buildanagent package (the private evals package is left out). The figure draws the shortest picture of that
// graph: an arrow for each dependency that no longer chain of arrows already implies, so the stack reads top to
// bottom. The page beside it lists every dependency, the implied ones included. At 320 wide it fits a 390 px phone
// whole.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const LEFT = 8;
const RIGHT = 166;
const COLUMN = 146;
const WIDE = RIGHT + COLUMN - LEFT;
const HEIGHT = 36;
const ROWS = [16, 88, 160, 232, 304] as const;

const row = (index: 0 | 1 | 2 | 3 | 4): number => ROWS[index];
const box = (x: number, y: number, width: number): Rect => ({ x, y, width, height: HEIGHT });

export default function draw(): Figure {
  const figure = new Figure({ id: "package-map", width: 320, height: 356 });

  const cli = figure.box(box(LEFT, row(0), WIDE), { label: "cli" });
  const harness = figure.box(box(LEFT, row(1), WIDE), { label: "harness" });
  const protocol = figure.box(box(LEFT, row(2), COLUMN), { label: "protocol" });
  const safety = figure.box(box(RIGHT, row(2), COLUMN), { label: "agent-safety" });
  const sdk = figure.box(box(LEFT, row(3), COLUMN), { label: "sdk" });
  const gateway = figure.box(box(LEFT, row(4), WIDE), { label: "gateway", tone: "accent" });

  // cli also imports protocol, sdk and gateway, harness also imports sdk and gateway, and protocol also imports
  // gateway: each of those is implied by the arrows below, so the figure leaves it to the page's list.
  figure.connect(cli, harness);
  figure.connect(harness, protocol);
  figure.connect(harness, safety);
  figure.connect(protocol, sdk);
  figure.connect(sdk, gateway);
  figure.connect(safety, gateway);
  return figure;
}
