// Chapter 22's isometric centerpiece: the deny-first permission pipeline, the sandbox and its egress allowlist as one
// bench. A tool call enters at the left and passes six gates in the order the harness decides it: hooks, deny rules, ask
// rules, the mode, allow rules and the host callback. A call that survives becomes a command in the sandbox, a walled
// floor with a writable workspace and a read-only folder. The one door out of the sandbox leads to the egress proxy,
// which adds the secret from a vault on the host and forwards only to allowed hosts. Each step lights one part.
import { audit, IsoFigure, IsoParts, kit, type Plan } from "../lib/isokit.js";

const WIDTH = 520;
const HEIGHT = 340;

const PLATE: Plan = { x: -160, y: -78, w: 332, d: 158, r: 8 };
const PLATE_H = 8;
const FOOT_H = 4;

// The six gates stand in a row at the back, each a thin upright slab the call must pass.
const GATES = [
  { name: "hooks", x: -108 },
  { name: "deny", x: -70 },
  { name: "ask", x: -32 },
  { name: "mode", x: 6 },
  { name: "allow", x: 44 },
  { name: "callback", x: 82 },
] as const;
const GATE_Y = -66;
const GATE_W = 8;
const GATE_D = 26;
const GATE_H = 18;
const CALL: Plan = { x: -150, y: -58, w: 22, d: 14, r: 1 };
const CALL_H = 4;

// The sandbox: a walled floor on the front row with the command, a workspace and a read-only folder inside it.
const BOX: Plan = { x: -70, y: 6, w: 140, d: 70, r: 3 };
const BOX_H = 2;
const WALL = 3;
const WALL_H = 10;
const WORKSPACE: Plan = { x: -62, y: 36, w: 64, d: 16, r: 2 };
const READONLY: Plan = { x: -62, y: 56, w: 64, d: 16, r: 2 };
const SLAB_H = 2;
const COMMAND: [number, number] = [-40, 22];
const COMMAND_R = 11;
const COMMAND_H = 12;

// Outside the sandbox on the right: the vault, the egress proxy and the allowed hosts.
const VAULT: Plan = { x: 112, y: 8, w: 48, d: 18, r: 2 };
const VAULT_H = 14;
const PROXY: Plan = { x: 112, y: 34, w: 56, d: 18, r: 2 };
const PROXY_H = 10;
const HOSTS: Plan = { x: 112, y: 60, w: 54, d: 16, r: 2 };
const LANE: Plan = { x: 70, y: 36, w: 42, d: 8, r: 1 };
const HOSTS_H = 3;

const LAMP_R = 3;
const LAMP_H = 2;

/** The steps in order: the part each one lights and the readout it shows. */
const STEPS = [
  { part: "hooks", readout: "1/6 · hooks: may only deny or ask" },
  { part: "deny", readout: "2/6 · deny rules: a deny ends the call" },
  { part: "mode", readout: "3/6 · ask rules, mode, allow rules" },
  { part: "callback", readout: "4/6 · host callback or default" },
  { part: "command", readout: "5/6 · the command runs in the sandbox" },
  { part: "proxy", readout: "6/6 · the proxy adds the secret" },
] as const;
const step = (index: number): Record<string, string> => ({
  id: `permission-pipeline--step-${STEPS[index]?.part}`,
  "data-iso-step": String(index),
  "data-iso-readout": STEPS[index]?.readout ?? "",
});

export default function draw(): IsoFigure {
  const P = kit.fitProjection(
    [...kit.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [COMMAND[0], COMMAND[1], COMMAND_H + LAMP_H]],
    WIDTH,
    HEIGHT,
    { pad: 16 },
  );
  const R = audit.recorder(P);
  const parts = new IsoParts(P, R);

  // The bench: feet, a plate and the engraved labels. Gate labels alternate between two rows so none overlaps.
  for (const [index, [x, y]] of kit.corners(PLATE, 16).entries()) {
    parts.cylinder(`stand.foot#${index + 1}`, [x, y], 6, -PLATE_H - FOOT_H, FOOT_H, { tone: "lo" });
  }
  const gateLabels = GATES.map((gate, index) =>
    parts.label(gate.name, [gate.x - 6, GATE_Y + GATE_D + (index % 2 === 0 ? 11 : 24)], 0),
  );
  parts.slab("stand.plate", PLATE, -PLATE_H, PLATE_H, {
    tone: "mid",
    bevel: 1.2,
    marks: [
      kit.lineSvg(kit.planOutline(kit.insetPlan(PLATE, 5), 0, P), { tone: "faint" }),
      ...gateLabels,
      parts.label("call", [CALL.x, CALL.y + CALL.d + 11], 0),
    ].join(""),
  });

  // The call and the gates.
  parts.slab("call.card", CALL, 0, CALL_H, { tone: "hi", bevel: 0.4 });
  for (const gate of GATES) {
    const plan: Plan = { x: gate.x, y: GATE_Y, w: GATE_W, d: GATE_D, r: 1 };
    const lit = gate.name === "deny";
    parts.slab(`gate.${gate.name}`, plan, 0, GATE_H, { tone: lit ? "hi" : "mid", lit, bevel: 0.6 });
  }
  // One lamp on top of each lit gate.
  parts.cylinder("gate.hooks.lamp", [GATES[0].x + GATE_W / 2, GATE_Y + GATE_D / 2], LAMP_R, GATE_H, LAMP_H, {
    tone: "hi",
    attributes: step(0),
  });
  parts.cylinder("gate.deny.lamp", [GATES[1].x + GATE_W / 2, GATE_Y + GATE_D / 2], LAMP_R, GATE_H, LAMP_H, {
    tone: "hi",
    attributes: step(1),
  });
  parts.cylinder("gate.mode.lamp", [GATES[3].x + GATE_W / 2, GATE_Y + GATE_D / 2], LAMP_R, GATE_H, LAMP_H, {
    tone: "hi",
    attributes: step(2),
  });
  parts.cylinder("gate.callback.lamp", [GATES[5].x + GATE_W / 2, GATE_Y + GATE_D / 2], LAMP_R, GATE_H, LAMP_H, {
    tone: "hi",
    attributes: step(3),
  });

  // The sandbox: a floor, three walls with a door gap on the right, a workspace, a read-only folder and the command.
  parts.slab("box.floor", BOX, 0, BOX_H, {
    tone: "mid",
    bevel: 0.6,
    marks: [
      kit.lineSvg(kit.planOutline(kit.insetPlan(BOX, 4), BOX_H, P), { tone: "faint" }),
      parts.label("sandbox", [BOX.x + 56, BOX.y + 24], BOX_H, 12),
    ].join(""),
  });
  parts.slab("box.wall.back", { x: BOX.x, y: BOX.y, w: BOX.w, d: WALL, r: 0.4 }, BOX_H, WALL_H, { tone: "lo" });
  parts.slab("box.wall.left", { x: BOX.x, y: BOX.y + WALL, w: WALL, d: BOX.d - WALL, r: 0.4 }, BOX_H, WALL_H, {
    tone: "lo",
  });
  parts.slab(
    "box.wall.right.top",
    { x: BOX.x + BOX.w - WALL, y: BOX.y + WALL, w: WALL, d: 27, r: 0.4 },
    BOX_H,
    WALL_H,
    {
      tone: "lo",
    },
  );
  parts.slab("box.wall.right.bottom", { x: BOX.x + BOX.w - WALL, y: 46, w: WALL, d: 30, r: 0.4 }, BOX_H, WALL_H, {
    tone: "lo",
  });
  parts.slab("box.workspace", WORKSPACE, BOX_H, SLAB_H, {
    tone: "hi",
    bevel: 0.4,
    marks: parts.label("workspace", [WORKSPACE.x + 2, WORKSPACE.y + 12], BOX_H + SLAB_H, 12),
  });
  parts.slab("box.readonly", READONLY, BOX_H, SLAB_H, {
    tone: "mid",
    bevel: 0.4,
    marks: parts.label("read-only", [READONLY.x + 2, READONLY.y + 12], BOX_H + SLAB_H, 12),
  });
  parts.cylinder("box.command", COMMAND, COMMAND_R, BOX_H, COMMAND_H, { tone: "hi", bevel: 0.8 });
  parts.cylinder("box.command.lamp", COMMAND, LAMP_R, BOX_H + COMMAND_H, LAMP_H, {
    tone: "hi",
    attributes: step(4),
  });

  // Outside the sandbox: the one lane out of its door, the vault, the egress proxy with its lamp and the allowed hosts.
  parts.slab("stand.lane", LANE, 0, 0.6, { tone: "lo" });
  parts.slab("host.vault", VAULT, 0, VAULT_H, {
    tone: "mid",
    bevel: 0.8,
    marks: parts.label("vault", [VAULT.x + 3, VAULT.y + 13], VAULT_H, 12),
  });
  parts.slab("host.proxy", PROXY, 0, PROXY_H, {
    tone: "hi",
    bevel: 0.8,
    marks: parts.label("proxy", [PROXY.x + 3, PROXY.y + 13], PROXY_H, 12),
  });
  parts.cylinder("host.proxy.lamp", [PROXY.x + PROXY.w - 6, PROXY.y + PROXY.d / 2], LAMP_R, PROXY_H, LAMP_H, {
    tone: "hi",
    attributes: step(5),
  });
  parts.slab("host.allowed", HOSTS, 0, HOSTS_H, {
    tone: "mid",
    bevel: 0.4,
    marks: parts.label("allowed", [HOSTS.x + 3, HOSTS.y + 13], HOSTS_H, 12),
  });

  return new IsoFigure({
    id: "permission-pipeline",
    width: WIDTH,
    height: HEIGHT,
    title: "Permission pipeline",
    hint: "One part lights per step",
    readout: STEPS[0].readout,
    projection: P,
    recorder: R,
  });
}
