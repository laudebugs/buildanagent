// Chapter 1's isometric centerpiece: the agent loop as a bench the reader steps through. The context is a rack of
// message cards, the model call a round unit, the tool a block, and two trays catch what comes out: the tool_result
// card, which is appended to the rack as a new card, and the final answer. Each step lights one part, in the order the
// AI SDK's tool loop in this chapter runs them: context out, a model call that asks for a tool, the tool, its
// tool_result, the append, then a second model call that answers with text and stops the loop.
import { audit, IsoFigure, IsoParts, kit, type Plan } from "../lib/isokit.js";

const WIDTH = 520;
const HEIGHT = 330;

const PLATE: Plan = { x: -142, y: -72, w: 248, d: 150, r: 8 };
const PLATE_H = 8;
const FOOT_H = 4;
const STRIP: Plan = { x: -126, y: 64, w: 216, d: 8, r: 1 };

// The context rack: a low tray holding upright message cards, with a free slot where the appended card stands.
const RACK: Plan = { x: -128, y: -60, w: 64, d: 58, r: 2 };
const RACK_H = 3;
const CARD_D = 30;
const CARD_W = 2;
const CARD_H = 24;
const CARDS = [-120, -111, -102];
const APPENDED = -90;

// The model call: a round unit with a cap and a lamp.
const MODEL: [number, number] = [-22, -33];
const MODEL_R = 22;
const MODEL_H = 20;
const CAP_R = 13;
const CAP_H = 5;

// The tool: a block with a dial knob on top.
const TOOL: Plan = { x: 28, y: -54, w: 58, d: 40, r: 3 };
const TOOL_H = 16;

// Two trays on the front row, each holding one card: the tool's result and the model's final answer.
const ANSWER_TRAY: Plan = { x: -50, y: 10, w: 52, d: 28, r: 2 };
const RESULT_TRAY: Plan = { x: 30, y: 10, w: 56, d: 28, r: 2 };
const TRAY_H = 2.4;
const SLIP_H = 1.2;

const LAMP_R = 3.2;
const LAMP_H = 2;

/** The loop's steps in order: the part each one lights and the readout it shows. */
const STEPS = [
  { part: "context", readout: "1/6 · context to model call" },
  { part: "model", readout: "2/6 · model call: tool call" },
  { part: "tool", readout: "3/6 · tool: weather runs" },
  { part: "result", readout: "4/6 · tool result: 21C" },
  { part: "append", readout: "5/6 · append to context" },
  { part: "answer", readout: "6/6 · model call: text, stop" },
] as const;
// Each lit part has an id, which the inliner prefixes when a page shows the figure twice, as the gallery does.
const step = (index: number): Record<string, string> => ({
  id: `loop-bench--step-${STEPS[index]?.part}`,
  "data-iso-step": String(index),
  "data-iso-readout": STEPS[index]?.readout ?? "",
});

export default function draw(): IsoFigure {
  const P = kit.fitProjection(
    [...kit.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [MODEL[0], MODEL[1], MODEL_H + CAP_H + LAMP_H]],
    WIDTH,
    HEIGHT,
    { pad: 16 },
  );
  const R = audit.recorder(P);
  const parts = new IsoParts(P, R);

  // The bench: feet, a plate with a groove, corner screws, the station labels and a ruler strip along the front.
  for (const [index, [x, y]] of kit.corners(PLATE, 16).entries()) {
    parts.cylinder(`stand.foot#${index + 1}`, [x, y], 6, -PLATE_H - FOOT_H, FOOT_H, { tone: "lo" });
  }
  const screws = kit.corners(PLATE, 8);
  const ticks = kit.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y + 0.8, 0.6, [1.8, 3.4], P);
  parts.slab("stand.plate", PLATE, -PLATE_H, PLATE_H, {
    tone: "mid",
    bevel: 1.2,
    marks: [
      kit.lineSvg(kit.planOutline(kit.insetPlan(PLATE, 5), 0, P), { tone: "faint" }),
      kit.lineSvg(screws.map(([x, y]) => kit.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }),
      parts.label("context", [RACK.x, RACK.y + RACK.d + 14], 0),
      parts.label("model call", [MODEL[0] - MODEL_R - 2, MODEL[1] + MODEL_R + 12], 0),
      parts.label("tool", [TOOL.x + 2, TOOL.y + TOOL.d + 12], 0),
      parts.label("answer", [ANSWER_TRAY.x, ANSWER_TRAY.y + ANSWER_TRAY.d + 10], 0),
      parts.label("tool_result", [RESULT_TRAY.x, RESULT_TRAY.y + RESULT_TRAY.d + 10], 0),
      kit.dotsSvg(
        screws.map(([x, y]) => kit.iso([x, y, 0], P)),
        { size: 0.5 },
      ),
    ].join(""),
  });
  parts.slab("strip", STRIP, 0, 0.6, {
    tone: "lo",
    marks: kit.lineSvg(ticks.minor, { tone: "lo" }) + kit.lineSvg(ticks.major, { tone: "mid" }),
  });

  // The context rack and its cards. The appended card stands in the rack's last slot.
  parts.slab("context.rack", RACK, 0, RACK_H, {
    tone: "mid",
    bevel: 0.6,
    marks: [
      kit.lineSvg(kit.planOutline(kit.insetPlan(RACK, 2), RACK_H, P), { tone: "faint" }),
      parts.label("append", [RACK.x + 8, RACK.y + RACK.d - 4], RACK_H),
    ].join(""),
  });
  for (const [index, x] of CARDS.entries()) {
    parts.slab(`context.card#${index + 1}`, { x, y: RACK.y + 6, w: CARD_W, d: CARD_D, r: 0.4 }, RACK_H, CARD_H, {
      tone: "hi",
    });
  }
  parts.slab("context.appended", { x: APPENDED, y: RACK.y + 6, w: CARD_W, d: CARD_D, r: 0.4 }, RACK_H, CARD_H, {
    tone: "hi",
    attributes: step(4),
  });
  parts.cylinder("context.lamp", [RACK.x + RACK.w - 7, RACK.y + 6], LAMP_R, RACK_H, LAMP_H, {
    tone: "hi",
    lit: true,
    attributes: step(0),
  });

  // The model call.
  parts.cylinder("model.base", MODEL, MODEL_R + 3, 0, 2, { tone: "lo" });
  parts.cylinder("model.body", MODEL, MODEL_R, 2, MODEL_H - 2, { tone: "hi", bevel: 1 });
  parts.cylinder("model.cap", MODEL, CAP_R, MODEL_H, CAP_H, { tone: "mid", bevel: 0.6 });
  parts.cylinder("model.lamp", MODEL, LAMP_R, MODEL_H + CAP_H, LAMP_H, { tone: "hi", attributes: step(1) });

  // The tool: a block, a dial knob and a lamp.
  parts.slab("tool.block", TOOL, 0, TOOL_H, {
    tone: "hi",
    bevel: 0.8,
    marks: kit.lineSvg(kit.planOutline(kit.insetPlan(TOOL, 4), TOOL_H, P), { tone: "faint" }),
  });
  parts.cylinder("tool.knob", [TOOL.x + 18, TOOL.y + 20], 7, TOOL_H, 4, { tone: "mid", bevel: 0.6 });
  parts.cylinder("tool.lamp", [TOOL.x + TOOL.w - 9, TOOL.y + 9], LAMP_R, TOOL_H, LAMP_H, {
    tone: "hi",
    attributes: step(2),
  });

  // The two trays and their cards.
  for (const [name, tray, index] of [
    ["result", RESULT_TRAY, 3],
    ["answer", ANSWER_TRAY, 5],
  ] as const) {
    parts.slab(`${name}.tray`, tray, 0, TRAY_H, {
      tone: "mid",
      bevel: 0.4,
      marks: kit.lineSvg(kit.planOutline(kit.insetPlan(tray, 2), TRAY_H, P), { tone: "faint" }),
    });
    parts.slab(`${name}.card`, kit.insetPlan(tray, 6), TRAY_H, SLIP_H, { tone: "hi", attributes: step(index) });
  }

  return new IsoFigure({
    id: "loop-bench",
    width: WIDTH,
    height: HEIGHT,
    title: "Agent loop",
    hint: "One part lights per step",
    readout: STEPS[0].readout,
    projection: P,
    recorder: R,
  });
}
