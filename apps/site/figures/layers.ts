// Draws the landing page's figure twice: a wide drawing for desktop and a new, narrow one for phones. Every label is
// from src/landing/copy.ts, and every colour is a custom property the page sets, so light and dark share one file.
import { copy } from "../src/landing/copy.js";
import { Drawing, type Rect } from "./lib/draw.js";

const { labels, alt } = copy.figure;

/** The slab a layer is drawn as: an isometric block whose top is a diamond, `half` wide and `half / 2` high. */
interface Slab {
  readonly id: string;
  readonly cx: number;
  readonly top: number;
  readonly half: number;
  readonly thickness: number;
  readonly fill: string;
  readonly label: string;
}

function slabBox(slab: Slab): Rect {
  return { x: slab.cx - slab.half, y: slab.top, width: 2 * slab.half, height: slab.half + slab.thickness };
}

function drawSlab(drawing: Drawing, slab: Slab): void {
  const { cx, top, half, thickness } = slab;
  const mid = top + half / 2;
  const bottom = top + half;
  drawing.face(
    [
      [cx, top],
      [cx + half, mid],
      [cx, bottom],
      [cx - half, mid],
    ],
    slab.fill,
  );
  drawing.face(
    [
      [cx - half, mid],
      [cx, bottom],
      [cx, bottom + thickness],
      [cx - half, mid + thickness],
    ],
    "var(--bg)",
  );
  drawing.face(
    [
      [cx, bottom],
      [cx + half, mid],
      [cx + half, mid + thickness],
      [cx, bottom + thickness],
    ],
    "var(--bg)",
  );
  drawing.mark(slab.id, slabBox(slab));
  // Text on the accent slab takes the page colour, so it reads in both themes.
  const onAccent = slab.fill === "var(--a)";
  drawing.text(slab.label, cx, mid + 5, {
    anchor: "middle",
    fill: onAccent ? "var(--bg)" : "currentColor",
    on: slab.id,
  });
}

/** The three layers, top to bottom, as the page names them. */
const LAYERS = [
  { id: "harness", label: labels.harness, note: labels.harnessNote, fill: "var(--cell)" },
  { id: "loop", label: labels.loop, note: labels.loopNote, fill: "var(--a)" },
  { id: "gateway", label: labels.gateway, note: labels.gatewayNote, fill: "var(--cell)" },
] as const;

/** The wide figure: notes to the right of each slab, and one turn of the loop on the right. */
function wide(): Drawing {
  const drawing = new Drawing({ width: 900, height: 372, alt, className: "layers-wide" });
  LAYERS.forEach((layer, index) => {
    const slab: Slab = { ...layer, cx: 210, top: 10 + index * 120, half: 90, thickness: 20 };
    drawSlab(drawing, slab);
    const mid = slab.top + slab.half / 2;
    drawing.line(`${layer.id}-tick`, [
      [310, mid],
      [330, mid],
    ]);
    drawing.text(layer.note, 338, mid + 5);
  });
  // One turn of the loop: the model call hands off to tool calls, and the results go back to the model.
  const callBox = { x: 612, y: 120, width: 110, height: 46 };
  const toolBox = { x: 762, y: 120, width: 110, height: 46 };
  drawing.box("model-call", callBox);
  drawing.box("tool-calls", toolBox);
  drawing.text(labels.modelCall, 667, 148, { anchor: "middle", on: "model-call" });
  drawing.text(labels.toolCalls, 817, 148, { anchor: "middle", on: "tool-calls" });
  drawing.line(
    "call-to-tools",
    [
      [722, 143],
      [752, 143],
    ],
    2.5,
  );
  drawing.head("call-to-tools-head", [760, 143], "right");
  drawing.line(
    "tools-to-call",
    [
      [817, 166],
      [817, 220],
      [667, 220],
      [667, 176],
    ],
    2.5,
  );
  drawing.head("tools-to-call-head", [667, 168], "up");
  drawing.text(labels.results, 742, 246, { anchor: "middle" });
  return drawing;
}

/** The narrow figure: each note under its slab, then the loop turn as two rows, for a phone at 330 px. */
function narrow(): Drawing {
  const drawing = new Drawing({ width: 330, height: 568, alt, className: "layers-narrow" });
  LAYERS.forEach((layer, index) => {
    const slab: Slab = { ...layer, cx: 165, top: 6 + index * 138, half: 84, thickness: 20 };
    drawSlab(drawing, slab);
    drawing.text(layer.note, 165, slab.top + 124, { anchor: "middle" });
  });
  const callBox = { x: 20, y: 440, width: 120, height: 44 };
  const toolBox = { x: 190, y: 440, width: 120, height: 44 };
  drawing.box("model-call", callBox);
  drawing.box("tool-calls", toolBox);
  drawing.text(labels.modelCall, 80, 467, { anchor: "middle", on: "model-call" });
  drawing.text(labels.toolCalls, 250, 467, { anchor: "middle", on: "tool-calls" });
  drawing.line(
    "call-to-tools",
    [
      [140, 462],
      [172, 462],
    ],
    2.5,
  );
  drawing.head("call-to-tools-head", [190, 462], "right");
  drawing.line(
    "tools-to-call",
    [
      [250, 484],
      [250, 524],
      [80, 524],
      [80, 494],
    ],
    2.5,
  );
  drawing.head("tools-to-call-head", [80, 486], "up");
  drawing.text(labels.results, 165, 552, { anchor: "middle" });
  return drawing;
}

/** The two drawings, each with the file it is committed as, relative to apps/site. */
export function layers(): { readonly path: string; readonly drawing: Drawing }[] {
  return [
    { path: "src/landing/layers-wide.svg", drawing: wide() },
    { path: "src/landing/layers-narrow.svg", drawing: narrow() },
  ];
}
