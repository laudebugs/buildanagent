// A payment server for the book's write examples, on loopback. It writes once for each idempotency key, declines one
// order with a 402, and answers a lookup GET with whether it has written for a key. It also logs every POST it
// receives, including repeats under the same key, apart from the keys it wrote for, so a second request cannot hide.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** The order the server declines. */
export const DECLINED_ORDER = 13;
const OK = 200;
const DECLINED = 402;
const NOT_FOUND = 404;

/** A running payment server and what it has seen. */
export interface FakePayments {
  readonly base: string;
  /** Each key the server wrote for, once. */
  readonly writes: Set<string>;
  /** Every write request (POST) that reached the server, in order; lookups are not counted. */
  readonly posts: { key: string; order: number }[];
  close(): Promise<void>;
}

/** Starts the server on a free loopback port. */
export async function startFakePayments(): Promise<FakePayments> {
  const writes = new Set<string>();
  const posts: { key: string; order: number }[] = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET") {
      // The lookup: has the server written for this key?
      response.writeHead(writes.has(request.url?.slice(1) ?? "") ? OK : NOT_FOUND).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk as Buffer);
    const { order } = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { order: number };
    const key = String(request.headers["idempotency-key"] ?? "");
    posts.push({ key, order });
    if (order !== DECLINED_ORDER) writes.add(key);
    response.writeHead(order === DECLINED_ORDER ? DECLINED : OK).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const close = async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  };
  return { base, writes, posts, close };
}
