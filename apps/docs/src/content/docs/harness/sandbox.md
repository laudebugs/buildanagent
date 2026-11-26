---
title: A sandbox confines commands and holds no credentials
description: How a sandbox policy limits the folders and hosts a command may touch, what each backend stops, and how the egress proxy keeps credentials on the host.
---

You will run an agent's commands in a confined workspace and keep credentials out of it. You need this when an agent runs shell commands, installs packages or reaches the web.

A sandbox is a confined place where commands run, and a credential is a secret such as an API key or a token. The secret stays on the host, and the sandbox sees at most a placeholder. An authenticated action, such as a push or an API call, runs as a tool in the harness's own process behind the [permission pipeline](/harness/permissions/), or through an egress route on the host that adds the secret for the sandbox.

## A policy lists the folders and hosts a sandbox may touch

A sandbox backend provisions a sandbox for one workspace and one policy. The policy lists the folders the sandbox may read, the folders it may write and the hosts it may reach. The model never changes it. This example allows reads in the workspace and a tool cache, writes only in the workspace and no host:

```ts file="packages/harness/examples/sandbox-fake.ts" region="policy"
```

The example runs on `fakeSandbox()` from `@buildanagent/harness/testing`. The fake keeps its workspace in memory, enforces the policy it is given and starts no program. A real backend replaces it and keeps the same calls. Provisioning creates the workspace with its files:

```ts file="packages/harness/examples/sandbox-fake.ts" region="provision"
```

`exec()` takes a program and its arguments, with no shell. The command's environment is exactly the `env` you pass, so nothing is copied from the host:

```ts file="packages/harness/examples/sandbox-fake.ts" region="run"
```

A command the policy refuses is a result, not an error. Writing outside the workspace resolves with `{ denied }` and writes nothing. Here the denial reads `filesystem_write` for `/work/outside.txt`, with the reason "the path is outside the write roots":

```ts file="packages/harness/examples/sandbox-fake.ts" region="denied"
```

A backend that enforces a policy also reads it back, so `provision()` can compare what the sandbox enforces with what you asked for. It throws `SandboxPolicyMismatchError` on any difference:

```ts file="packages/harness/examples/sandbox-fake.ts" region="read-back"
```

## A backend says what it stops

Each backend reports a tier and the stops it claims. `mistakes` are the agent's own errors, such as a write outside the workspace. `exfiltration` is sending data to a host that is not allowed. A `hostile_process` is a program built to attack the host. Only the two hosted microVM backends claim to stop one, because a sandbox that shares your kernel cannot promise it.

- **`none`**, from `noneSandbox({ unsafe: true })`, stops nothing.
- **`os`**, from `srtSandbox()`, stops mistakes and exfiltration, on Linux only.
- **`container`**, from `dockerSandbox()`, stops mistakes and exfiltration as far as its setup allows, on Linux only.
- **`microvm`**, from `e2bSandbox()` and `vercelSandbox()`, stops mistakes, exfiltration and `hostile_process`.

The `none` tier runs a command as you, with the machine's files and network, so use it only on a machine that is already disposable. Leaving out `unsafe: true` is a type error, and a JavaScript caller gets a `HarnessError` with the code `unsafe_sandbox_not_acknowledged`. A backend that cannot start throws `SandboxUnavailableError`. No backend falls back to `none`, because a host must not run unconfined by accident. The [API reference](/reference/harness/) documents each backend's options.

## A denied command can become a request for a person

`escalation()` from `@buildanagent/harness/sandbox` decides what happens when a sandbox denies a command. The policy `never` asks nobody. Under `on-request`, the harness writes a signed request, and a person's verified answer lets the command run once more in a fresh sandbox. Only the path or host that was denied is added, and the rerun runs at most once. Escalation uses the same signed pause as [permissions](/harness/permissions/).

Some denials are never offered for widening: a path of `/`, a host with a wildcard, and any host that the policy's own deny list closes. The [package README](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/README.md#a-denied-command-becomes-a-signed-request-and-an-approved-one-reruns-once) lists them all.

## The egress proxy keeps credentials on the host

Egress is traffic that leaves the sandbox. The egress proxy is a program on the host that all of the sandbox's web requests go through. It listens on `127.0.0.1`, and you give the sandbox its address as `HTTPS_PROXY`. A Docker sandbox reaches it through a Unix socket you name instead.

The proxy refuses every host that is not on its allowlist with a 403, and it writes one log record per request: the host, the method, the status and the byte count. A record never holds a header, a body or a secret. The proxy also resolves each name itself and refuses a name that points at a private, loopback or link-local address, which includes the cloud metadata address `169.254.169.254`.

A route lets a command in the sandbox call one host without holding its credential: the host adds it. The sandbox sends its request to the proxy and puts a random placeholder, called a sentinel, where the credential goes. The proxy checks the route, the method and the sentinel, swaps in the real secret and forwards the request over HTTPS. It reads the secret from the host for every request, so a rotated key takes effect at once.

::figure[The sandbox reaches the web only through the egress proxy]{id="sandbox-egress" alt="The sandbox reaches the web only through a proxy on the host, which holds the secrets and refuses hosts that are not listed."}

An egress policy is plain data that names a credential and never holds one. This policy lets the sandbox tunnel to the npm registry and push to branches under `agent/` in one repository, using the credential that the host reads under the name `GITHUB_TOKEN`:

```ts file="packages/harness/examples/egress-proxy.ts" region="policy"
```

`compileEgressPolicy()` checks the policy and returns what `startEgressProxy()` takes. It refuses anything that is not plainly allowed with `invalid_egress_options`: a credential-shaped string, a wildcard or address in `allow`, or a credential name that is not upper case. You pass the function that reads each secret on the host:

```ts file="packages/harness/examples/egress-proxy.ts" region="proxy"
```

A host that is not in `allow` is refused before the proxy opens a connection. The refusal is an `egress_denied` error, and the log records a 403:

```ts file="packages/harness/examples/egress-proxy.ts" region="refused"
```

The message reads `the egress proxy refused evil.example: not_allowed`. The sandbox holds `proxy.sentinels.git`, a placeholder that is worthless outside this proxy.

## What the proxy does not stop

- **An allowed credential can still act.** The sandbox holds a placeholder, but it can ask the proxy to use the real secret on that route's host and methods. Scope each route to what the task needs.
- **The proxy does not read responses or inspect TLS.** A route to a service that echoes request headers hands the secret back to the sandbox, so do not route to one.
- **Any process on the host can reach a loopback proxy.** Only a process that knows a route's placeholder can use the route. A Unix socket narrows access to the socket file's permissions.

A git route limits a push to the branches it lists and refuses deletions and tags. It cannot judge what a pushed commit contains.

Two more guards keep secrets out. `spawnEnv()` builds a spawned program's whole environment from a short list, so a key set in your own environment never reaches a child, and it refuses a name such as `ANTHROPIC_API_KEY`. `scrubSecrets()` replaces known secrets in a session entry with `[REDACTED]`, and you apply it before each append.

Use a credential route only for a narrow, short-lived, low-value credential, such as a repository-scoped token for one run. A credential that can spend money without a cap or reach production data stays in a host-side tool.

Next, connect a client with the [server](/harness/server/).
