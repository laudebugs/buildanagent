// N50's live egress cases on a real Cloudflare sandbox: a Durable Object that starts a container with the Durable
// Object Container API, registers outbound intercepts, runs commands in it and returns every command's exit code and
// output verbatim. The Worker's own `/echo` route is the test echo server that checks the dummy credential.
//
// The token below is a dummy that only this Worker checks. No real credential is used anywhere in this run.

import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { Files } from "@cloudflare/sandbox";

interface Env {
  SANDBOX: DurableObjectNamespace<N50EgressTest20261128Sandbox>;
  RUN_KEY: string;
}

const DUMMY_TOKEN = "n50-dummy-token-not-a-secret";
// Bumped with each deploy, so a record shows which code ran it.
const CODE_VERSION = 5;
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
const BUNDLE = "/etc/ssl/certs/ca-certificates.crt";
const SYSTEM = "/etc/ssl/certs/ca-certificates.system.crt";
// The trust step from Cloudflare's "Move outbound rules" page: keep a copy of the system bundle, wait up to 10 s for
// the intercept CA, then write the bundle from the copy and the CA.
const TRUST = [
  "sh",
  "-c",
  `[ -e ${SYSTEM} ] || { cp ${BUNDLE} ${SYSTEM}.tmp && mv ${SYSTEM}.tmp ${SYSTEM}; }
timeout 10 sh -c 'until [ -s ${CA} ]; do sleep 0.1; done' && cat ${SYSTEM} ${CA} >${BUNDLE}.tmp && mv ${BUNDLE}.tmp ${BUNDLE}`,
];
const BASE_ENV = { HOME: "/root", LANG: "C.UTF-8" };
const NODE_CA_ENV = { ...BASE_ENV, NODE_EXTRA_CA_CERTS: CA };

type Step = {
  label: string;
  argv: string[];
  env: Record<string, string>;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  ms: number;
  error?: string;
};
type Registration = { call: string; target: string; handler: string; ok: boolean; error?: string; ms: number };
type CaseResult = {
  case: string;
  codeVersion: number;
  startedAt: string;
  start: Record<string, unknown> | null;
  registrations: Registration[];
  steps: Step[];
  notes: string[];
};

/** Forwards a request only when the URL's host (from the Host header) is on the list; redirects go back unfollowed. */
export class Allow extends WorkerEntrypoint<Env, { allow: string[] }> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!this.ctx.props.allow.includes(url.hostname)) {
      return new Response(`n50 Allow: host ${url.hostname} is not allowed\n`, { status: 403 });
    }
    return fetch(request, { redirect: "manual" });
  }
}

/** Forwards every request it gets, with no host check: the mistake the Cloudflare page warns about. */
export class Naive extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    try {
      return await fetch(request, { redirect: "manual" });
    } catch (error) {
      return new Response(`n50 Naive: fetch(${request.url}) threw: ${String(error)}\n`, { status: 599 });
    }
  }
}

/** Adds the dummy credential for one host only, then sends the request on to the echo server. */
export class Inject extends WorkerEntrypoint<Env, { host: string; upstream: "fetch" | "exports" }> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== "https:" || url.hostname !== this.ctx.props.host) {
      return new Response(`n50 Inject: refused ${url.protocol}//${url.hostname}\n`, { status: 403 });
    }
    const withAuth = new Request(url, request);
    withAuth.headers.set("authorization", `Bearer ${DUMMY_TOKEN}`);
    if (this.ctx.props.upstream === "exports") {
      return this.ctx.exports.Echo.fetch(withAuth);
    }
    return fetch(withAuth, { redirect: "manual" });
  }
}

/**
 * A reverse-proxy route, HD15's shape: the sandbox speaks plain HTTP to a made-up name, and the handler sends the
 * request on over HTTPS to one real origin, adding the dummy credential when `inject` is set. No TLS is intercepted.
 */
export class Route extends WorkerEntrypoint<Env, { from: string; to: string; inject: boolean }> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.protocol !== "http:" || url.hostname !== this.ctx.props.from) {
      return new Response(`n50 Route: refused ${url.protocol}//${url.hostname}\n`, { status: 403 });
    }
    const upstream = new Request(`${this.ctx.props.to}${url.pathname}${url.search}`, request);
    if (this.ctx.props.inject) upstream.headers.set("authorization", `Bearer ${DUMMY_TOKEN}`);
    return fetch(upstream, { redirect: "manual" });
  }
}

/** The echo server reached through a loopback binding, when a Worker can't fetch its own workers.dev host. */
export class Echo extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Response {
    return echo(request, "exports");
  }
}

/** Answers every request itself with the host it was asked for, so wildcard and limit cases need no upstream. */
export class Synthetic extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Response {
    const url = new URL(request.url);
    return Response.json({ handler: "Synthetic", host: url.hostname, url: request.url, method: request.method });
  }
}

function echo(request: Request, via: string): Response {
  const auth = request.headers.get("authorization");
  const headers: Record<string, string> = {};
  for (const [name, value] of request.headers) headers[name] = value;
  return Response.json({
    echo: "n50-egress-test-20261128",
    via,
    tokenOk: auth === `Bearer ${DUMMY_TOKEN}`,
    url: request.url,
    method: request.method,
    headers,
  });
}

const decode = (buffer: ArrayBuffer) => new TextDecoder().decode(buffer);

export class N50EgressTest20261128Sandbox extends DurableObject<Env> {
  private get container(): Container {
    const container = this.ctx.container;
    if (!container) throw new Error("No container is configured");
    return container;
  }

  private async reset(): Promise<void> {
    if (this.container.running) await this.container.destroy();
  }

  /** Stops the container; the runner calls it after the last case. */
  async stop(): Promise<{ running: boolean }> {
    await this.reset();
    return { running: this.container.running };
  }

  private async register(
    result: CaseResult,
    call: "http" | "https" | "all",
    target: string,
    handler: string,
    binding: Fetcher,
  ): Promise<boolean> {
    const t0 = Date.now();
    try {
      if (call === "http") await this.container.interceptOutboundHttp(target, binding);
      else if (call === "https") await this.container.interceptOutboundHttps(target, binding);
      else await this.container.interceptAllOutboundHttp(binding);
      result.registrations.push({ call, target, handler, ok: true, ms: Date.now() - t0 });
      return true;
    } catch (error) {
      result.registrations.push({ call, target, handler, ok: false, error: String(error), ms: Date.now() - t0 });
      return false;
    }
  }

  private start(result: CaseResult, enableInternet: boolean): void {
    const options = { image: this.container.images.sandbox, instance: "lite" as const, enableInternet };
    result.start = { ...options };
    this.container.start(options);
    // Record how and when the container stops, so a case that loses its container says why.
    const t0 = Date.now();
    this.container.monitor().then(
      () => result.notes.push(`monitor resolved after ${Date.now() - t0} ms`),
      (error: unknown) => result.notes.push(`monitor rejected after ${Date.now() - t0} ms: ${String(error)}`),
    );
  }

  private async run(
    result: CaseResult,
    label: string,
    argv: string[],
    env: Record<string, string> = BASE_ENV,
    cwd = "/workspace",
  ): Promise<Step> {
    const t0 = Date.now();
    const step: Step = { label, argv, env, exitCode: null, stdout: "", stderr: "", ms: 0 };
    try {
      const signal = AbortSignal.timeout(120_000);
      const process = await this.container.exec(argv, { env, cwd, signal });
      // A background child can hold the pipes open after the signal kills the command, so cap the wait as well.
      const output = await Promise.race([
        process.output(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("n50: output() still open after 130 s")), 130_000),
        ),
      ]);
      step.exitCode = output.exitCode;
      step.stdout = decode(output.stdout);
      step.stderr = decode(output.stderr);
    } catch (error) {
      step.error = String(error);
    }
    step.ms = Date.now() - t0;
    result.steps.push(step);
    return step;
  }

  private sh(result: CaseResult, label: string, command: string, env: Record<string, string> = BASE_ENV) {
    return this.run(result, label, ["sh", "-c", command], env);
  }

  private curl(result: CaseResult, label: string, url: string, extra = "") {
    return this.sh(
      result,
      label,
      `rm -f /tmp/body; curl -sS --max-time 20 -o /tmp/body -w 'http_code=%{http_code} remote_ip=%{remote_ip} ssl_verify=%{ssl_verify_result}\\n' ${extra} '${url}'; rc=$?; echo "curl_exit=$rc"; head -c 400 /tmp/body 2>/dev/null; exit $rc`,
    );
  }

  private nodeFetch(result: CaseResult, label: string, url: string, env: Record<string, string>, flags: string[] = []) {
    const script = `fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(20000)}).then(async r=>{console.log("status",r.status);console.log((await r.text()).slice(0,300))}).catch(e=>{console.log("error",e.message,e.cause&&(e.cause.code+" "+e.cause.message));process.exit(1)})`;
    return this.run(result, label, ["node", ...flags, "-e", script], env);
  }

  private newResult(name: string): CaseResult {
    return {
      case: name,
      codeVersion: CODE_VERSION,
      startedAt: new Date().toISOString(),
      start: null,
      registrations: [],
      steps: [],
      notes: [],
    };
  }

  /** Runs one case in a fresh container and stops the container afterwards. */
  async runCase(name: string, echoHost: string): Promise<CaseResult> {
    await this.reset();
    const result = this.newResult(name);
    try {
      await this.cases[name as keyof typeof this.cases](result, echoHost);
    } catch (error) {
      result.notes.push(`case threw: ${String(error)}`);
    } finally {
      await this.reset();
    }
    return result;
  }

  private versions(result: CaseResult) {
    return this.sh(
      result,
      "versions",
      "cat /etc/debian_version; node --version; npm --version; curl --version | head -1; git --version; dpkg-query -W ca-certificates; ls -l /usr/local/bin/sandbox-shim",
    );
  }

  /** The per-host HTTPS intercepts that cases (b), (c) and (d) share, registered before the container starts. */
  private async perHostHttps(result: CaseResult, echoHost: string): Promise<void> {
    const allowed = ["registry.npmjs.org", "github.com"];
    const allow = this.ctx.exports.Allow({ props: { allow: allowed } });
    const inject = this.ctx.exports.Inject({ props: { host: echoHost, upstream: "fetch" } });
    const injectExports = this.ctx.exports.Inject({ props: { host: "echo-exports.n50.invalid", upstream: "exports" } });
    const naive = this.ctx.exports.Naive({ props: {} });
    await this.register(result, "https", echoHost, "Inject(fetch)", inject);
    await this.register(result, "https", "echo-exports.n50.invalid", "Inject(exports)", injectExports);
    await this.register(result, "https", "naive.n50.invalid", "Naive", naive);
    await this.register(result, "http", "naive.n50.invalid", "Naive", naive);
    for (const host of allowed) await this.register(result, "https", host, "Allow", allow);
    this.start(result, false);
  }

  private readonly cases = {
    // (a) HTTPS to an allowlisted host with internet off and no HTTPS interception: the 0.x shape of allowedHosts
    // without interceptHttps, rebuilt as HTTP-only intercepts.
    "a-http-only-intercepts": async (result: CaseResult) => {
      const allow = this.ctx.exports.Allow({ props: { allow: ["registry.npmjs.org", "github.com"] } });
      await this.register(result, "http", "registry.npmjs.org", "Allow", allow);
      await this.register(result, "http", "github.com", "Allow", allow);
      this.start(result, false);
      await this.versions(result);
      await this.run(result, "dns registry.npmjs.org", ["getent", "ahosts", "registry.npmjs.org"]);
      await this.run(result, "ca file present?", ["ls", "-l", "/etc/cloudflare/certs/"]);
      await this.curl(result, "curl https registry", "https://registry.npmjs.org/is-number");
      await this.curl(result, "curl http registry", "http://registry.npmjs.org/is-number");
      await this.nodeFetch(result, "node fetch https registry", "https://registry.npmjs.org/is-number", BASE_ENV);
      await this.sh(result, "npm view", "timeout -k 2 60 npm view is-number version --fetch-retries=0", BASE_ENV);
      await this.sh(
        result,
        "git ls-remote https",
        "timeout -k 2 30 git ls-remote https://github.com/octocat/Hello-World HEAD",
      );
    },
    // (a) again with no intercept at all: only DNS and connect behaviour.
    "a-no-intercepts": async (result: CaseResult) => {
      this.start(result, false);
      await this.run(result, "dns registry.npmjs.org", [
        "sh",
        "-c",
        "timeout 15 getent ahosts registry.npmjs.org; echo rc=$?",
      ]);
      await this.curl(result, "curl https registry", "https://registry.npmjs.org/is-number");
      await this.curl(result, "curl https by ip", "https://104.16.0.35/", "-k");
    },
    // (a) the alternative without interception: HTTP-only intercepts on made-up names that forward over HTTPS, with
    // each client pointed at its route by configuration instead of a CA.
    "a-reverse-proxy-routes": async (result: CaseResult, echoHost: string) => {
      const routes = [
        { from: "registry.n50.internal", to: "https://registry.npmjs.org", inject: false },
        { from: "github.n50.internal", to: "https://github.com", inject: false },
        { from: "echo.n50.internal", to: `https://${echoHost}`, inject: true },
      ];
      for (const route of routes) {
        await this.register(result, "http", route.from, "Route", this.ctx.exports.Route({ props: route }));
      }
      this.start(result, false);
      await this.run(result, "ca file present?", ["sh", "-c", `ls -l ${CA} 2>&1; true`]);
      await this.curl(result, "curl registry route", "http://registry.n50.internal/is-number");
      await this.nodeFetch(result, "node fetch registry route", "http://registry.n50.internal/is-number", BASE_ENV);
      await this.run(result, "mkdir app", ["mkdir", "-p", "/workspace/app"]);
      const files = new Files(this.container);
      await files.writeFile(
        "/workspace/app/package.json",
        JSON.stringify({ name: "n50-app", version: "0.0.0", private: true }),
      );
      await this.sh(
        result,
        "npm install via registry route",
        'cd /workspace/app && timeout -k 2 90 npm install is-number@7.0.0 --registry=http://registry.n50.internal/ --no-audit --no-fund --fetch-retries=0 2>&1 | tail -5; grep -o \'"resolved": "[^"]*"\' package-lock.json; grep \'"version"\' node_modules/is-number/package.json',
      );
      await this.sh(
        result,
        "git clone via github route",
        "rm -rf /tmp/hw; git config --global url.http://github.n50.internal/.insteadOf https://github.com/ && timeout -k 2 60 git clone --depth 1 https://github.com/octocat/Hello-World /tmp/hw && git -C /tmp/hw log --oneline -1",
      );
      await this.curl(result, "credential via echo route", "http://echo.n50.internal/echo");
      await this.curl(result, "route refuses another Host", "http://registry.n50.internal/", "-H 'Host: example.com'");
      await this.curl(result, "https to the route name", "https://registry.n50.internal/is-number");
    },
    // (b) per-host HTTPS intercepts with the trust step, each client in turn, and the credential route.
    "b-per-host-https": async (result: CaseResult, echoHost: string) => {
      await this.perHostHttps(result, echoHost);
      await this.versions(result);
      await this.run(result, "ca file", [
        "sh",
        "-c",
        `ls -l ${CA}; openssl x509 -in ${CA} -noout -subject -issuer -dates 2>&1 || head -3 ${CA}`,
      ]);

      // (b) before the trust step: every client should refuse the intercept's certificate.
      await this.curl(result, "b0 curl https registry, untrusted", "https://registry.npmjs.org/is-number");
      await this.nodeFetch(result, "b0 node fetch, untrusted", "https://registry.npmjs.org/is-number", BASE_ENV);

      // (b) the trust step, then each client in turn.
      await this.run(result, "b1 trust step (system bundle)", TRUST);
      await this.curl(result, "b1 curl https registry", "https://registry.npmjs.org/is-number");
      await this.sh(
        result,
        "b1 git clone https",
        "rm -rf /tmp/hw; timeout -k 2 60 git clone --depth 1 https://github.com/octocat/Hello-World /tmp/hw && git -C /tmp/hw log --oneline -1",
      );
      await this.nodeFetch(result, "b1 node fetch, bundle only", "https://registry.npmjs.org/is-number", BASE_ENV);
      await this.nodeFetch(
        result,
        "b1 node fetch, NODE_EXTRA_CA_CERTS",
        "https://registry.npmjs.org/is-number",
        NODE_CA_ENV,
      );
      await this.nodeFetch(result, "b1 node fetch, --use-system-ca", "https://registry.npmjs.org/is-number", BASE_ENV, [
        "--use-system-ca",
      ]);
      await this.run(result, "mkdir app", ["mkdir", "-p", "/workspace/app"]);
      const files = new Files(this.container);
      await files.writeFile(
        "/workspace/app/package.json",
        JSON.stringify({ name: "n50-app", version: "0.0.0", private: true }),
      );
      await this.sh(
        result,
        "b1 npm install, bundle only",
        "cd /workspace/app && timeout -k 2 90 npm install is-number@7.0.0 --no-audit --no-fund --fetch-retries=0 2>&1 | tail -5",
      );
      await this.sh(
        result,
        "b1 npm install, NODE_EXTRA_CA_CERTS",
        "cd /workspace/app && rm -rf node_modules package-lock.json && timeout -k 2 90 npm install is-number@7.0.0 --no-audit --no-fund --fetch-retries=0 2>&1 | tail -5 && cat node_modules/is-number/package.json | grep '\"version\"'",
        NODE_CA_ENV,
      );

      // (b) the credential route: the handler adds the dummy token outside the sandbox.
      await this.curl(result, "b2 credential via fetch upstream", `https://${echoHost}/echo`);
      await this.curl(result, "b2 credential via exports upstream", "https://echo-exports.n50.invalid/echo");
      await this.sh(
        result,
        "b2 token absent from sandbox env and files",
        `env | grep -c ${DUMMY_TOKEN}; grep -rls ${DUMMY_TOKEN} /etc /root /workspace /tmp 2>/dev/null | head; echo done`,
      );
      await this.curl(result, "b2 credential host over plain http", `http://${echoHost}/echo`);
    },
    // (c) and (d) in a container set up as (b) is: denied hosts, and loopback and metadata addresses.
    "cd-per-host-denied-and-internal": async (result: CaseResult, echoHost: string) => {
      await this.perHostHttps(result, echoHost);
      await this.run(result, "trust step", TRUST);
      // (c) denied hosts fail closed.
      await this.run(result, "c dns example.com", ["sh", "-c", "timeout 15 getent ahosts example.com; echo rc=$?"]);
      await this.curl(result, "c curl https example.com", "https://example.com/");
      await this.curl(result, "c curl http example.com", "http://example.com/");
      await this.nodeFetch(result, "c node fetch example.com", "https://example.com/", NODE_CA_ENV);
      await this.curl(result, "c curl https by ip", "https://1.1.1.1/", "-k");
      await this.curl(result, "c curl http by ip", "http://1.1.1.1/");
      await this.sh(result, "c raw tcp 1.1.1.1:53", "timeout 10 bash -c 'echo > /dev/tcp/1.1.1.1/53' ; echo rc=$?");
      await this.sh(
        result,
        "c raw udp dns 1.1.1.1",
        "timeout 10 bash -c 'printf x > /dev/udp/1.1.1.1/53' ; echo rc=$?",
      );
      await this.curl(
        result,
        "c Host header to denied host via allowed SNI",
        "https://registry.npmjs.org/",
        "-H 'Host: example.com'",
      );

      // (d) loopback and cloud metadata addresses.
      await this.curl(result, "d metadata aws", "http://169.254.169.254/latest/meta-data/");
      await this.curl(
        result,
        "d metadata gcp",
        "http://169.254.169.254/computeMetadata/v1/",
        "-H 'Metadata-Flavor: Google'",
      );
      await this.curl(result, "d metadata.google.internal", "http://metadata.google.internal/");
      await this.curl(result, "d metadata ipv6 aws", "http://[fd00:ec2::254]/latest/meta-data/");
      await this.curl(result, "d loopback, nothing listening", "http://127.0.0.1:8080/");
      await this.sh(
        result,
        "d loopback, own listener",
        "node -e \"require('http').createServer((q,s)=>s.end('local ok')).listen(8080,'127.0.0.1')\" >/dev/null 2>&1 & pid=$!; sleep 1; curl -sS --max-time 5 http://127.0.0.1:8080/; echo; kill $pid",
      );
      await this.sh(
        result,
        "d routes and resolver",
        "cat /etc/resolv.conf; ip route 2>/dev/null || cat /proc/net/route; cat /etc/hosts",
      );
      await this.curl(
        result,
        "d naive handler, Host example.com",
        "https://naive.n50.invalid/",
        "-H 'Host: example.com'",
      );
      await this.curl(
        result,
        "d naive handler, Host 169.254.169.254",
        "http://naive.n50.invalid/latest/meta-data/",
        "-H 'Host: 169.254.169.254'",
      );
      await this.curl(result, "d naive handler, Host 127.0.0.1", "http://naive.n50.invalid/", "-H 'Host: 127.0.0.1'");
      await this.curl(
        result,
        "d allow handler, Host 169.254.169.254",
        "https://registry.npmjs.org/latest/meta-data/",
        "-H 'Host: 169.254.169.254'",
      );
    },
    // (c) with a "*" intercept: every name resolves, and the handler refuses what isn't allowed.
    "c-star-intercept": async (result: CaseResult) => {
      const allow = this.ctx.exports.Allow({ props: { allow: ["registry.npmjs.org"] } });
      await this.register(result, "all", "(all http)", "Allow", allow);
      await this.register(result, "https", "*", "Allow", allow);
      this.start(result, false);
      await this.run(result, "trust step", TRUST);
      await this.curl(result, "allowed host", "https://registry.npmjs.org/is-number");
      await this.curl(result, "denied host https", "https://example.com/");
      await this.curl(result, "denied host http", "http://example.com/");
      await this.curl(result, "https by ip", "https://1.1.1.1/", "-k");
      await this.curl(result, "metadata over http", "http://169.254.169.254/latest/meta-data/");
    },
    // (d) with internet on and no intercept, to see what the default network reaches.
    "d-internet-on": async (result: CaseResult) => {
      this.start(result, true);
      await this.curl(result, "public https", "https://example.com/");
      await this.curl(result, "metadata aws", "http://169.254.169.254/latest/meta-data/");
      await this.curl(
        result,
        "metadata gcp",
        "http://169.254.169.254/computeMetadata/v1/",
        "-H 'Metadata-Flavor: Google'",
      );
      await this.curl(result, "rfc1918 10.0.0.1", "http://10.0.0.1/");
      await this.sh(result, "routes and resolver", "cat /etc/resolv.conf; ip route 2>/dev/null || cat /proc/net/route");
    },
    // (e) the 128-entry limit, with hostname targets (two entries each) and IP targets (one entry each).
    "e-limit-hostnames": async (result: CaseResult) => {
      const synthetic = this.ctx.exports.Synthetic({ props: {} });
      this.start(result, false);
      for (let i = 1; i <= 66; i++) await this.register(result, "https", `h${i}.n50.invalid`, "Synthetic", synthetic);
      await this.register(result, "https", "h1.n50.invalid", "Synthetic (again)", synthetic);
      await this.register(result, "http", "h1.n50.invalid", "Synthetic (http)", synthetic);
      await this.run(result, "trust step", TRUST);
      await this.curl(result, "first target still works", "https://h1.n50.invalid/");
      await this.curl(result, "64th target", "https://h64.n50.invalid/");
      await this.curl(result, "65th target", "https://h65.n50.invalid/");
    },
    "e-limit-ips": async (result: CaseResult) => {
      const synthetic = this.ctx.exports.Synthetic({ props: {} });
      this.start(result, false);
      for (let i = 1; i <= 130; i++) await this.register(result, "http", `10.255.0.${i}`, "Synthetic", synthetic);
      await this.curl(result, "first ip target", "http://10.255.0.1/");
      await this.curl(result, "128th ip target", "http://10.255.0.128/");
      await this.curl(result, "129th ip target", "http://10.255.0.129/");
    },
    // (e) one glob entry standing in for many hosts.
    "e-wildcard": async (result: CaseResult) => {
      const synthetic = this.ctx.exports.Synthetic({ props: {} });
      await this.register(result, "https", "*.wild.n50.invalid", "Synthetic", synthetic);
      this.start(result, false);
      await this.run(result, "trust step", TRUST);
      for (const host of ["a.wild.n50.invalid", "b.c.wild.n50.invalid", "wild.n50.invalid", "x.other.n50.invalid"]) {
        await this.curl(result, `glob ${host}`, `https://${host}/`);
      }
    },
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/echo") return echo(request, "fetch");
    if (request.headers.get("x-run-key") !== env.RUN_KEY || !env.RUN_KEY) {
      return new Response("not found\n", { status: 404 });
    }
    const sandbox = env.SANDBOX.getByName("n50");
    if (url.pathname === "/stop") return Response.json(await sandbox.stop());
    const match = /^\/case\/([a-z0-9-]+)$/.exec(url.pathname);
    if (!match) return new Response("not found\n", { status: 404 });
    return Response.json(await sandbox.runCase(match[1] as string, url.hostname));
  },
} satisfies ExportedHandler<Env>;
