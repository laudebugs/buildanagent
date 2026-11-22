// A host process for the signal tests: it connects one stdio server, prints `ready <server pid>`, and waits to be
// signalled.
//   signal-host.ts <mode> <raw-server.ts path> <scenario>
// The scenario is the raw server's: `ignore-term` ignores SIGTERM and its closed input, `report-pid` exits when its
// input ends. The modes:
//   plain           adds no listener and does not opt in, so SIGTERM ends the host by Node's default
//   opt-in          calls killMcpServersOnSignal()
//   lib-before      registers a listener that re-raises only when it is alone, as `signal-exit` does, then opts in
//   lib-after       opts in, then registers that listener
//   own-handler     listens for SIGTERM itself and closes the connection before it exits
import { connectMcpServer, killMcpServersOnSignal } from "@buildanagent/harness/mcp";

const [mode, script, scenario] = process.argv.slice(2);

/** What `signal-exit` does: on a signal, when it is the only listener left, remove itself and raise the signal again. */
function signalExitLike(): void {
  const listener = (signal: NodeJS.Signals) => {
    if (process.listeners(signal).length === 1) {
      process.removeListener(signal, listener);
      process.kill(process.pid, signal);
    }
  };
  process.on("SIGTERM", listener);
}

if (mode === "lib-before") signalExitLike();
if (mode === "opt-in" || mode === "lib-before" || mode === "lib-after") killMcpServersOnSignal();
if (mode === "lib-after") signalExitLike();

const connection = await connectMcpServer({
  name: "server",
  transport: {
    kind: "stdio",
    command: process.execPath,
    args: ["--import", "tsx", script as string, "legacy", scenario as string],
    closeGraceMs: 200,
  },
});
if (mode === "own-handler") {
  process.on("SIGTERM", () => {
    void connection.close().then(() => process.exit(0));
  });
}
const [block] = (await connection.callTool("echo", {}, new AbortController().signal)).content;
const { pid } = JSON.parse(block?.type === "text" ? block.text : "{}") as { pid: number };
process.stdout.write(`ready ${pid}\n`);
setInterval(() => {}, 1000);
