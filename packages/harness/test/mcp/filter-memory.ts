// Run as a script with --expose-gc: feeds the guarded fetch one open event-stream line as one-byte chunks, as a
// server's chunked encoding can, and prints how many bytes the filter retains, after a full collection:
//   filter-memory.ts <line bytes>
import { guardedFetch } from "../../src/mcp/guarded-fetch.js";
import { checkRemoteTransport } from "../../src/mcp/remote-config.js";

const bytes = Number(process.argv[2]);
const settings = checkRemoteTransport({ kind: "http", url: "https://mcp.example.test/mcp" });
let sent = 0;
const one = new Uint8Array([0x61]);
let reachedEnd: () => void = () => {};
const reached = new Promise<void>((resolve) => {
  reachedEnd = resolve;
});
const body = new ReadableStream<Uint8Array>({
  pull(controller) {
    // A pull past the line's last byte means the filter holds all of it: measure then, with the line still open.
    if (sent >= bytes) {
      reachedEnd();
      return new Promise(() => {});
    }
    for (let index = 0; index < 4096 && sent < bytes; index += 1, sent += 1) controller.enqueue(one.slice());
    return undefined;
  },
});
const gc = (globalThis as { gc?: () => void }).gc as () => void;
const fetch = guardedFetch(
  async () => new Response(body, { headers: { "content-type": "text/event-stream" } }),
  settings,
  { log: () => {} },
);
gc();
const before = process.memoryUsage();
const response = await fetch("https://mcp.example.test/mcp", { method: "GET" });
void response.body?.getReader().read();
await reached;
gc();
gc();
const after = process.memoryUsage();
const retained = after.heapUsed + after.arrayBuffers - (before.heapUsed + before.arrayBuffers);
process.stdout.write(`${retained}\n`);
process.exit(0);
