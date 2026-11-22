// The example side of a proxied live run (proxy.mjs). The Claude Agent SDK's CLI and the Copilot SDK's runtime run in
// a network namespace that has only its own loopback interface, so they can't reach the provider, or anything else.
// This file runs inside that namespace, in the example's process: it listens on the namespace's loopback interface
// and copies each connection, byte for byte, to the Unix socket that the runner's proxy listens on outside it. A
// socket is a file, so it crosses the namespace boundary that a TCP port can't. The forwarder holds no key and reads
// no request: the proxy does both.
import { createConnection, createServer } from "node:net";

/**
 * The key the CLI or runtime is given in place of the real one, which the proxy discards. It matches no key shape, so
 * redaction leaves it alone.
 */
export const PLACEHOLDER_KEY = "live-proxy-placeholder-not-a-key";

/** Starts the forwarder; resolves with the http:// base URL to give the CLI or runtime in place of the provider's. */
export async function startForwarder(socket) {
  if (!socket) throw new Error("live mode: LIVE_PROXY_SOCKET is not set");
  const server = createServer((client) => {
    const upstream = createConnection(socket);
    client.pipe(upstream).pipe(client);
    const stop = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", stop);
    upstream.on("error", stop);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  // The forwarder must not keep the example's process alive once the example is done.
  server.unref();
  return `http://127.0.0.1:${server.address().port}`;
}
