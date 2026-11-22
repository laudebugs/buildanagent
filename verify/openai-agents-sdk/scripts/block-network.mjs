// Preloaded with `node --import` for our own examples, which run without scripted-preload.mjs. It rejects every
// non-loopback connection, so an example that accidentally opens a real realtime session (a WebSocket) or calls
// `fetch` fails offline instead of reaching a real API. Sockets are blocked in `net.Socket#connect`, which both
// `tls.connect` and the `ws` package the realtime WebSocket transport uses go through.
import net from "node:net";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const blocked = (host) => new Error(`verify harness: network disabled (blocked ${host})`);

const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  return LOOPBACK.has(url.hostname) ? realFetch(input, init) : Promise.reject(blocked(url.hostname));
};

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = args[0];
  // connect(options), connect(port, host), connect(path); a path is a local socket and stays allowed.
  const host = Array.isArray(first)
    ? first[0]?.host
    : typeof first === "object" && first !== null
      ? first.host
      : args[1];
  const isPath = typeof first === "string" && Number.isNaN(Number(first));
  const target =
    typeof first === "object" && first !== null && "path" in first
      ? undefined
      : isPath
        ? undefined
        : (host ?? "localhost");
  if (target !== undefined && !LOOPBACK.has(String(target))) {
    const error = blocked(String(target));
    queueMicrotask(() => this.destroy(error));
    return this;
  }
  return realConnect.apply(this, args);
};
