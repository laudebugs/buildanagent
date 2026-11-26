// How a sandboxed command reaches the web (packages/harness/README.md, "The egress proxy keeps every credential outside
// the sandbox"). The sandbox holds a placeholder and no credential. Its requests go to the egress proxy on the host,
// which reaches the hosts on its allowlist, swaps the placeholder for the secret that only the host holds on a route
// and refuses every other host. Drawn 320 wide so it fits a 390 px phone whole.
import { Figure, type Rect } from "@buildanagent/manual/figures/svgkit";

const HEIGHT = 56;
const wide = (y: number, height = HEIGHT): Rect => ({ x: 8, y, width: 304, height });

export default function draw(): Figure {
  const figure = new Figure({ id: "sandbox-egress", width: 320, height: 292 });

  const sandbox = figure.box(wide(16, 48), { label: ["sandbox", "holds a placeholder only"] });
  const proxy = figure.box(
    { x: 8, y: 112, width: 176, height: 64 },
    {
      label: ["egress proxy", "swaps in the secret", "refuses other hosts"],
      tone: "accent",
    },
  );
  const secrets = figure.box({ x: 208, y: 112, width: 104, height: 64 }, { label: ["secrets", "kept on the", "host"] });
  const allowed = figure.box({ x: 8, y: 224, width: 144, height: 48 }, { label: ["listed host"] });
  const refused = figure.box({ x: 168, y: 224, width: 144, height: 48 }, { label: ["other host"], dashed: true });

  figure.connect(sandbox, proxy);
  figure.connect(secrets, proxy);
  figure.connect(proxy, allowed);
  figure.connect(proxy, refused, { dashed: true });
  return figure;
}
