// The protocol's clients (packages/protocol/README.md, "Over stdio, each message is one line"). A client is any program
// that writes JSON-RPC lines to a server's input and reads its output: an editor, a script or a program in another
// language. `buildanagent rpc` serves one client over its standard input and output and hands each command to the
// harness, which runs the sessions and the turns. The figure draws the clients once each and the one connection they
// share, 320 wide so it fits a 390 px phone whole.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const COLUMN = 96;
const XS = [8, 112, 216] as const;
const clientBox = (x: number): Rect => ({ x, y: 16, width: COLUMN, height: 44 });

export default function draw(): Figure {
  const figure = new Figure({ id: "protocol-clients", width: 320, height: 292 });

  const names = ["editor", "script", ["other", "language"]] as const;
  const server = figure.box(
    { x: 8, y: 108, width: 304, height: 64 },
    { label: ["buildanagent rpc", "one JSON-RPC message", "per line"], tone: "accent" },
  );
  names.forEach((name, index) => {
    const client = figure.box(clientBox(XS[index] ?? 0), { label: name });
    figure.connect(client, server);
  });

  const harness = figure.box({ x: 8, y: 228, width: 304, height: 48 }, { label: ["harness", "sessions and turns"] });
  figure.connect(server, harness);
  return figure;
}
