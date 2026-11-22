// A host process for the signal tests: it connects one stdio server that ignores SIGTERM and its closed input, prints
// `ready <server pid>`, and waits to be signalled.
//   signal-host.ts <plain|own-handler|noop-listener> <raw-server.ts path>
// `plain` adds no signal listener, so the harness's handler is the only one. `own-handler` listens for SIGTERM itself
// and closes the connection before it exits. `noop-listener` listens and does nothing, so the process stays up.
import { connectMcpServer } from "@buildanagent/harness/mcp";

const [mode, script] = process.argv.slice(2);
const connection = await connectMcpServer({
  name: "stubborn",
  transport: {
    kind: "stdio",
    command: process.execPath,
    args: ["--import", "tsx", script as string, "legacy", "ignore-term"],
    closeGraceMs: 200,
  },
});
const [block] = (await connection.callTool("echo", {}, new AbortController().signal)).content;
const { pid } = JSON.parse(block?.type === "text" ? block.text : "{}") as { pid: number };
if (mode === "own-handler") {
  process.on("SIGTERM", () => {
    void connection.close().then(() => process.exit(0));
  });
}
if (mode === "noop-listener") {
  // A listener that handles nothing, such as a logger's: the process stays up, and the harness must still end the server.
  process.on("SIGTERM", () => {});
}
process.stdout.write(`ready ${pid}\n`);
setInterval(() => {}, 1000);
