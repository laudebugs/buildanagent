// A host process for the signal tests: it connects one stdio server that ignores SIGTERM and its closed input, prints
// `ready <server pid>`, and waits to be signalled.
//   signal-host.ts <plain|own-handler> <raw-server.ts path>
// `plain` adds no signal listener, so the harness's handler is the only one. `own-handler` listens for SIGTERM itself
// and closes the connection before it exits, as a host that handles its own signals must.
import { readFileSync } from "node:fs";
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
    // The harness must leave the server to this host: exit 3 says it was killed before the host could close it.
    // A killed child stays a zombie until this process reaps it, so its state is read from /proc.
    let running = false;
    try {
      running = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] !== "Z";
    } catch {
      running = false;
    }
    void connection.close().then(() => process.exit(running ? 0 : 3));
  });
}
process.stdout.write(`ready ${pid}\n`);
setInterval(() => {}, 1000);
