import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import type net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  compileEgressPolicy,
  type EgressProxy,
  type EgressRecord,
  GIT_MAX_COMMAND_BYTES,
  startEgressProxy,
} from "@buildanagent/harness/credentials";
import { spawnEnv } from "@buildanagent/harness/sandbox";
import { afterAll, beforeAll, test } from "vitest";

// A git route compiled from an EgressPolicy, in front of a fake GitHub: a real HTTPS server on loopback that speaks
// enough of git's smart HTTP protocol for a real `git push` to finish. The proxy resolves names through a table, so no
// test needs DNS, and git runs with an allowlisted environment that never holds the token.
const TOKEN = "ghs_installationtoken0123456789ABCDEFabcdef";
const EXISTING = "1".repeat(40);
const run = promisify(execFile);
const folders: string[] = [];
let upstream: https.Server;
let port = 0;
let proxy: EgressProxy;
let logs: EgressRecord[] = [];
let seen: { method: string; url: string; headers: IncomingHttpHeaders; body: Buffer }[] = [];

const pkt = (text: string) => `${(text.length + 4).toString(16).padStart(4, "0")}${text}`;

/** The refs the fake advertises for a push, and a report that every update went through. */
function answer(request: http.IncomingMessage, body: Buffer, response: http.ServerResponse): void {
  if (request.method === "GET" && request.url === "/owner/repo.git/info/refs?service=git-receive-pack") {
    response.writeHead(200, { "content-type": "application/x-git-receive-pack-advertisement" });
    response.end(
      `${pkt("# service=git-receive-pack\n")}0000${pkt(`${EXISTING} refs/heads/agent/old\0report-status delete-refs ofs-delta\n`)}0000`,
    );
    return;
  }
  if (request.method === "POST" && request.url === "/owner/repo.git/git-receive-pack") {
    const refs = [...body.toString("latin1").matchAll(/[0-9a-f]{40} [0-9a-f]{40} (refs\/[^\0\n]+)/g)].map((m) => m[1]);
    response.writeHead(200, { "content-type": "application/x-git-receive-pack-result" });
    response.end(`${pkt("unpack ok\n")}${refs.map((ref) => pkt(`ok ${ref}\n`)).join("")}0000`);
    return;
  }
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ok");
}

beforeAll(async () => {
  const folder = mkdtempSync(join(tmpdir(), "harness-git-route-"));
  folders.push(folder);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(folder, "key.pem"),
      "-out",
      join(folder, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=github.test",
      "-addext",
      "subjectAltName=DNS:github.test",
    ],
    { stdio: "ignore" },
  );
  const cert = readFileSync(join(folder, "cert.pem"), "utf8");
  upstream = https.createServer({ key: readFileSync(join(folder, "key.pem"), "utf8"), cert }, (request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body });
      answer(request, body, response);
    });
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  port = (upstream.address() as net.AddressInfo).port;
  const compiled = compileEgressPolicy(
    {
      allow: [],
      routes: [
        {
          kind: "git",
          route: "git",
          host: `github.test:${port}`,
          repositories: ["Owner/Repo"],
          pushRefs: ["refs/heads/agent/*"],
          credential: "GITHUB_TOKEN",
        },
      ],
    },
    { secret: async (name) => (name === "GITHUB_TOKEN" ? TOKEN : "") },
  );
  proxy = await startEgressProxy({
    ...compiled,
    log: (record) => logs.push(record),
    resolve: async (host) => (host === "github.test" ? ["127.0.0.1"] : []),
    ca: cert,
    unsafeAllowAddresses: ["127.0.0.1"],
  });
});
afterAll(async () => {
  await proxy?.close();
  await new Promise<void>((done) => (upstream ? upstream.close(() => done()) : done()));
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const fresh = () => {
  seen = [];
  logs = [];
};
const sentinel = () => proxy.sentinels.git ?? "";
const basic = (password: string) => `Basic ${Buffer.from(`x-access-token:${password}`).toString("base64")}`;
const expected = basic(TOKEN);

/** A request to the git route, as git in the sandbox sends it, with the body written in the given chunks. */
function send(
  path: string,
  init: { method?: string; headers?: Record<string, string>; chunks?: (string | Uint8Array)[]; pauseMs?: number } = {},
): Promise<{ status: number; headers: IncomingHttpHeaders; body: string }> {
  const { port: proxyPort } = new URL(proxy.url);
  return new Promise((done, fail) => {
    const request = http.request(
      { host: "127.0.0.1", port: Number(proxyPort), path, method: init.method ?? "GET", headers: init.headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          done({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString() }),
        );
      },
    );
    request.on("error", fail);
    void (async () => {
      for (const chunk of init.chunks ?? []) {
        if (request.destroyed) return;
        request.write(chunk);
        if (init.pauseMs !== undefined) await new Promise((resume) => setTimeout(resume, init.pauseMs));
      }
      request.end();
    })();
  });
}

const OLD = "0".repeat(40);
const NEW = "a".repeat(40);
const command = (ref: string, old = OLD, next = NEW) => pkt(`${old} ${next} ${ref}\0report-status\n`);
const authorized = () => ({ authorization: basic(sentinel()) });

/** Runs git with an allowlisted environment: a temp HOME, no system config and no prompt. */
async function git(cwd: string, ...args: string[]): Promise<{ code: number; output: string }> {
  const env = spawnEnv([], {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: "agent",
    GIT_AUTHOR_EMAIL: "agent@example.test",
    GIT_COMMITTER_NAME: "agent",
    GIT_COMMITTER_EMAIL: "agent@example.test",
  });
  assert.equal(Object.values(env).join("\n").includes(TOKEN), false, "the token is not in git's environment");
  try {
    const { stdout, stderr } = await run("git", args, { cwd, env, timeout: 30_000 });
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: typeof failed.code === "number" ? failed.code : 1, output: `${failed.stdout}${failed.stderr}` };
  }
}

test("a real git push through the route reaches an agent branch with the token, and nothing else does", async () => {
  fresh();
  const repo = mkdtempSync(join(tmpdir(), "harness-git-repo-"));
  folders.push(repo);
  mkdirSync(repo, { recursive: true });
  await git(repo, "init", "-q", "-b", "work");
  writeFileSync(join(repo, "a.txt"), "change");
  await git(repo, "add", "a.txt");
  await git(repo, "commit", "-q", "-m", "change");
  await git(repo, "tag", "v1");
  const { port: proxyPort } = new URL(proxy.url);
  const remote = `http://x-access-token:${sentinel()}@127.0.0.1:${proxyPort}/git/owner/repo.git`;

  const pushed = await git(repo, "push", remote, "HEAD:refs/heads/agent/task-1");
  assert.equal(pushed.code, 0, pushed.output);
  const posts = seen.filter((request) => request.method === "POST");
  assert.equal(posts.length, 1, "the push reached the fake GitHub");
  assert.match(posts[0]?.body.toString("latin1") ?? "", /refs\/heads\/agent\/task-1/);
  assert.match(posts[0]?.body.toString("latin1") ?? "", /PACK/, "the pack after the command list was forwarded");
  assert.ok(
    seen.every((request) => request.headers.authorization === expected),
    "every request carried the token",
  );
  assert.ok(logs.some((record) => record.status === 401 && record.reason === "git_credential_missing"));

  for (const refused of [["HEAD:refs/heads/main"], ["v1"], [":refs/heads/agent/old"], ["HEAD:refs/heads/agent"]]) {
    fresh();
    const result = await git(repo, "push", remote, ...refused);
    assert.notEqual(result.code, 0, `${refused.join(" ")} must be refused`);
    assert.equal(
      seen.filter((request) => request.method === "POST").length,
      0,
      `${refused.join(" ")} never reached the fake GitHub`,
    );
    assert.ok(
      logs.some((record) => record.status === 403 && /^git_(ref|delete)_refused$/.test(record.reason ?? "")),
      `${refused.join(" ")}: ${JSON.stringify(logs.map((record) => record.reason))}`,
    );
    assert.equal(result.output.includes(TOKEN), false, "the token is not in git's output");
  }
  assert.equal(JSON.stringify(logs).includes(TOKEN), false, "the token is in no log record");
}, 60_000);

test("a real git push larger than http.postBuffer passes its flush-only probe, then lands", async () => {
  fresh();
  const repo = mkdtempSync(join(tmpdir(), "harness-git-big-"));
  folders.push(repo);
  await git(repo, "init", "-q", "-b", "work");
  // Random bytes don't compress, so the pack is larger than the 1 MiB buffer and git probes before it streams.
  writeFileSync(join(repo, "big.bin"), randomBytes(2 * 1024 * 1024));
  await git(repo, "add", "big.bin");
  await git(repo, "commit", "-q", "-m", "big");
  const { port: proxyPort } = new URL(proxy.url);
  const remote = `http://x-access-token:${sentinel()}@127.0.0.1:${proxyPort}/git/owner/repo.git`;

  const pushed = await git(repo, "-c", "http.postBuffer=1048576", "push", remote, "HEAD:refs/heads/agent/big");
  assert.equal(pushed.code, 0, pushed.output);
  const posts = seen.filter((request) => request.method === "POST");
  assert.equal(posts[0]?.body.toString("latin1"), "0000", "git's probe reached the fake GitHub as one flush");
  assert.equal(posts.length, 2, "the probe and then the push");
  assert.match(posts[1]?.body.toString("latin1") ?? "", /refs\/heads\/agent\/big/);
  assert.ok((posts[1]?.body.length ?? 0) > 2 * 1024 * 1024, "the whole pack was forwarded");
  assert.ok(posts.every((request) => request.headers.authorization === expected));

  fresh();
  const refused = await git(repo, "-c", "http.postBuffer=1048576", "push", remote, "HEAD:refs/heads/main");
  assert.notEqual(refused.code, 0, "a large push to another branch is still refused after its probe");
  assert.equal(
    seen.filter((request) => request.method === "POST" && request.body.length > 4).length,
    0,
    "only the probe reached the fake GitHub",
  );
  assert.equal(logs.at(-1)?.reason, "git_ref_refused");
}, 60_000);

test("a request for another repository, another service or another path never leaves the proxy", async () => {
  fresh();
  const refusals: [string, string, string][] = [
    ["GET", "/git/other/repo.git/info/refs?service=git-receive-pack", "git_repository_refused"],
    ["GET", "/git/owner/repo.git/info/refs?service=git-upload-pack", "git_fetch_refused"],
    ["POST", "/git/owner/repo.git/git-upload-pack", "git_fetch_refused"],
    ["GET", "/git/owner/repo.git/info/refs?service=git-receive-pack&x=1", "git_path_refused"],
    ["GET", "/git/owner/repo.git/info/refs", "git_path_refused"],
    ["POST", "/git/owner/repo.git/info/refs?service=git-receive-pack", "git_path_refused"],
    ["GET", "/git/owner/repo.git/git-receive-pack", "git_path_refused"],
    ["GET", "/git/owner/repo.git/HEAD", "git_path_refused"],
    ["GET", "/git/../repo.git/info/refs?service=git-receive-pack", "git_path_refused"],
    ["GET", "/git/owner/%2e%2e/info/refs?service=git-receive-pack", "git_path_refused"],
    ["GET", "/git/owner/repo.git/x/info/refs?service=git-receive-pack", "git_path_refused"],
    ["DELETE", "/git/owner/repo.git/info/refs?service=git-receive-pack", "method_not_allowed"],
  ];
  for (const [method, path, reason] of refusals) {
    const reply = await send(path, { method, headers: authorized() });
    assert.ok(reply.status === 403 || reply.status === 405, `${method} ${path}: ${reply.status}`);
    assert.equal(logs.at(-1)?.reason, reason, `${method} ${path}`);
  }
  const ok = await send("/git/OWNER/Repo/info/refs?service=git-receive-pack", { headers: authorized() });
  assert.equal(ok.status, 200, "a repository matches without case and without .git");
  assert.equal(seen.length, 1, "only the allowed request reached the fake GitHub");
});

test("a missing credential gets a Basic challenge, and a wrong or borrowed one gets 403", async () => {
  fresh();
  const path = "/git/owner/repo.git/info/refs?service=git-receive-pack";
  const missing = await send(path);
  assert.equal(missing.status, 401);
  assert.match(String(missing.headers["www-authenticate"]), /^Basic /);
  for (const authorization of [
    basic("wrong"),
    basic(`${sentinel()}x`),
    `Bearer ${sentinel()}`,
    `Basic ${Buffer.from(sentinel()).toString("base64")}`,
    "Basic !!!",
  ]) {
    const reply = await send(path, { headers: { authorization } });
    assert.equal(reply.status, 403, authorization);
    assert.equal(logs.at(-1)?.reason, "bad_sentinel");
  }
  assert.equal(seen.length, 0);
});

test("a push body that is encoded, malformed, oversize or cut short is refused before anything is sent", async () => {
  fresh();
  const path = "/git/owner/repo.git/git-receive-pack";
  const post = (chunks: (string | Uint8Array)[], headers: Record<string, string> = {}, pauseMs?: number) =>
    send(path, { method: "POST", headers: { ...authorized(), ...headers }, chunks, ...(pauseMs ? { pauseMs } : {}) });
  const encoded = await post([`${command("refs/heads/agent/x")}0000`], { "content-encoding": "gzip" });
  assert.equal(encoded.status, 403);
  assert.equal(logs.at(-1)?.reason, "git_encoded_push");
  const malformed = await post(["zzzz0000"]);
  assert.equal(logs.at(-1)?.reason, "git_bad_pkt_line");
  assert.equal(malformed.status, 403);
  await post([command("refs/heads/agent/x").slice(0, 30)]);
  assert.equal(logs.at(-1)?.reason, "git_bad_pkt_line", "a body that ends inside the command list");
  const long = pkt(`${OLD} ${NEW} refs/heads/agent/${"x".repeat(59_000)}\n`);
  await post([long, "ffef", "y".repeat(4000), "y".repeat(4000)], {}, 5);
  assert.equal(logs.at(-1)?.reason, "git_too_large", "a command list past the limit, sent in pieces");
  await post([command("refs/heads/agent/x").slice(0, 10), command("refs/heads/agent/x").slice(10), "0000PACK"], {}, 5);
  assert.equal(logs.at(-1)?.status, 200, "a command list split across chunks is read whole");
  assert.equal(seen.length, 1, "only the last push reached the fake GitHub");
  assert.match(seen[0]?.body.toString("latin1") ?? "", /0000PACK$/, "the bytes read to check it were forwarded");
});

test("an in-process fetch takes the same route, with the same push check", async () => {
  fresh();
  const url = "http://egress.proxy/git/owner/repo.git/git-receive-pack";
  const refused = await proxy.fetch(url, {
    method: "POST",
    headers: authorized(),
    body: `${command("refs/tags/v1")}0000`,
  });
  assert.equal(refused.status, 403);
  await refused.arrayBuffer();
  assert.equal(seen.length, 0);
  const allowed = await proxy.fetch(url, {
    method: "POST",
    headers: authorized(),
    body: `${command("refs/heads/agent/y")}0000PACK`,
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.text()).includes(TOKEN), false);
  assert.equal(seen[0]?.headers.authorization, expected);
});

/** A proxy with its own timeouts, in front of the same fake GitHub. */
function startTimedProxy(timeouts: { idleTimeoutMs?: number; pushCheckTimeoutMs?: number }): Promise<EgressProxy> {
  return startEgressProxy({
    ...compileEgressPolicy(
      {
        allow: [],
        routes: [
          {
            kind: "git",
            route: "git",
            host: `github.test:${port}`,
            repositories: ["owner/repo"],
            pushRefs: ["refs/heads/agent/*"],
            credential: "GITHUB_TOKEN",
          },
        ],
      },
      { secret: async () => TOKEN },
    ),
    log: (record) => logs.push(record),
    resolve: async (host) => (host === "github.test" ? ["127.0.0.1"] : []),
    ca: readFileSync(join(folders[0] ?? "", "cert.pem"), "utf8"),
    unsafeAllowAddresses: ["127.0.0.1"],
    ...timeouts,
  });
}

/** Posts a push body to `to`'s git route in `chunks`, pausing `pauseMs` after each, and resolves with the status. */
function postPush(to: EgressProxy, chunks: string[], pauseMs: number): Promise<number> {
  const { port: proxyPort } = new URL(to.url);
  return new Promise<number>((done, fail) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port: Number(proxyPort),
        path: "/git/owner/repo.git/git-receive-pack",
        method: "POST",
        headers: { authorization: basic(to.sentinels.git ?? "") },
      },
      (response) => {
        response.resume();
        response.on("end", () => done(response.statusCode ?? 0));
      },
    );
    request.on("error", fail);
    void (async () => {
      for (const chunk of chunks) {
        if (request.destroyed) return;
        request.write(chunk);
        await new Promise((resume) => setTimeout(resume, pauseMs));
      }
      request.end();
    })();
  });
}

test("a push body sent a few bytes at a time is read whole and quickly, and one that stalls times out", async () => {
  fresh();
  const slow = await startTimedProxy({ idleTimeoutMs: 400 });
  try {
    const post = (chunks: string[], pauseMs: number) => postPush(slow, chunks, pauseMs);
    const body = `${command(`refs/heads/agent/${"x".repeat(900)}`)}0000PACK`;
    const pieces = body.match(/[\s\S]{1,3}/g) ?? [];
    const started = Date.now();
    assert.equal(await post(pieces, 0), 200, "a body in three-byte pieces is allowed");
    assert.ok(Date.now() - started < 10_000, "and checked without stalling");
    assert.equal(seen.at(-1)?.body.toString("latin1"), body, "every byte was forwarded in order");
    assert.equal(
      await post([body.slice(0, 40), body.slice(40, 80), body.slice(80)], 250),
      200,
      "each piece resets the idle timer",
    );
    fresh();
    assert.equal(
      await post([body.slice(0, 40), body.slice(40)], 1200),
      403,
      "a body that stalls past the idle timeout",
    );
    assert.equal(logs.at(-1)?.reason, "git_timeout");
    assert.equal(seen.length, 0, "nothing reached the fake GitHub");
    const long = pkt(`${OLD} ${NEW} refs/heads/agent/${"x".repeat(59_000)}\n`);
    const oversize = [`${long}ffef${"y".repeat(8000)}`, "y"];
    assert.equal(await post(oversize, 1200), 403, "a list past the limit that then stalls");
    assert.equal(logs.at(-1)?.reason, "git_too_large", "is refused for its size before the idle timeout");
  } finally {
    await slow.close();
  }
}, 30_000);

test("a push check has a total deadline that a trickle of bytes can't extend, and a normal push is not cut off", async () => {
  fresh();
  const timed = await startTimedProxy({ idleTimeoutMs: 400, pushCheckTimeoutMs: 900 });
  try {
    const body = `${command(`refs/heads/agent/${"x".repeat(200)}`)}0000PACK`;
    assert.equal(await postPush(timed, [body.slice(0, 50), body.slice(50)], 250), 200, "a normal push");
    const started = Date.now();
    const trickle = (body.match(/[\s\S]{1,4}/g) ?? []).slice(0, 20);
    assert.equal(await postPush(timed, trickle, 250), 403, "four bytes every 250 ms, inside the idle timeout");
    assert.equal(logs.at(-1)?.reason, "git_timeout");
    assert.ok(Date.now() - started < 3000, "cut off at the deadline, not after the whole trickle");
    assert.equal(seen.length, 1, "only the normal push reached the fake GitHub");
  } finally {
    await timed.close();
  }
}, 30_000);

test("a pushCheckTimeoutMs that isn't a whole number of milliseconds a timer can take is refused at start", async () => {
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, "60000"]) {
    const error = await startTimedProxy({ pushCheckTimeoutMs: bad as number }).then(
      async (started) => {
        await started.close();
        return {} as { code?: string; message?: string };
      },
      (failure: { code?: string; message?: string }) => failure,
    );
    assert.equal(error.code, "invalid_egress_options", String(bad));
    assert.match(error.message ?? "", /pushCheckTimeoutMs/);
  }
  const fine = await startTimedProxy({ pushCheckTimeoutMs: 2 ** 31 - 1 });
  await fine.close();
});

test("a whole command list in one piece is held to the size limit, by the proxy and by an in-process fetch", async () => {
  fresh();
  const shallow = pkt(`shallow ${NEW}\n`);
  const lines = shallow.repeat(Math.floor((GIT_MAX_COMMAND_BYTES - 300) / shallow.length));
  const list = (over: number) => {
    const room = GIT_MAX_COMMAND_BYTES + over - lines.length - command("refs/heads/agent/").length;
    return `${lines}${command(`refs/heads/agent/${"x".repeat(room)}`)}0000PACK`;
  };
  const url = "http://egress.proxy/git/owner/repo.git/git-receive-pack";
  for (const [over, status] of [
    [0, 200],
    [1, 403],
  ] as const) {
    const fetched = await proxy.fetch(url, { method: "POST", headers: authorized(), body: list(over) });
    await fetched.arrayBuffer();
    assert.equal(fetched.status, status, `fetch, ${over} byte over`);
    assert.equal(await postPush(proxy, [list(over)], 0), status, `proxy, ${over} byte over`);
    if (status === 403) assert.equal(logs.at(-1)?.reason, "git_too_large");
  }
  assert.equal(seen.length, 2, "only the lists at the limit reached the fake GitHub");
});
