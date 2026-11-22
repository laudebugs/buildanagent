// Harness self-check, not an SDK behavior: every example runs with an allowlisted environment, a
// temp HOME, and a network namespace whose only interface is loopback, so neither the example nor
// the Copilot runtime it spawns can reach GitHub or any other host.
import { lookup } from "node:dns/promises";
import { connect } from "node:net";
import { userInfo } from "node:os";
import { check } from "./lib/harness.ts";

const leaked = Object.keys(process.env).filter((k) => /TOKEN|KEY|SECRET|PROXY|GH_|GITHUB|COPILOT_PROVIDER/i.test(k));
check(
  leaked.length === 0,
  `no credential or proxy variables reach the example (found: ${leaked.join(", ") || "none"})`,
);
check(
  process.env.HOME !== userInfo().homedir && process.cwd().startsWith(process.env.HOME ?? "?"),
  `HOME is a temp dir, not the real home, and cwd is inside it (${process.env.HOME})`,
);

// #region network-check
const dial = (host: string, port: number) =>
  new Promise<string>((resolve) => {
    const s = connect({ host, port, timeout: 3000 });
    s.on("connect", () => {
      s.destroy();
      resolve("connected");
    });
    s.on("timeout", () => {
      s.destroy();
      resolve("timeout");
    });
    s.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? e.message));
  });
const outbound = await dial("140.82.112.3", 443); // a github.com address
check(outbound === "ENETUNREACH", `a raw TCP connection to a public address fails (${outbound})`); // book:note raw
const dns = await lookup("api.github.com").then(
  () => "resolved",
  (e: NodeJS.ErrnoException) => e.code ?? "error",
);
check(dns !== "resolved", `DNS lookups fail (${dns})`); // book:note dns
const blocked = await fetch("https://api.github.com").then(
  () => "fetched",
  (e: Error) => e.message,
);
check(blocked.includes("blocked fetch"), "the preload rejects non-local fetch()");
const local = await fetch(`${process.env.COPILOT_MOCK_URL}/v1/models`).then((r) => r.status);
check(local === 200, "loopback still works (the mock answers)"); // book:note loopback
// #endregion
