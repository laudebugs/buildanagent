# @buildanagent/harness

The harness wraps the SDK's loop with what a coding agent needs around it: a session log that survives a crash, a context policy, tools, permissions, a sandbox and credentials kept out of it. Use it to run an agent whose every turn is recorded and can be resumed, checked and replayed.

Each removable component has its own subpath, so you import only what you use and an ablation can drop the rest. `session`, `context`, `tools`, `permissions`, `sandbox`, `credentials`, `extensions`, `memory`, `mcp`, `server`, `telemetry`, `ablation` and `testing` are built.

## Install the alpha with `pnpm add @buildanagent/harness@alpha`

The package needs Node 22.19 or later. npm serves every release under the `alpha` dist-tag until the first stable one:

```sh
pnpm add @buildanagent/harness@alpha
```

All six buildanagent packages share one version, and the harness depends on that exact version of the gateway, the SDK, the protocol and `@buildanagent/agent-safety`. Name the tag: a plain `pnpm add @buildanagent/harness` installs `0.0.0-bootstrap.0`, a deprecated placeholder, because `latest` stays on it until the first stable release.

## The session log holds twenty-one entry types

`@buildanagent/harness/session` re-exports the entry union from `@buildanagent/protocol`, where the [stable fields and the JSON Schema](https://github.com/laudebugs/buildanagent/blob/main/packages/protocol/README.md#a-session-file-is-a-list-of-entries-one-per-line) are documented. Every entry carries `id`, `parentId`, `seq`, `timestamp`, `type` and `origin`. The [session format page](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/docs/session-format.md) lists every field of every type and says which are stable, and a test checks it against the JSON Schema. The types, in the order of the union:

- `session_header`: the first entry of a file, with the format, harness and SDK versions, the defaults hash, the capabilities, the ablation hash and, optionally, the parent session and the product.
- `turn_start`: a run began, with the frozen system prompt.
- `message_block` and `message_end`: one content block of a message, and the close of the message with its model and stop reason.
- `tool_result`: what a tool returned, with whether its output is trusted.
- `code_call`: a tool call that the host's own code made with `invokeTool()`, with no model step, and the earlier code call it undoes, if any.
- `permission_decision`: the permission pipeline's verdict on one call.
- `usage`: the tokens and cost of a model call, a summary or a judge call.
- `turn_end`: a run ended, with its stop reason and step count.
- `checkout`: HEAD moved to another entry.
- `compaction`: a summary replaced older entries in the context.
- `env_stamp` and `loadout`: the environment a session ran in, and a change of tools or model.
- `completion_check`: the commands that checked a finished task, and whether they passed.
- `skill_loaded` and `extension_loaded`: a skill or an extension entered the session.
- `subagent_link`: a child session exists, and which call or step started it.
- `approval_requested` and `approval_resolved`: a call waits for a person (with its signed request and the input it would run with), and the person's answer.
- `shadow_call`: a call that shadow mode recorded and did not run.
- `product_record`: a record the product owns, under a namespaced name.

## A sandbox says what it stops, and the host decides what it may touch

`./sandbox` defines `SandboxClient`, a backend that provisions a `Sandbox` for a workspace and a `SandboxPolicy`: the folders it may read and write, and the hosts it may reach. The policy is separate from the `ApprovalPolicy` that says when a denied action may be asked for again, and the model never changes either. A backend reports a `tier` and the `stops` it claims, and it claims a stop only when its tier and setup deliver it:

| Tier | Backend | Stops | What it is |
| --- | --- | --- | --- |
| `none` | `noneSandbox({ unsafe: true })` | nothing | A command runs as the user, with the machine's files and network. For a machine that is already disposable, and for tests of the rest of the harness |
| `os` | `srtSandbox()` | mistakes and exfiltration | An operating-system sandbox that shares the host's kernel, on Linux only |
| `container` | `dockerSandbox()` | mistakes and exfiltration, as far as its setup allows | A container with its capabilities dropped and no network, on Linux only |

`mistakes` are the agent's own errors, such as a write outside the workspace. `exfiltration` is sending data to a host that is not allowed. No backend claims to stop a `hostile_process`, because a sandbox that shares the host's kernel can't promise it. A backend that can't start throws `SandboxUnavailableError`, and the host must not run unconfined, so no backend falls back to `none`.

`noneSandbox()` needs `unsafe: true`: leaving it out is a type error, and a JavaScript caller gets a `HarnessError` with the code `unsafe_sandbox_not_acknowledged`. Each sandbox it provisions writes a warning to standard error, or to the `warn` option. It enforces no policy, which is what `stops: []` says.

The example below runs a project's tests in a workspace and prints the exit code, or why the command was refused:

```ts
import { noneSandbox, spawnEnv } from "@buildanagent/harness/sandbox";

const sandbox = await noneSandbox({ unsafe: true }).provision({ root: "/work/repo" }, policy);
const result = await sandbox.exec(["pnpm", "test"], { env: spawnEnv([]), signal: controller.signal, timeoutMs: 120_000 });
console.log("denied" in result ? result.denied.reason : result.exitCode);
```

`exec` takes an executable and its arguments, with no shell, and resolves with the exit code and output. A failing command is a result, not an error, and a command the policy refuses resolves with `{ denied }`. A command that runs past `timeoutMs` stops with exit code 124 and `timedOut: true`, so a command that exits with 124 itself is told apart, and one the system can't find gives 127. A command that a signal killed gives 128 plus the signal's number, with `signal` naming it. Output past `maxOutputBytes` (8 MiB for each stream by default) is dropped, and the result says `truncated: true`.

The `none` backend starts each command in its own process group. A timeout, an abort or `dispose()` therefore kills the command and everything it started, and `exec` settles even when a background process still holds the output pipes.

Bad input is an error, not a result. A working directory that isn't an existing folder, a bad `timeoutMs` or a bad `maxOutputBytes` throws a `HarnessError`. An already aborted signal rejects before the command runs, and reading a missing file rejects with the code `sandbox_not_found`.

## A denied command becomes a signed request, and an approved one reruns once

`escalation({ approvalPolicy, approvals })` from `./sandbox` decides what happens when the sandbox denies a command. The host owns that decision, and no tool or model can widen the sandbox. A wider policy is built on the host from two things only, the denial the backend reported and a verified answer, and it lasts for one rerun.

```ts
import { escalation, spawnEnv } from "@buildanagent/harness/sandbox";

const machine = escalation({ approvalPolicy: "on-request", approvals: createApprovals(harness) });
const where = { client, manifest: { root: "/work/repo" }, env: spawnEnv([]), signal: controller.signal };
const outcome = await machine.run(session, { ...where, tool: "fetch", input: { url: "https://example.com" }, command: ["curl", "https://example.com"], policy });
```

`machine.run(session, run)` runs the command once under `run.policy` and ends one of three ways. Each result carries `result`, a tool result a tool can return to the model. The model reads it only when nothing was written, as under `never`; once a request exists, the rebuilt context leaves it out and the host reads it.

- **`ran`.** The backend did not deny the command, and nothing is written.
- **`denied`.** The backend denied it, and nobody is asked, so nothing is written. That is every denial under `never`, every denial that no `granular` rule lets the host ask about, and every denial that can't be widened: a path that is `/`, relative or holds `..`, a host with a wildcard, a scheme or a path, and a host that an entry of the policy's own `network.deny` closes. An entry closes a host as `srt` matches a denied domain: `*` closes every host, `*.name` every name under `name` but not `name` itself, and any other entry that host alone, with case ignored. An entry's port is ignored, so a host closed on one port is never widened on any, and an IPv6 address is never widened while `deny` names any IPv6 address. An address must be in its canonical form: an IPv4 address as four decimal octets with no leading zero, and an IPv6 address that does not wrap an IPv4 one. A host whose last label is a number counts as an IPv4 address, so `127.1`, `2130706433` and `0x7f.1` can't be widened, and a deny entry closes an IPv4 address it names in any spelling, such as `10.1` for `10.0.0.1`. A host that reaches the machine itself or its link is never widened, whatever `deny` says: `localhost` and the names under it, and the unspecified, loopback and link-local addresses, which hold the cloud metadata address 169.254.169.254. A name that DNS resolves to a closed address can't be seen here, so the backend's own deny list still covers it.
- **`awaiting_approval`.** Under `on-request`, or `granular` where a rule allows it, `run()` writes an `approval_requested` entry before it returns. The harness's signer signs the request as `createPendingRequest()` does, and the request's tool is `ESCALATION_TOOL` (`sandbox.escalation`), a name no registered tool can have. Its input is the record the approver sees: the tool and its input, the command, the workspace root, the policy and the denial. `widened` is the policy the rerun would get.

`run()` writes only when it asks. A tool's `execute` may call it under `never`, and under the other two policies host code calls it between turns, as it calls `invokeTool()`, because a write inside a turn's tool step can race the turn's own writes.

`machine.resolve(session, resolution, options)` answers one request. The log holds no backend, workspace, environment or signal, so `options` passes them again:

```ts
import { spawnEnv } from "@buildanagent/harness/sandbox";

const rerun = await machine.resolve(session, { requestId, decision: "allow", by: "grace" }, { client, manifest: { root: "/work/repo" }, env: spawnEnv([]), signal: controller.signal });
```

- **The check comes first.** Before anything is written, the answer is checked against the request: the signature under a key in the ring, the bound host context, the call, and the record, which must hash to the signed hash. A forged, re-signed or edited request throws `approval_refused`, writes nothing and runs nothing.
- **Only a named person or hook approves a rerun.** An allow with no `by`, or whose `by` starts with `classifier:` in any case, throws `approval_refused`, writes nothing and leaves the request waiting. A person's or a hook's allow approves it. `by` is not covered by the request's signature, so set it only after you have authenticated the approver.
- **The quorum policy decides.** The answer is written, and the approvals' quorum policy decides the answer. A quorum that still waits returns `awaiting_approval`, and a deny, a rejection or an expiry ends `denied` with no rerun.
- **An abort before the answer is written writes no answer.** `options.signal` is checked when `resolve()` is called and again just before the answer is written, so an abort by then runs nothing and the request still waits. Once the answer is written the approval is spent, and an abort only reaches the rerun, as `Sandbox.exec()` takes a signal.
- **A deny rule added since the pause wins.** An allow goes through the permission pipeline again, as the tool call the command ran for.
- **The rerun runs once, no wider than the denial.** It runs in a fresh sandbox under the recorded policy plus exactly the path or host that was denied, and that sandbox is disposed after it. A second denial is the rerun's result: it ends `denied`, and nobody is asked again.

Every move follows `ESCALATION_TRANSITIONS`, a table of the states `sandboxed`, `denied`, `requested`, `approved`, `rerun` and `done` and the events between them. A result's `status` and the state `denied` are different things: `status` is how the call ended, and `states` is the path it took. `nextEscalationState()` throws `invalid_escalation` for an edge the table does not list. Only a verified allow leads from `requested` to `approved`, and `rerun` leads only to `done`. Each result's `states` lists the states its call passed through.

A rerun runs at most once, even across a crash. It *starts* once the log holds the pipeline's fresh decision after a final allow, the last entry before the rerun runs. To *settle* an escalation is to write the result it lacks. The next `resolve()`, or `run()` that asks, settles each escalation a crash left open: a rerun that started may have run, so it is settled as such and never run again, and an answer whose rerun never started is settled as never run. The result is a `tool_result` with the tool `sandbox.escalation`. The rerun's output, and any sentence that quotes a backend's denial, an error's message or an approver's reason, is marked `untrusted`; only the harness's own fixed sentences, such as a crash's settlement, are marked `trusted`. The model never reads the result, because the rebuilt context leaves out each result whose call id is an escalation's; a result the model's own call got stays, even for a call to a tool it named `sandbox.escalation`. The host gets the command's output from `resolve()`. The log keeps at most 4,096 characters of each of the rerun's output streams, and `resolve()` returns all of it.

`approvals.pending()` and `approvals.resolve()` don't see an escalation: `machine.pending(session)` lists the ones that wait. It asks the quorum policy about each with the answers written so far and leaves out one the policy says has expired. Listing writes nothing, so an expired escalation stays in the log until it is answered, and `resolve()` then writes the policy's denial and runs nothing. A `granular` policy takes `granular`, a list of rules of the form `{ kind?, tool?, escalate }`. The first rule that matches the denial's kind and the tool decides, and a denial no rule matches goes back with no request. `escalation()` throws `invalid_escalation` for rules given with another policy, for a `granular` policy with none, and for approvals that `createApprovals()` did not make. A policy that can ask also needs a harness with a signer and a permission pipeline: without the signer it throws `approval_unavailable`, and without the pipeline `invalid_escalation`.

## The srt backend confines each command with Anthropic's OS sandbox

`srtSandbox()` from `./sandbox/srt` runs each command under `srt`, Anthropic's sandbox runtime. It pins `@anthropic-ai/sandbox-runtime` 0.0.83 under the Apache-2.0 license. The package calls itself a "Beta Research Preview", and says its APIs and configuration formats may evolve (as of November 2026). `provision()` writes the settings file, so `./sandbox/srt` is the one place that knows that format.

The backend claims `mistakes` and `exfiltration` on Linux and nowhere else, because Linux is the only platform it is tested on. It needs `bwrap` (bubblewrap) and `socat` on the `PATH`. `provision()` starts `srt` once with a command that does nothing. A missing program, an unsupported platform or a host where `srt` can't start a command therefore throws `SandboxUnavailableError`, and nothing runs.

The policy maps to `srt`'s settings like this:

- **Reads.** `srt` denies every read, then allows the read roots, the write roots, the system folders a program needs to start (`/usr`, `/bin`, `/lib`, `/etc` and a few more) and `srt`'s own helper folders. Anything else, such as `/home`, is out of reach. `extraReadRoots` adds folders, such as a toolchain's.
- **Writes.** Only the write roots are writable. `denyWrite` keeps a folder read-only inside a write root, which is how the session's own log folder stays out of the agent's reach. `writeFile` refuses the same folders, and the files `srt` protects, such as `.bashrc`, `.claude` and `.git/hooks`.
- **Network.** The command has no network of its own. Its traffic goes through a proxy that allows only the policy's hosts. `parentProxy` sends allowed traffic through an upstream proxy for a host that sits behind one.

Every path is passed as a literal, so a folder named like a pattern is never read as one. The settings file and a run folder for `srt`'s proxy sockets live in a private folder that `dispose()` removes. A command can read the run folder and nothing else in it, so it can't read the settings file, which may hold a proxy address.

A command's environment holds the variables it was given, plus the proxy variables `srt` adds, which `SRT_ADDED_ENVIRONMENT` lists. `srt` itself starts with only a `PATH` and its own `TMPDIR`. The given variables pass through `env` inside the sandbox, so a variable such as `NODE_OPTIONS` can't make `srt`'s own Node load code outside it. The backend never copies the host's `process.env`. A command whose first word contains `=` resolves with exit code 127, as under `none`.

Four limits are worth knowing:

- **Shared kernel.** The sandbox is a set of Linux namespaces, so a process that is trying to escape is out of scope, and no `hostile_process` stop is claimed.
- **No TLS inspection.** The proxy allows or refuses a host by name and does not read what a command sends it.
- **File calls run in the host.** `readFile` and `writeFile` check each path by its real path, so a symlink that leads out is refused. They check the opened file again through `/proc`, though a hostile process could still win that race. They don't run under `srt`, because two `srt` processes in one workspace can disturb each other: each makes and removes empty protected files there. Commands that run at the same time in one workspace share that risk.
- **Cleanup depends on `srt`.** A stopped command gets a `SIGTERM` and two seconds before the `SIGKILL`, so `srt` removes its protected files. A `SIGKILL` from outside leaves them.

The package's opt-in sandbox tests run the conformance suite and the escape cases against the real `srt`, and they fail on a skipped case instead of skipping. They are opt-in because they start bubblewrap. Without `srt`, the other tests check the settings and the unavailable paths.

## The Docker backend runs each command in a locked-down container

`dockerSandbox({ image })` from `./sandbox/docker` runs each command in its own container, made from an image that is already on the Docker host: `provision()` never pulls, and you should pin the image by digest. The container has all capabilities dropped, a read-only root file system, no network, no new privileges and no shared IPC.

The container also has a limit on processes (`pidsLimit`, 256 by default), CPUs (`cpus`, 1) and memory with no swap (`memoryMb`, 1024). It runs as your user and group, so the files it writes stay yours, and its only other writable place is a 64 MiB `/tmp` in memory.

The policy decides what is mounted, at the same path inside as outside. A write root is mounted writable, and it must exist. A read root and an `extraReadRoots` folder are mounted read-only. A `denyWrite` folder inside a write root is made if it is missing and mounted read-only on top, so the session log stays out of the agent's reach. A `denyWrite` path outside every write root is not mounted at all. The protected files that `srt` also guards, such as `.bashrc`, `.claude`, `.git/hooks` and `.git/config` at the top of a write root, are mounted read-only when they exist, and `writeFile` refuses them. Nothing else is mounted, so a path outside the roots does not exist in the container.

The workspace must lie inside a root. The backend never mounts the Docker socket: a root that resolves to `/`, or that holds the daemon's socket (`/var/run/docker.sock`, `/run/docker.sock` or the one `dockerHost` names), is refused.

The container has no network, so a command reaches a host only through `proxySocket`: a Unix socket on the host, mounted at `DOCKER_PROXY_SOCKET_PATH` (`/run/harness/proxy.sock`), that the credential proxy listens on. The program in the image has to speak to that socket itself. Without `proxySocket`, no host is reachable, including the ones the policy allows, so `provision()` refuses a policy whose `network.allow` names one.

`provision()` starts the `docker` client with a clean environment: a `PATH`, a private empty `HOME`, and `DOCKER_HOST` when the option or the host sets one. It never copies the host's environment. A missing client, a daemon that doesn't answer or an image that isn't on the host throws `SandboxUnavailableError` and runs nothing.

A command's environment is exactly the one it was given. `env -i` clears the image's own variables, so the image needs an `env` that takes `-i` and `--`, as BusyBox and GNU coreutils do. It also clears `PATH`, and a program name is then looked up on the C library's default path, which differs between images. Pass a `PATH`, as `spawnEnv()` does, for a program that lives elsewhere, such as `/usr/local/bin/node` in a Debian image. A command whose first word contains `=` resolves with exit code 127, as under `none`.

Each command is created and then started. A timeout, an abort or `dispose()` kills the container by name, so nothing outlives the call, and `dispose()` also removes any container of this sandbox that a stopped client left behind.

Five limits are worth knowing:

- **Shared kernel.** A container shares the host's kernel, so a process that is trying to escape is out of scope, and no `hostile_process` stop is claimed.
- **Protected files made later.** A protected file that is missing when `provision()` runs, or one in a subfolder, is not protected inside the container, because a mount needs a file to cover. An agent could write `.git/hooks/pre-commit` there, and the host's next `git commit` would run it. Keep `.git/hooks` and `.git/config` in place, or list them in `denyWrite`.
- **Linux and a rootful daemon.** Only Linux was tested, against a rootful daemon. Rootless Docker mounts differently and was not tested.
- **File calls run in the host.** `readFile` and `writeFile` check each path by its real path and through `/proc`, as under `srt`, and `writeFile` refuses a `denyWrite` folder. A hostile process could still win that race.
- **The network lock rests on the daemon.** `--network none` is checked by inspecting the running container, because a test host with no bridge can't tell a closed network from a missing one.

The same opt-in tests run the conformance suite and the lock-down cases against a real daemon, with a pinned Node image, and fail on a skipped case. Without Docker, the other tests check the flags and the unavailable paths with a fake client.

## A backend that claims a stop reads its policy back, and one that can't resume says so

A backend that claims a stop reads back the policy it applied, and `provision()` compares it with the request before it returns. `srtSandbox()` rereads its settings file from disk, and `dockerSandbox()` reports the mounts and flags it creates each container with. If any field differs, `provision()` disposes the sandbox and throws `SandboxPolicyMismatchError`, so nothing runs under a policy you didn't ask for. The check treats `readRoots`, `writeRoots`, `network.allow` and `network.deny` as sets, and a narrower policy throws too.

One gap remains: a `denyWrite` that names a write root exactly. Docker mounts such a root read-only, but the read-back counts the caller's `denyWrite` as part of the request, so it still reads back as a write root and `provision()` accepts it. Nothing in that root is writable inside the container.

The error's code is `sandbox_policy_mismatch`, and its `field` names the first field that differs, such as `network.allow`. The message never holds a path or a host. The code below catches the error and prints that field:

```ts
import { SandboxPolicyMismatchError } from "@buildanagent/harness/sandbox";
import { srtSandbox } from "@buildanagent/harness/sandbox/srt";

const attempt = srtSandbox().provision({ root: "/work/repo" }, policy);
await attempt.catch((error) => console.log(error instanceof SandboxPolicyMismatchError ? error.field : error));
```

A client that claims a stop but gives its sandbox no read-back, or one whose read-back fails, makes `provision()` throw the same error, with the field `readBack`. `noneSandbox()` claims no stop, so it needs none.

`stopsFor(tier, policy)` computes the stops that an applied policy delivers. Only a `microvm` stops a `hostile_process`. A policy that allows `*`, `0.0.0.0/0` or `::/0` loses `exfiltration`, and a root of `/` loses `mistakes`. A client that claims a stop its applied policy doesn't deliver is refused with the field `stops`, and the message names the cause, such as that the policy allows all hosts, so the sandbox cannot stop exfiltration. `srtSandbox()` and `dockerSandbox()` both claim `mistakes` and `exfiltration`, so `provision()` refuses a policy that allows every host on either.

A hosted backend can also list `capabilities`: `resume`, `snapshot` and `pause`. Call them through `resumeSandbox(client, id, policy)`, `snapshotSandbox(client, sandbox)` and `pauseSandbox(client, sandbox)`. A resume reads the policy back as `provision()` does and sets the handle's `stops` from it. Unlike `provision()`, a resume that finds a mismatch throws and leaves the sandbox alone, because disposing it would destroy a paused sandbox and its work: the caller decides whether to dispose. A capability the client doesn't list rejects with `SandboxUnsupportedError`, code `sandbox_unsupported`. The `none`, `srt` and Docker backends list none, so a resume, a snapshot or a pause on them is always refused.

None of this authenticates a caller. The read-back shows that the sandbox applies the policy you asked for, and the host still decides who may ask.

## The egress proxy keeps every credential outside the sandbox

`startEgressProxy({ allow, routes, log })` from `./credentials` starts a proxy on `127.0.0.1`, or on a Unix socket you give it (`socketPath`, which is what `dockerSandbox`'s `proxySocket` mounts). Nothing leaves the sandbox except through it. It refuses everything that isn't on its allowlist with a 403, and it writes one log record for each request: the host, the method, the status and the bytes, never a header or a body. Give the sandbox `proxy.url` as `HTTPS_PROXY`. On a Unix socket, `proxy.url` is `unix:<path>`, which is not a proxy URL, and the program inside the container connects to the socket itself.

A tunnel (`CONNECT`) goes only to an allowlisted name on an allowlisted port, which is 443 unless the entry says `:port`. An entry is a name, or `*.name` for every name under it. The proxy resolves the name itself, checks every address it gets, and refuses the whole request if any one is not public: loopback, link-local (which holds the cloud metadata address 169.254.169.254), private, shared, multicast and reserved ranges, for IPv4 and IPv6, and IPv6 addresses that wrap one of them. The refused ranges include the IANA special-purpose ones and the deprecated site-local and IPv4-translated forms.

The proxy then connects to the address it checked, so a name that answers differently a moment later can't redirect the connection. An address literal as a target, an HTTP proxy request in absolute form and a malformed target are refused without a lookup.

A tool that needs a credential uses a route. `routes` lists, for each one, a name, an HTTPS host, the methods it accepts, the header that carries the credential and a function that returns the real secret. The sandbox sends `http://127.0.0.1:<port>/<route>/path` and puts `proxy.sentinels[route]`, a random placeholder, where the credential goes, such as `Authorization: Bearer <sentinel>`. The proxy checks the route, the method and the sentinel, replaces the sentinel with the secret and forwards the request over HTTPS to the route's host, with the same address check.

The secret is read for each request, so a rotated key is used at once, and it never enters the sandbox's environment, a log record or a response from the proxy.

`proxy.fetch(input, init)` is for tools that run in the harness's own process, which a network sandbox doesn't confine. It applies the same allowlist, address check and pinned connection, and it rejects with `egress_denied` for a host that isn't allowed. It uses HTTPS only and doesn't follow redirects, so each hop is a new call that the allowlist checks. An upstream status outside 200 to 599, which Node parses and a Web `Response` refuses, rejects with `egress_denied`, closes the upstream connection and is logged with the reason `bad_status`. An answer that breaks after it has begun is logged once, when it closes. A URL under `proxy.url`, or under `http://egress.proxy`, which also works on a Unix socket, is a route request with the same injection. An aborted signal rejects with its reason.

`scrubSecrets(entry, secrets)` returns a copy of a session entry with each secret replaced by `[REDACTED]`, in every string and key at any depth, and also when the secret was percent-encoded, JSON-escaped or turned into base64, alone or inside a longer value such as a Basic authorization header. An entry's `type`, `id`, `parentId`, `seq`, `timestamp`, `origin` and `formatVersion` are never rewritten. Apply it before every append, with `await proxy.knownSecrets()` and the tokens and session URLs of any hosted-browser, CDP or OAuth connector tool, because the scrubber can only remove a secret it is told about.

Four limits are worth knowing:

- **An allowed credential can still act.** The sandbox holds a placeholder, not the secret, but it can ask the proxy to use the real one on that host and those methods. Scope each route to the host and methods the task needs.
- **A service that echoes the credential back reveals it.** The proxy doesn't read responses, so a route to a service that returns the request's headers hands the secret to the sandbox. Scrub the entry, and don't route to such a service.
- **No TLS inspection.** A tunnel is an opaque stream: the proxy knows the name, not what the tool sends. Only a route can add a credential, and only a route sees the request.
- **Local processes can reach it.** The proxy listens on loopback, so any process on the host can use its allowed tunnels. Only a process that knows a sentinel can use a route, and sentinels are random for each proxy. A Unix socket narrows access to the socket's file permissions.

The package's tests run the proxy against a real HTTPS server on loopback, with a self-signed certificate that only the test trusts and a table in place of DNS.

## An egress policy names a credential and never holds one

`EgressPolicy` is plain data: an `allow` list of exact host names, and `routes` that each name the credential they inject. `compileEgressPolicy(policy, { secret })` checks it and returns the `allow` and `routes` that `startEgressProxy()` takes. The compiled routes call `secret(name)` for each request, on the host, so a rotated credential is used at once. The code below compiles one git route and starts a proxy with it:

```ts
import { compileEgressPolicy, startEgressProxy } from "@buildanagent/harness/credentials";

const route = { kind: "git", route: "git", host: "github.com", repositories: ["acme/app"], pushRefs: ["refs/heads/agent/*"], credential: "GITHUB_TOKEN" } as const;
const compiled = compileEgressPolicy({ allow: [], routes: [route] }, { secret: async (name) => process.env[name] ?? "" });
const proxy = await startEgressProxy({ ...compiled, log: audit });
```

The compiler refuses anything that isn't plainly allowed, with the code `invalid_egress_options`, and its message names the place of the entry and never its value:

- a field that a route kind doesn't have, such as `secret` or `token`;
- a string that looks like a credential: a value, or a whitespace-separated token, that starts with `ghp_` or `sk-` and has a long enough body, or a whole 20-character AWS key id. A name that merely contains a prefix, like the repository `sk-labs/app`, is allowed;
- a credential name that isn't upper case;
- a wildcard or an address literal in `allow` or in a route's `host`;
- a git route whose `host` is also in `allow`, or is the host of any other route, because a tunnel or a header route to that host would go around the ref filter. `startEgressProxy()` enforces the same rule on routes it is given directly.

The scan for credential-shaped strings is defence in depth. The field allowlist and the upper-case credential name are the real guards, and a token that starts mid-word, like `acme/ghp_…`, or is base64-encoded passes the scan.

The policy holds names, the proxy reads each value on the host, and the sandbox sees only a random placeholder, so no credential value enters a sandbox. The policy does not authenticate a caller: any process that knows the placeholder can use the route. `EgressPolicy` is not yet part of `SandboxPolicy`, and `srtSandbox()` keeps its own proxy.

## A git route lets a push reach listed branches and nothing else

A route of kind `git` carries git over HTTPS for the repositories it lists, and nothing else. The sandbox's remote is `http://x-access-token:<placeholder>@127.0.0.1:<port>/git/acme/app.git`, where `git` is the route's name and the placeholder is `proxy.sentinels.git`. The proxy swaps the placeholder for the credential and sends it to the host in HTTP Basic, with the route's `username`, which is `x-access-token` unless you set one. A request with no credential gets a 401 challenge, so git asks for one.

A push is checked before anything is forwarded. The proxy reads the command list at the start of the body and refuses the whole push when one command breaks a rule:

- a deletion, a tag, or a ref that no `pushRefs` pattern matches;
- a push certificate, a body with a `content-encoding` other than `identity`, or a pkt-line that is malformed or not UTF-8;
- a command list over 64 KiB (`GIT_MAX_COMMAND_BYTES`) or over 64 commands (`GIT_MAX_COMMANDS`).

When a push is bigger than git's `http.postBuffer` (1 MiB by default), git first sends a probe whose body is a single flush packet. The proxy treats that body as an empty command list and forwards it, and it refuses any byte after the flush.

The command list has two timeouts. `idleTimeoutMs` restarts on each chunk, so a stalled client is cut off and a slow one is not. It takes a whole number from 0 to 2,147,483,647, and 0 turns the idle timeout off, as for a socket's timeout; any other value makes `startEgressProxy()` throw `invalid_egress_options`. `pushCheckTimeoutMs` never restarts, and it covers the command list only, not the pack, so a client that sends one byte at a time is cut off too. Its default is 60,000 ms, and it takes a whole number from 1 to 2,147,483,647. The 64 KiB limit applies however the list is split across chunks. A refused push gets a 403 with `Connection: close`, and the proxy stops reading the rest of the body: it discards what is already in flight, up to 1 MiB or for 1 second, then ends the response, so a large pack cannot keep the connection open.

A pattern is a branch such as `refs/heads/main`, or a prefix such as `refs/heads/agent/*`, which matches the branches under `agent/` and not `agent` itself. A route with no `pushRefs` refuses every push, and one with `fetch` left out refuses every fetch.

A route has two limits. With `fetch` on, the sandbox can read every ref of a listed repository, because a fetch is allowed or refused for the whole route. And a route filters git's HTTP requests only, so it says nothing about what a pushed commit contains. The package's tests run a real `git push` over loopback to a fake GitHub on HTTPS: a push to an agent branch arrives with the token, and a push to `main`, a tag and a deletion never reach it.

## Every spawned process gets a cleared environment

`spawnEnv(allow, extra)` builds the whole environment for a spawned process. It returns `PATH`, a fresh temp `HOME`, `TMPDIR` and `LANG`, the parent variables that `allow` names and the parent has, and `extra`. Nothing else is copied, so a key set in the parent never reaches a child. The caller removes the temp `HOME` when the process is done; an `extra.HOME` replaces it and no folder is made. `PATH` is the parent's with every entry that isn't absolute removed, so a `.` can't run a program from the working directory, and `TMPDIR` is the shared system temp directory, not a private one.

A name that isn't a valid variable name, or a value with a NUL character, throws a `HarnessError` with the code `invalid_spawn_env`. `allow` also refuses three kinds of name:

- a reserved name, which is always set already;
- a name that makes a program load code, such as `NODE_OPTIONS` or `LD_PRELOAD`;
- a name that looks like a credential: one with a `_`-separated part such as `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PAT` or `AUTH`, or a connection string or proxy URL such as `DATABASE_URL` or `HTTPS_PROXY`. So `ANTHROPIC_API_KEY` is refused and `GIT_AUTHOR_NAME` isn't.

The check goes by name and can't catch a credential under an unremarkable one, so name only variables you know. A credential can reach a child only as an explicit `extra`, written in code, such as a dummy key for the credential proxy. That keeps credentials out of the sandbox.

## Test a sandbox with the fake and the conformance suite

`./testing` has `fakeSandbox()`, a sandbox in memory that enforces the policy it is given and records every `exec`, but runs no program: it understands `echo`, `env`, `cat`, `write`, `true`, `false`, `sleep` and `net-probe`, plus `find`, `grep` and `bash -c` or `sh -c` with one of those commands as the script, which is what the built-in tools run. It claims tier `os`, because it enforces file roots and the network allowlist, but it confines no real process.

`runSandboxConformance(factory)` pins the interface for every backend. Its cases check that a file reads back as written, that `exec` reports exit codes and output, that the environment holds only the variables given, that an aborted signal rejects and a timeout stops with 124 and `timedOut: true`, and that `dispose` ends the sandbox and any command still running. When the caller passes `processTree`, a case also checks that an abort or timeout ends the command's whole process tree. A backend that adds variables of its own, such as proxy settings, lists them in `addedEnvironment`, and the environment case accepts those and no others.

A case that needs enforcement runs only when the backend's `stops` claim it:

- a write or read outside the roots, and a path that climbs out with `..`;
- a symlink that points outside, where the factory passes a `symlink` function;
- a working directory outside the workspace;
- the network, where the caller passes two hosts it controls, such as two loopback listeners: the allowed one must be reached and the blocked one must not.

Three more cases check the read-back and the capabilities: a backend that claims a stop reads its policy back equal to the request, a read-back that differs throws `sandbox_policy_mismatch` and disposes the sandbox, and a capability the backend doesn't list is refused with `sandbox_unsupported`. `fakeSandbox({ applied })` applies a policy in place of the request, as a provider that widens it would.

`none` passes the rest and skips those with a reason, and a backend that can't start skips every case with its reason and fails none. The suite tells errors apart by `isHarnessError()` and the error's `code`, so a backend bundled separately from the suite still passes. `sandboxConformanceCases(factory)` returns the same cases one by one, for a runner that wants a test for each.

## One registry names, defers and wraps every tool

`@buildanagent/harness/tools` holds the tools of every source in one registry, so permission rules, tool search and the session log read one description of each. `createToolRegistry()` returns it, and `register()` adds a tool with its source: `builtin`, `extension`, `client` or `mcp:<server>`.

- **Names.** A tool's canonical name is checked once, at registration, against the SDK's rule of 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. An MCP tool is namespaced as `mcp__<server>__<tool>`. A second tool with a name already taken throws a `DuplicateToolError`, and an extension replaces a built-in only with `override: true`.
- **Hashes.** An MCP tool whose server or tool name needs cleaning, holds a double underscore, starts or ends with an underscore, or makes the name run past 64 characters gets `_` and an eight-digit hash of its source and name. A name therefore depends on its tool alone and never on what was registered before it.
- **Aliases.** A native or display alias stays apart from the canonical name. No alias may equal another tool's name or alias, in either order of registration, so a rule that matches either matches one tool.
- **All or none.** `registerAll(tools)` registers a list, or none of it: when one tool is refused, it removes the ones the list registered before it and throws the error.
- **Exposure.** Every source has an exposure that the registry writes to each tool's `exposure`: `deferred` for MCP tools and `direct` for the rest. `setExposure(source, exposure)` changes it for a source, now and for tools registered later. A run keeps the exposure `definitions()` gave its tools, so call `definitions()` again for the next run. `definitions()` returns the tools in registration order and keeps it, so the cached prefix does not move when a tool activates.
- **Tool search.** `toolSearchTool(registry, { activated })` is a `tool_search` tool, and `activated` is required. It matches a query against the `deferred` tools' names and descriptions, records the best matches in `activated` and names them to the model, with the description of a trusted tool. An untrusted tool's description, such as an MCP server's, counts as one matched word at most and is never quoted, and one untrusted source takes at most half the results. `toolSearchInterceptors(registry, activated)` sends the run's tools, including any from outside the registry, plus the activated ones. A deferred tool is therefore absent from each request until the model asks for it, and present in the next. The search ignores common words such as `the` and `for`, counts a repeated word once, and takes a `maxResults` of 1 or more. A `hidden` tool is never found, and `tool_search` itself is always sent, so a source set to `deferred` cannot leave the model with no way to find a tool. Register `tool_search` in the registry, because the interceptor sends it by that name and throws when the registry lacks it. Pass the same set to the tool and the interceptor, and a new one to each run.
- **Host context.** `definitions(wrap, hostContext)` runs each tool through `wrap`, which can bind a write cap, shadow mode, a sandbox or the turn's host context. The registry sets the result's name and exposure, so a wrapper cannot rename or expose a tool. The host context reaches `execute` by the wrapper's closure, never through a schema, so it is in no request, event or saved context.
- **Output trust.** A tool's `outputTrust` is `untrusted` for an MCP tool and for a tool registered with `remoteAgent: true`, `trusted` otherwise, and the value a registration declares wins. `approvalReuse` defaults to `both`, and `pattern` records whether the tool runs `in_process` or by a `client_request`.
- **Preamble size.** `preambleTokens({ system })` estimates the tokens a request carries before any message: the system prompt and every `direct` tool. A `deferred` tool adds nothing, which is why the default for MCP is `deferred`. A `RegisteredTool` that `register()` returns is a snapshot, so call `get()` after `setExposure()` to read the current exposure.

## The built-in tools reach files, commands and the web only through the sandbox and the egress proxy

`builtinTools(sandbox, proxy, { root, policy })` returns up to seven tools for one provisioned sandbox: `read`, `write`, `edit`, `bash`, `grep`, `glob` and `fetch`, which needs a proxy, so six without one. No tool touches the host. Files go through the sandbox's `readFile()` and `writeFile()`, commands through its `exec()`, and the web through the proxy's `fetch()`, so the backend and the allowlist decide what each call can reach. This coding agent binds them to a workspace and lets `read` open the write cap's spill files:

```ts
  const sandbox = await client.provision({ root: workspace }, policy);
  const spill = fileSpillStore({ dir: spillDir });
  const registry = createToolRegistry();
  const spills = (path: string) => spill.read(key, path);
  for (const tool of builtinTools(sandbox, proxy, { root: workspace, policy, spills })) registry.register(tool);
  const harness = createHarness({ registry, model, system: SYSTEM, context: createContextPolicy({ spill }) });
```

Pass the `root` and `policy` the sandbox was provisioned with, because the sandbox interface reports neither. Leave `proxy` out, as `undefined`, and the set has no `fetch`. `env` is the whole environment of every command the tools run; it defaults to a `PATH` and a `LANG` alone, and on Node you pass `spawnEnv()`.

Each tool's contract:

- **`read`** takes `path` or `file_path`, relative to `root` or absolute, `offset` (the first line, from 1), `limit` (a line count) and `column` (where to start in the first line, from 1, to read on in a line too long for a page). With none of the three, it returns the whole file up to 2,000 lines and 32 KiB, and a longer file or a page ends with a line that names the next `offset`. The write cap counts bytes after JSON escaping, so `read` counts 32 KiB the same way (a quote, a backslash or a newline costs two bytes). A page therefore always passes the default 64 KiB cap whole. A line longer than a page is shown in parts, and each part's last line names the `offset` and `column` where the next starts, so a cut result that is one long line can still be read in full. Only an absolute path is offered to the `spills` reader, and a path it knows is served from the spill; a relative path always reads the workspace. A binary file is an error result.
- **`write`** takes a path and `content`, makes the folders and replaces the whole file.
- **`edit`** takes a path, `old_string` and `new_string`. `old_string` must occur exactly once: no match, or two matches without `replace_all: true`, returns an error result and leaves the file unchanged. `new_string` is inserted as written, so `$&` stays `$&`. A byte order mark is kept, and a binary file or one that is not UTF-8 is an error result, left unchanged, because writing it back as text would corrupt it.
- **`bash`** runs `command` as `bash -c` inside the sandbox, from `root`, with a timeout of `timeout_ms` (default 120,000, at most 600,000). The model reads the output, standard error and exit code. A timeout or a denial is an error result, and each stream keeps at most 1 MiB. Only the sandbox's `timedOut` flag marks a timeout, so a command that exits with 124 itself reads as that exit code.
- **`grep`** searches files for `pattern`, an extended regular expression, below `path` (default `root`), and prints `path:line:text`. `glob` narrows the files: a glob with no `/`, such as `*.ts`, matches the file name, and any other matches the path below `path`. `ignore_case` ignores case. Binary files are skipped (`grep -I`).

  The matching lines stop at 1 MiB, across every `grep` command the call runs, and a result cut there says so, so the model can narrow the search. If the first matching line alone passes 1 MiB, the result still says that lines match, names the file and line, and suggests a narrower search or `read`; it never reports "no match". A file `grep` can't read, or a folder `find` can't list, keeps the matches found elsewhere and adds a line quoting the error; the call fails only when nothing matched.
- **`glob`** lists the files below `path` whose path matches `pattern`, sorted. `*` matches inside one name, `**` across folders and `?` one character.
- **`fetch`** sends a GET for an `https` `url` through `proxy.fetch()`. It returns the status line, the final URL, any `location`, the content type and, for a text body, up to 1 MiB of it. A body of another type is left out and reported by its size. Every secret the proxy knows is replaced by `[REDACTED]`, and a body cut at 1 MiB also loses any start of a secret left at its end.
  - A text body is read in the charset its content type names, when `TextDecoder` knows that label, and as UTF-8 otherwise.
  - A body with no content type, or with a charset label `TextDecoder` does not know, is shown only when it reads as UTF-8 text with no NUL byte.
  - A request that takes over 30 seconds returns an error, as do a host off the allowlist and a URL that is not `https`. Plain HTTP is refused, which keeps the model off the proxy's credential routes.

**Paths are checked before the sandbox sees them.** `read`, `grep` and `glob` accept a path inside a read or write root, and `write` and `edit` only inside a write root. A path with a backslash is refused, because the workspace is POSIX, where `\` is part of a name, while the permission rules read it as a separator. The check joins a relative path to `root` and removes `.` and `..`, so `../etc/passwd` and `/etc/passwd` are refused without a sandbox call, and the sandbox gets the checked path. A symlink is invisible to a check on text, so the sandbox's own check of the real path is the second line: its denial reaches the model as an error result. `grep` and `glob` list files with `find`, which never follows a symlink, and skip folders named `.git` and `node_modules` below the folder searched, so a search of `node_modules` itself still works.

**Big results pass the write cap like any other.** The tools cap nothing themselves: the context policy's write cap cuts a long result and spills its full text, and `read` with `spills` opens that spill. Bind `spills` to one session, as `fileSpillStore().read(key, path)` already does, so one session cannot read another's spills.

**Scheduling follows what each tool changes.** `read`, `grep`, `glob` and `fetch` are first-party and read-only, so their calls in one step run together. `write` and `edit` declare a write, so they wait for the file calls before them, and `bash` runs its step one call at a time. A crash during a write makes the next turn report its outcome as unknown. Only `fetch`'s output is `untrusted`, because a web page can carry instructions; the rest is `trusted`, though a workspace file or a command's output can carry instructions too.

**The descriptions are versioned.** Every description, limit and default the tools use is in `BUILTIN_TOOL_DEFAULTS`, and `BUILTIN_TOOLS_HASH` changes whenever any of them does, so two runs with different hashes ran with different tools.

## One pipeline decides every tool call, and a call no rule settles is denied when nobody can answer

`@buildanagent/harness/permissions` decides each tool call in one order: hooks, deny rules, ask rules, the mode, allow rules, the host callback, then the no-match default. A deny at any step ends the decision, so a deny rule beats every mode, `bypass` included, and a hook's deny beats everything. `createPermissionPipeline(config, registry)` returns a pipeline, and `pipeline.gate(context)` is the SDK's `beforeToolCall` gate, where `context` gives each call its session, host context and entries.

- **No match.** With no host callback, a call that no rule settles asks when `interactive` is `true` and is denied when it is `false`.
- **Hooks.** A hook returns a deny, an ask or nothing, and its type has no allow. A hook that returns an allow, or anything else, denies the call. A hook's ask stands unless a deny rule matches later, and a hook that throws denies. A classifier belongs in a hook, which can only restrict, or in the host callback, whose allows carry `by: "classifier:<id>"` in the log.
- **Rules.** A `Rule` names a tool by name, alias, a `*` pattern or a regular expression. It may add `paths`, globs matched against the input's path fields (`path`, `file_path`, `paths` and a few more, normalised so `./` and `..` do not slip past), and `commandPrefix`, the leading words of a shell command. A deny or ask rule matches when any path or any part of a chained command matches. A relative glob in such a rule matches below any directory, because the pipeline doesn't know the working directory. An allow rule needs every path inside its globs, counted from the workspace root, and every part of the chain covered by some allow rule, so `git status && rm -rf /` is not allowed by a rule for `git status`.
- **Shell parsing reads what a shell would run, to three levels.** For every rule it splits a command on `&&`, `||`, `;`, `|`, `&` and newlines outside quotes, and reads subshells, groups and the script of a shell given `-c`. For deny and ask rules it also reads `$( )`, backticks and `<( )`, and looks past a program's directory, `sudo -u root`, `env -i`, `timeout 5`, `xargs`, `eval`, `NAME=value` words, keywords such as `{` and `!`, and git's global options, as in `git -C dir rm`. A command given as a word list is read the same way.
- **Shell parsing fails closed.** A command with a substitution, or an `$'...'` word with an escape, is never allowed by a rule, because its parts can't all be read. An allow rule with a `commandPrefix` does not cover a redirection to or from a file, only a copy of one stream to another and a redirect to `/dev/null`. A command nested deeper than three levels, or carried in a field the parser doesn't know, counts as a match for every deny and ask rule that has a `commandPrefix` for the tool.
- **What it does not read.** The parser does not decode escapes or follow aliases, functions, variables, here-documents or a script the command writes first, and a deny or ask rule does not read a redirection's target as a path. Run untrusted commands in a sandbox as well.
- **Modes.** `default` adds nothing. `accept_edits` allows `editTools` (default `write`, `edit`, `multi_edit`, `apply_patch`). `read_only` allows `readOnlyTools` (default `read`, `grep`, `glob`) and denies every other tool, whatever allow rules, ask rules and hooks' asks say, because an approval must not widen a limit. `bypass` allows whatever no hook, deny rule or ask rule stopped. `shadow` allows the same calls and skips asks, because nothing runs. `pipeline.shadowWrapper(session)` gives `registry.definitions()` a wrapper that writes a `shadow_call` entry and returns a fixed result in place of each tool's `execute`, and a pipeline in `shadow` mode refuses every call until that wrapper has been taken.
- **A shadowed callback is a startup error.** An allow rule with no `paths` and no `commandPrefix`, for a registered tool, throws `PermissionConfigError` while a host callback is set, because the callback could never decide a call to that tool. Deny rules, hooks and a host callback with no allow rules start cleanly. A tool registered later is checked when a call reaches the rule, and the call is refused and logged.
- **Every decision is logged.** Each `decide()` appends one `permission_decision` entry, allows included, with the decision, the rule, who decided, the `policyVersion` and the hash of the input. The pipeline fails closed: an entry that can't be written rejects the decision and the gate denies the call, and an input with no canonical form is denied.
- **Default ask rules.** `defaultAskRules` asks for a change to a test file and to a hook, CI configuration or a rules file, and for `git rm`. They match by path, so they ask for every change to such a file and can't tell a deleted test from an edited one; a hook can.

## A session belongs to a user, and every store call names both

`@buildanagent/harness/session` holds the `SessionStore` interface and `memoryStore()`, and `@buildanagent/harness/session/jsonl` holds `jsonlStore({ dir })` and `fileLock({ dir })`, which need Node's file system. A store keeps each session under a `SessionKey`, `{ userId, sessionId }`. `append`, `load` and `delete` take that key, and `list` takes the user, so no call finds a session by its id alone. A type test checks that a call with the id alone fails to compile. A session under another user looks exactly like one that doesn't exist: `load` yields nothing, `delete` does nothing and `list` leaves it out. A lookup must name the user even on a host that isolates users some other way, because adding the user later would change every caller.

- **Append assigns and returns.** `append(key, entries, { expectedLastId })` takes entries without `seq`, assigns each its sequence number and returns the stored entries. A session's first entry must be its `session_header`, and every entry must pass the protocol's `parseEntry()`.
- **Append is idempotent.** An entry already stored with the same content is not written again, and one stored with different content throws a `ConflictError`. A batch that is partly stored finishes on a retry. If another writer has extended the log since, the retry throws a `ConflictError`.
- **Append is a compare-and-swap.** `expectedLastId` names the entry the log must end with, so two writers can't extend one log. A stale tail throws a `ConflictError` and writes nothing, and `null` means the session must not exist yet. A batch is written whole or not at all.
- **Size.** An entry whose JSON is over 64 KiB, counted in bytes, throws an `EntryTooLargeError`. `maxEntryBytes` changes the bound. Spill large content to a file and keep a reference.
- **Load.** `load(key, { fromSeq, onTornLine })` yields the entries present when it began, in order. A last line that was never completed is skipped and reported once through `onTornLine`, and a bad line anywhere else throws a `HarnessError` with code `session_corrupt`.
- **The JSONL store survives a crash.** It writes `<dir>/<user>/<session>.jsonl`, one entry per line, each append as one write of whole lines followed by an `fsync`, so a crash leaves at most one unterminated last line. The next append cuts that line off.
- **File names cannot escape their folder.** Names are percent-encoded, capital letters and dots included, so no id can name `..`, reach another user's folder or collide with another id on a file system that ignores case.
- **One process is safe, and two need the writer lock.** The store caches the state of the 64 logs used last and rereads a log when the file's size has changed, so another process's write is seen on the next append. Two processes writing one session still need the writer lock. `list()` skips a file it can't read, so one bad file hides no other session. The `fsync` on every append costs time that a later timing run should measure.
- **Add a backend.** Pass a factory to `runStoreConformance(factory)` or `storeConformanceCases(factory)` from `@buildanagent/harness/testing`. A factory returns a fresh empty store, and optionally `tearLastLine(key)`, which leaves a log ending in a line that was never completed so the torn-line cases can run. The suite imports no test runner and no Node module. A backend that passes the cases follows the append, size and load rules above.

## One writer holds a session's lock, and a lock outlives a crash only by its lease

`fileLock({ dir })` in `@buildanagent/harness/session/jsonl` is a `SessionLock` that keeps one lock file per session, `<dir>/<user>/<session>.lock`, keyed like the store. `acquire(key)` creates the file with the exclusive-create flag, writes `{ pid, host, token, leaseUntil }` and returns a handle, or returns `"would_block"` at once if another writer holds it. It never waits. Readers never lock.

- **Lease.** The holder renews every `renewMs` (default 10 seconds) for a `leaseMs` lease (default 30 seconds). The renewal overwrites the lock's fixed-size record in place through an open handle. It can't recreate a released lock, because the open fails, and it can't overwrite a successor's lock, because that is a different file. A renewal that finds the lock gone or another writer's token gives up, and `handle.held()` turns `false`. Any other error is retried on the next tick. A writer that sees `false` must stop writing.
- **Stale.** A lock is stale only when its lease has lapsed and, on the same host, its process no longer exists. A lock whose process is alive is never taken, and neither is one whose lease still runs. A lock from another host is never taken by `acquire()`, because this host can't tell whether that process lives. `unlockSession({ dir }, key)` removes any lock and says what it removed. It is the library behind `buildanagent session unlock --force`, and the caller decides that it is safe.
- **Takeover.** Taking a stale lock runs under a short-lived guard file, so two writers racing for one stale lock can't each delete the other's new lock. A lock file with no readable record blocks until it is older than a lease, because its writer may still be writing it.
- **Release.** `release()` stops the renewal, waits for one in progress, and removes the lock only if it still holds this handle's token, so a writer that lost its lock never frees the next holder's.
- **Local disk only.** An exclusive create is not reliable on a network file system, so NFS and similar are unsupported. Another host needs a different `SessionLock`, such as a lease row in a database.
- **Pid reuse.** If the system reuses a dead writer's pid, the stale lock stays until that process ends. The lease and the token make this a delay and never a corruption.
- **The crash test.** A test spawns a child that takes the lock and appends in a loop, kills it with `SIGKILL`, and requires a new writer to get the lock within one lease and every complete entry to load.

## HEAD moves by entries, and a fork or a revert writes a new file and never edits an old one

`openSession({ store, index, key, lock })` returns a `Session`, one session's log with its HEAD. With a `lock` it takes the session's writer lock and may write, and without one it can only read. A session opened while another writer holds the lock throws `session_locked`, and one that has lost its lock must stop writing. The log is an append-only tree: each entry names the entry it follows, and `head()` is the entry the next append follows, or `null` before the first one.

- **HEAD is in the log.** Each appended entry moves HEAD to itself, and `checkout(id)` appends a `checkout` entry that moves it to `id`. A reload replays the entries, so HEAD comes back where it was left. An append after a checkout follows the entry checked out, so the other branch stays in the log.
- **Path.** `path(id)` lists the entries from the root to `id` (default HEAD) by following `parentId`. It leaves out `checkout` entries, which move HEAD and aren't part of the conversation.
- **Fork.** `fork(id)` starts a new session from `id`. Its new file holds a header that names this session's file and the entry as its parent, and a `checkout` of that entry. Its `path()` crosses into the parent file, so the prefix is shared and never copied, and only the entries up to the fork point are part of it. The returned session has a new id, and this one is unchanged.
- **Revert.** `revert(id)` writes the same kind of file and points this session at it, so the session goes on from `id`. The old file keeps every entry and is never touched, but the entries after `id` are no longer part of this session's tree: `path()` and `checkout()` reach only the entries from the root to `id` and the new file's own. A crash before the pointer moves leaves the old file in use.
- **The pointer.** The pointer to a session's current file is the only mutable state. `memoryIndex()` keeps it in memory, and `fileIndex({ dir })` in `@buildanagent/harness/session/jsonl` replaces a small JSON file by writing a temp file and renaming it.
- **Derived files.** The files a revert or a migration writes have names that start with `~`, and `listSessions()` leaves them out of a listing, because a session is known by its key.
- **Child.** `child({ spawningCallId })` or `child({ stepId })` starts the log of a subagent or a workflow step as its own session, and records the link in this session with a `subagent_link` entry that carries the one id given. Giving both or neither throws. The child's header names this session and the link entry as `parent` and the id as `spawn`, and its `path()` does not cross into this session, so a child never shares the parent's conversation.
- **Migration.** `migrateSession()` takes a log in an older format through the migrations it is given, writes the result as a new file in one append, which checks every entry against the current format, reads it back, and only then moves the pointer. The old file stays as it was. A log from a newer format is refused with `unsupported_format`, because only a newer harness can read it. `migrateSession()` takes the session's writer lock for the whole migration. It leaves a log that is already current alone, whatever its header names, and refuses to migrate a file whose header names a parent, because that parent would stay in the old format. It can't see forks that name this file as their parent, because a store has no index of dependents. Migrate only a session with no forks: an existing fork would still name the old-format file as its parent and become unreadable.
- **A file in another format is not corruption.** A store that finds a header it doesn't read throws `unsupported_format` and not `session_corrupt`, and offers `loadRaw()` so a migration can read the entries as they were written.

## Nothing is deleted unless you set a retention period

`jsonlStore({ dir })` never deletes or moves a file. To expire old sessions, give it `retention: { days, action }`, or call `pruneSessions({ dir, userId, retention })` yourself, both from `@buildanagent/harness/session/jsonl`. A session expires when the newest entry in any of its files is more than `days` old. Its files count wherever they are, live or archived.

- **`archive`** gzips each of the session's live files into `<dir>/.archive/<user>/` and removes the original once the archive reads back to the same bytes. The pointer stays. `list()` and `load()` still find an archived session, and a write restores the file it writes to.
- **`purge`** deletes the session's files, live and archived, and then its pointer. A session that was archived before you switched to `purge` is deleted once it expires.
- **When in doubt, a file stays.** Before it removes anything, a run takes the lock of each session it means to expire, reads the folder again, and decides from that second read which sessions survive: the fresh ones, the locked ones, and the ones it can't read or date. A writer that appended just before the lock is judged on what it wrote. A purge keeps every expired session that a survivor continues, as a fork continues its parent, and removes a fork before its parent. A file the store wrote but the run can't read stops every purge for that user, because it could be a fork of any session; it is listed in `skipped`, and an archive still goes ahead.
- **Edge cases.** How a run stops part-way, fails on one session, treats a torn file and reads files is on the [session format page](docs/session-format.md#nothing-expires-unless-you-set-a-retention-period).
- **When it runs.** `pruneSessions()` runs it when you call it, and the `sessions prune` command will call it. A store with `retention` also runs it once per user per process, on its first `list`, `load`, `append` or `delete` for that user. It never runs on a timer. After one clean pass, the store does not expire that user's sessions again until the process restarts, so a long-running server must call `pruneSessions()` on a schedule of its own, with the lock its writers hold. The store passes each error of its pass to `onRetentionError`, ignores an error the callback throws, and runs a failed pass again on the first call at least a minute after it ended. A store call waits for a pass that is running, and a pass keeps any session with a store call already in flight, so a pass never moves a file under the store's own append or delete.
- **Locks.** Pass the session `lock`, and a session whose writer is running is kept. Without a lock, a writer in another process or another store is not protected from a run.
- **A delete leaves files behind.** `delete()` removes a session's first file and that file's archive, but not the files a revert or a migration made, nor the pointer. A run treats what is left as the deleted session: it expires on the dates of those files, a purge removes it and an archive moves it, and neither brings the deleted first file back.

```ts
const store = jsonlStore({ dir, retention: { days: 30, action: "archive" }, lock });
const { archived, purged, kept, skipped, errors } = await pruneSessions({
  dir,
  userId: "ada",
  retention: { days: 30, action: "purge" },
});
```

The package sets no default period, and `days` must be a positive number or the call throws `invalid_retention`. Pass the memory extension's purge list as `marks`, and the result says which marks a purge removed with their sessions (`purgedMarks`) and which archived sessions still hold marked entries (`markedArchives`) for `purgeSession()`: an archive keeps a marked entry as it is. The [session format page](docs/session-format.md#nothing-expires-unless-you-set-a-retention-period) says where the archive is, and it has the [disk-cost projection](docs/session-format.md#what-a-month-of-sessions-costs-on-disk).

## `runTurn()` writes one SDK run into the log, and the user entry goes first

`runTurn(session, harness, options)` from `@buildanagent/harness/session` runs one turn of a `Harness` (built with `createHarness()` from `@buildanagent/harness/server`) on an open session. The input blocks are durable before `run()` starts, so a turn that dies before its first model call leaves the question in the file. A new session's first turn writes a `session_header`, which holds the SDK's version, defaults hash and capabilities, and an `env_stamp`. Any turn whose model or tool set differs from the last recorded one first writes a `loadout`, and a hook that swaps the model inside a turn is refused, so set `model` on the next turn instead. Every write goes through one queue, so the permission pipeline's `permission_decision` entries and the run's own never race for a parent. A failed write aborts the run, and `runTurn()` rethrows it.

| SDK event | Entry |
| --- | --- |
| input (before `run()`) | `message_block` with `delivery: "input"`, origin `user` or `operator` |
| `run_start` | `turn_start`, with the turn's exact system prompt |
| `model_call_end` | one `message_block` per block, a `message_end` and a `usage` |
| a turn-layer `retry` | a `usage` entry only |
| `tool_call_end` | `tool_result` with its own `callId` and the tool's declared output trust |
| `steer_applied` | `message_block` with `delivery: "steer"` or `"followUp"` |
| `run_end` | `turn_end` |

Call `runTurn()` once at a time per `Session`: its writes stay in order within one call, but two concurrent calls on one `Session` can interleave their entries. A turn may set `system`, `output`, `model`, `maxSteps`, `turnRetries`, `modelOptions`, `budgetUsd`, `signal`, `tools` and `hostContext`. `tools` is an allowlist of registered names, and an unknown name throws `invalid_turn_options`. `hostContext` reaches a tool as `ctx.app` and reaches no entry. `onRun` hands the caller the run, so it can `steer()` or `followUp()` it. `clientTool` runs every call to a tool registered with the `client_request` pattern in place of its own `execute`; the dispatcher sets it to send `tool/call`, and without it the tool's own `execute` runs.

## One dispatcher answers every client, and a client in the same process needs no framing

`createDispatcher({ harness, store, index, lock, userId })` from `@buildanagent/harness/server` serves the protocol's commands over a harness. `inProcessTransport(dispatcher)` connects a client in the same process. Its `request(method, params)` resolves with the result, or rejects with an `RpcFailure` whose `rpc` field holds the error code and message. `onMessage()` listens for the server's notifications and requests. `respond(request, result)` and `fail(request, error)` answer a request, and `respond()` takes only the result type of that request's method, so an approval can't be answered with a tool result. `stdioTransport()` carries the same messages to a client in another process, one per line, as [its section](#stdiotransport-serves-one-client-over-a-pair-of-byte-streams) describes.

```ts
const client = inProcessTransport(createDispatcher({ harness, store, index, lock, userId: "ada" }));
client.onMessage((message) => {
  // "event" and "turn/settled" notifications, and the server's requests, which carry an id.
  if ("id" in message && "method" in message && message.method === "approval/request") {
    const { id: requestId } = message.params.request;
    client.respond(message, { resolutions: [{ requestId, decision: "allow" }] });
  }
});
await client.request("initialize", { clientInfo: { name: "cli", version: "1" }, capabilities: [] });
const { session } = await client.request("session/create", { cwd: "/work" });
const disposition = await client.request("turn/start", { session, input: [{ type: "text", text: "Hi" }] });
```

`turn/start` answers with a disposition before anything else: `{ accepted: true, turn }`, or `{ accepted: false, reason }`. The reason is `busy` when this dispatcher already runs a turn (or a checkout or fork) in the session, `locked` when another process holds the session's lock, and `invalid` for a session the connection never created or opened. The turn's events follow as `event` notifications. When an event is an appended entry, its `seq` is that entry's sequence number; any other event carries the sequence of the latest entry written. Every turn ends with one `turn/settled`, sent after the turn's retries and after its last entry is written. A turn that throws settles with the stop reason `error`.

A steer or follow-up belongs to the turn its disposition names. One that arrives before the run exists waits for it, and if the turn fails before its run starts, the steer ends with the turn: `turn/settled` reports the failure, and the log holds no message for the steer.

The log, not the dispatcher, holds the state. The dispatcher takes the session's lock only while a turn, checkout, fork or resume runs, and a client can drive only the sessions it created or opened. It announces only the entries written to the session's current file, so a child session's header never appears in its parent's stream. `session/create` takes a `cwd`, which the dispatcher records for the session and does not yet pass to a turn. A closed dispatcher refuses new connections and answers `turn/start` on an open session with an error. `session/checkout` and `session/fork` are experimental: a client lists them in the `capabilities` of `initialize`, or the server answers `NotOptedIn`.

### A request for a person goes to every watching client once its entry is durable, and the first answer wins

When a call needs a person, its turn ends `awaiting_approval` or `clarification_requested`, as [the approvals section](#a-call-that-needs-a-person-is-a-signed-pause-that-any-process-with-the-key-file-can-resume) describes. The dispatcher sends `approval/request` or `clarification/request` to every connection that watches the session, and only after the `approval_requested` entry's append has resolved. A client that hears of a request can therefore always find it in the log. Each request has a server id of the form `sr-<n>` and carries the signed request.

- **The answer.** A client answers with `{ resolutions: [resolution] }`: exactly one resolution, naming the signed request it was asked about. An approval takes `decision` `allow` or `deny` with an optional `reason`; a clarification takes `answer`. Either may carry `by`, which the dispatcher passes on unchecked, so the transport is where a host authenticates its clients.
- **The first answer wins.** The dispatcher withdraws the same question from every other connection with `$/cancelRequest`, and ignores a later answer, a second answer to the same id and an answer to an id it never sent or already withdrew.
- **A malformed answer** is asked again on the same connection under a new id. An error response leaves the request waiting in the log, and the client is asked again the next time it opens the session.
- **The resume.** The answer goes through `Approvals.resolve()`, by default `createApprovals(harness)` or the dispatcher's `approvals` option, as a turn of its own with a new turn id. It runs once the session is free, so an answer that arrives while the paused turn is still finishing waits for that turn's `turn/settled`. The resume streams its events and ends with its own `turn/settled`. Before it resolves, the dispatcher reads the log under the lock and drops an answer whose request no longer waits, because another process resolved it first. A resume with no answer left runs nothing and settles nothing.
- **An answer the resume could not apply.** When another process holds the lock, the lock can't be taken, or an interrupt stops the resume before it writes, the resume writes no answer. Its `turn/settled` then carries the error kind `answer_not_applied`, with the stop reason `error`, or `aborted` after an interrupt. The request still waits in the log, and the dispatcher asks every watching client again, at most three times per request, so a lock held elsewhere can't make a loop. After that, the client is asked again the next time it opens the session. A closed dispatcher asks nobody.
- **After the resume.** A request the resume left waiting, such as one a quorum still needs, is asked again. A resume that failed after it wrote its answers asks nothing. An answer that arrives while a `turn/start` holds the session waits for it, and still resumes when that turn fails to start.
- **Asking again on open.** The dispatcher reads the waiting requests from the log, and reads again if an answer was taken or applied during the read, so a client is never asked about a request someone else has just resolved.

Nothing holds a session open while a client thinks. The paused turn has already settled and released the lock, and the request lives in the log, so a client that never answers costs one entry in each connection's table of open requests until that connection closes.

### A client tool's call goes to the client that started the turn

A tool registered with `pattern: "client_request"` runs on the client. The dispatcher sends `tool/call` with the session, the call id, the tool's canonical name and the validated input, to the connection that started the turn; for a resume, to the connection whose answer started it. The client answers with `{ content, isError }`, which becomes the call's result. The call never waits on a client that is gone. With no such connection, when the connection closes before answering, and for an error response or an answer that is not a tool result, the model gets an error result and the turn goes on. An abort of the turn withdraws the call with `$/cancelRequest`, and an answer that arrives after that is ignored.

### Either side cancels its own request with `$/cancelRequest`

A client cancels a `turn/start` by sending `$/cancelRequest` with that request's id, at any time until the turn settles. A client that reuses the id for a later `turn/start` cancels the later turn. The dispatcher aborts the run, and the turn still ends with one `turn/settled`, with the stop reason `aborted`. In the in-process transport, pass `{ signal }` as the third argument of `request()`; aborting the signal after the disposition still cancels the turn. A cancel for any other request, or for an id the server does not know, does nothing, and that request is answered as usual. The server sends `$/cancelRequest` for its own requests: an approval someone else answered, and a tool call whose turn was aborted.

### Each connection's queues are bounded at 128, and only events are dropped

`queueSize`, 128 by default, bounds two queues of each connection.

- **Commands.** A connection holds at most 128 unanswered commands. A command keeps its place until its response has gone out, not just until it is computed, so a client that sends faster than it reads is refused as soon as 128 commands wait. The 129th gets the error `QueueFull` (-32001), and a refused command takes no place. A refusal waits to go out like any response, so the refusals are bounded too: once 128 of them wait undelivered, the client is neither reading nor waiting, and the server closes the connection.
- **Events.** `connect(send)` takes a `send` that may return a promise, and the next message waits until that promise settles. While a slow client keeps messages waiting, at most 128 live events wait with them, and the server drops each event past that. An `events_dropped` event takes the place of a session's dropped events: its `count` says how many, and its `seq` is the last dropped event's. It goes out before the session's next message, or once the queue empties.
- **Never dropped.** Responses, server requests, `turn/settled`, `$/cancelRequest`, the `events_dropped` marker and replayed events always go out. What produces each of them bounds it: the command queue bounds the responses, the refusal bound bounds the `QueueFull` errors, the waiting requests bound the server requests, and each turn sends one `turn/settled`.

A client that takes each message at once, as the in-process transport does, never loses an event. A client told of a gap gets every dropped entry back from `session/open`. Live events go on after the marker, so the client sends a `fromSeq` one past the last `seq` it received before the marker, and drops by `seq` any entry it then gets twice.

### `session/open` with `fromSeq` replays the entries a client missed

`fromSeq` is the first sequence number to replay, so a client that last saw `seq` N sends N + 1. The dispatcher reads the session's current file from that entry on and sends each entry as an `entry_appended` event, then the live stream. It holds the session's live events from the start of the open, so the response comes first, then the replay, then what happened meanwhile, and no entry is sent twice or lost. The log is the replay window. A `fromSeq` is therefore never too old, and a second process, or the same one after a restart, replays what the first wrote. Only entries are replayed. Streamed events such as text deltas are transient, and the entries that follow them hold the same content.

`fromSeq` must be a whole number of at least 0. A `fromSeq` one past the last entry replays nothing, and one further, which no client could have seen, is refused with `InvalidParams`. Replay follows the open's rules: only a connection that opens the session gets it, a failed open replays nothing, and a dispatcher serves only its own user's sessions. When a second open fails on a connection that already watched the session, that connection keeps its live stream. What the failed open held goes out, and a marker stands where the hold dropped anything. The marker counts only what the replay lacks, and its `seq` is never below the replay's last entry.

### A client that reconnects finds its pending requests in `initialize` and is asked again on open

A request survives its client. `initialize` lists in `pending` every request still waiting in every readable session of the user, so a client that joins can re-arm them. `initialize` alone grants no access to a session, so the server sends the requests again, under new ids, only once the client opens the session with `session/open`. The id a closed connection held is stale, and an answer to it is ignored. A connection that dropped without closing still holds its old request. When someone else answers the question, the server withdraws it from that connection with `$/cancelRequest`.

### `stdioTransport()` serves one client over a pair of byte streams

`stdioTransport(dispatcher, { input, output, log }, { maxLineBytes, signal, writeTimeoutMs })` connects one client and resolves when that client is done. `input` is a Node `Readable` such as `process.stdin` or a Web `ReadableStream`, and `output` is a Node `Writable` such as `process.stdout` or a Web `WritableStream`. `log` takes the transport's own diagnostics, one line each, and a host points it at stderr, because `output` carries protocol lines only. A diagnostic never quotes what the client sent. The transport's source, `stdio.ts`, imports no Node module, so the same function can serve a Worker's streams. The transport authenticates nobody: whoever holds `input` and `output` acts as the dispatcher's user, and the dispatcher passes `Resolution.by` on as the client sent it. Run it only where you trust every process that can reach the two streams; binding a client to an identity is not built yet. The [protocol README](https://github.com/laudebugs/buildanagent/blob/main/packages/protocol/README.md#over-stdio-each-message-is-one-line-and-stdout-carries-nothing-else) gives the wire rules: one message per line, an error for each bad line, and commands that may be answered out of order.

- **Backpressure.** The transport writes a message, and when `output` reports itself full, the connection's queue waits for `drain` before it hands over the next one. A client that stops reading therefore keeps the server's backlog near the stream's own buffer, and the dispatcher drops live events past `queueSize` instead of holding them. While `output` is full, every write shares one wait for room, so a long session adds no listener to the stream. `input` goes on being read meanwhile, and the connection's limit of 128 unanswered commands bounds what a client that sends without reading costs.
- **Bad lines.** The transport answers a line it can't read itself, outside the connection's queue. An answer the output takes at once costs nothing, so a client that reads can send any number of bad lines. Once 128 answers wait on a full output, the client is sending without reading, and the transport stops. A malformed response, one that carries `result` or `error`, is only logged, because JSON-RPC never answers a response; the server's request it meant to answer still waits for a good one.
- **A message JSON can't carry.** When `encode()` refuses a message the server built, such as a tool call whose input holds a `bigint`, the transport logs it. A response goes out as `InternalError`. A server request is answered back into the connection with `InternalError`, as if the client had failed it, so a tool call ends with an error result instead of waiting. A notification is dropped.
- **Shutdown.** When `input` ends, the transport waits until every command it read has its response queued and every line is written, then closes the connection and resolves. An `input` that fails is logged and handled as an end. Four events stop the transport at once: `output` fails, `output` closes, the dispatcher closes the connection, or `signal` aborts. It then closes the connection, logs why and resolves. The dispatcher closes a connection whose client leaves 128 refusals unread, and `connect()`'s `onClose` option reports that. A client that closes its input and never reads ends the wait after `writeTimeoutMs`, and a host that wants an earlier stop aborts `signal`. A transport that can't start, because the dispatcher is closed or a Web stream is already locked, rejects and leaves both streams as it found them.
- **The streams stay the host's.** The transport never ends, closes, destroys or cancels either stream. When it resolves, it has removed every listener it added, paused a Node `input` and released a Web stream's lock, so the host can go on using both and decides when its process exits.
- **What the transport does not check.** The transport checks each message's envelope with `decode()`. Before a handler runs, the dispatcher checks a command's params against the protocol schema. A command with malformed params gets `InvalidParams`, which names the method, the path of the failed field and the failed keyword, and never a value or a field name the client chose. A command with no `params` is checked as if it carried `{}`. The check covers `params` only, and `decode()` still checks the rest of the envelope.
- **A client that stops reading.** Once the input has ended, the transport waits for the output to take what is queued. The output must take each queued line within `writeTimeoutMs` (30,000 ms by default, `Infinity` to turn the check off), or the transport logs why and closes the connection. Each line the output takes restarts the wait, so a client that keeps reading is not cut off. A client that takes one very large line more slowly than the limit is cut off, so a host that serves such lines raises the limit. A value that is not a whole number from 1 to 2,147,483,647, or `Infinity`, rejects with `invalid_transport_options` before the transport connects.

`test/server/stdio.test.ts` runs the server in a child process spawned with `spawnEnv([])`. `test/server/stdio-transport.test.ts` drives the transport in process over streams it holds, for the stops, the bounds and the streams left behind. The child-process test checks that a client completes a turn, that stdout holds only protocol lines, that the end of stdin still gets every answer, and that a client that stops reading leaves at most 256 KiB waiting while 25,000 events stream. It also sets a variable in the parent and checks that the child's environment holds only `PATH`, `HOME`, `TMPDIR` and `LANG`.

### `webSocketTransport()` serves one client on one WebSocket

`webSocketTransport(dispatcher, socket, { maxMessageBytes, maxBufferedBytes, writeTimeoutMs, signal, log })` connects one client to the dispatcher and resolves when that client is done. `socket` is any already-open object with the standard `WebSocket` methods. The global `WebSocket` of Node and browsers fits, and the transport needs no library and imports no Node module. One text frame holds one JSON-RPC message, with no trailing newline. The transport authenticates nobody. Whoever holds the socket acts as the dispatcher's user, and the dispatcher passes `Resolution.by` on as the client sent it. A host that exposes the socket must check the caller's identity and origin before it hands the socket over.

- **Bad frames.** A frame that is binary, empty, over `maxMessageBytes` (8 MiB, not counting one trailing newline), holds more than one line, even with blank lines around one message, or is a batch gets `ErrorCodes.InvalidRequest`. A frame that isn't JSON, or holds an unpaired surrogate, gets `ErrorCodes.ParseError`. Both error codes answer with a `null` id, as does a bad envelope whose id can't be read. A bad envelope with a readable id gets that id. A malformed response is only logged. A binary frame's size is read from its byte length without reading its data. After a frame over the bound, binary or text, the transport closes the socket with 1009.
- **Backpressure.** A socket reports no event when its send buffer empties, so while `bufferedAmount` is over `maxBufferedBytes` (1 MiB) the transport checks it every 25 ms and waits to send. The buffer can pass the bound by one frame. The transport closes the socket with 1008 and logs why when the buffer does not shrink for `writeTimeoutMs` (30,000 ms by default, `Infinity` to turn the check off) or when the client leaves 128 error answers or refusals unread. A socket whose `send` throws is closed with 1011, and the log gives the error's name and never its message. The global `WebSocket` refuses to close with 1008, 1009 or 1011, so when closing with one of them throws, the transport closes again with 4008, 4009 or 4011 and the same reason.
- **Shutdown.** A close from the peer ends the transport without a close of its own, and an error ends it too, closing the socket with 1011 if the socket is still open. Besides the 1008, 1009 and 1011 closes above, the transport closes the socket only when `signal` aborts, with 1000. The peer's close reason is never logged.
- **Reconnect.** The transport serves one socket. When a client's socket drops, the host serves the new socket with a new call on the same dispatcher, and the client sends `session/open` with the `fromSeq` after the last entry it saw, as in the `session/open` with `fromSeq` section above.

`test/server/websocket-transport.test.ts`, `websocket-reconnect.test.ts` and `websocket-framing.test.ts` run the transport over an in-memory socket pair.

## The log is the only state, so a turn rebuilds its context from it

`session.toContext(headId?)` rebuilds the SDK's `Context` from the entries between the root and `headId` (default HEAD): the messages in order and the system prompt of the latest `turn_start`, byte for byte. It groups `message_block` entries by `messageId`, closes a message at its `message_end`, and takes its usage from the `usage` entry that follows. A `usage` entry anywhere else belongs to a call whose message a turn-layer retry superseded, and builds no message. The result deep-equals the `context` of the run that wrote the log, a paused run included, and `continueRun()` finishes a run from it after a JSON round trip. A turn that leaves out `history` takes it from `toContext()`, so a new process goes on from the log alone.

A request that still waits for a person is in `context.pending`, and the input its call would run with is in `context.pendingInputs`, both read from the `approval_requested` entries.

There are two ways to look at a stored session again, and neither calls a model:

- **Playback** is `session.playback(headId?)`, which yields the entries on the path in order and reads the log and nothing else.
- **Re-run** is `rerunFrom(session, harness, entryId, options)`: it appends a `checkout` to `entryId` and starts a new turn there, on a new branch of the same log. The entries of the branch it left don't change. It refuses an entry that follows an open call, because that call never ran on the new branch.

To get byte-identical logs, set `TurnOptions.clock` and `newId` to a fixed clock and sequential ids. Two identical scripted sessions then write identical JSONL files.

### A crash leaves open calls, and the next turn settles them by what they could have done

An open call is a tool call whose result is not in the log. Before a turn writes anything, it settles the open calls a crash left:

- A message with blocks and no end is ended first, as `tool_calls` if it made calls and as `aborted` if not, so its calls count and the model is sent their results.
- A call to a tool that declares `effect: { kind: "write" }`, or to a tool the registry no longer has, gets an `unknown` write outcome with `retry: "reconcile_first"`, because the write may have taken effect. The model reads that it must check before it retries.
- A call to any other tool gets an error that says it was interrupted, which the model may retry.
- A turn with no `turn_end` gets one with stop reason `aborted`, unless a checkout moved HEAD there, since a turn left behind by a re-run was not interrupted.

A turn that ended `awaiting_approval` or `clarification_requested` leaves its calls open on purpose, for the approval that resolves them (below). A later turn that passes no `history` refuses to start with `invalid_turn_options` while any call is open, because the gateway would answer it with a made-up "missing result" error and the approval would then have nothing to resume.

When a tool has a business key, a model that proposes the same write again reaches the same effect key, so the write goes out once. `effectScope(session, harness, toolCallId)` builds the scope that key takes: the harness's `tenant` (default `local`), the session id, the branch and the call id. The branch is the log's file plus its latest checkout.

## Two cheap layers keep a long run small: a write cap that spills, and masking in steps

`createContextPolicy()` from `@buildanagent/harness/context` builds the first two of the five context layers, and `createHarness({ ..., context })` applies it to every turn. Neither layer edits a stored entry. The write cap stores the cut text, so the model reads what the log holds, and masking changes only the request view.

```ts
const context = createContextPolicy({ spill: fileSpillStore({ dir: ".sessions/spill" }) });
```

**Layer 1, the write cap.** A tool result whose text is over the cap is cut before the model reads it, and the full text goes to the `spill` store. The model reads the first part and a line that names the file, and the `tool_result` entry stores the same cut text with `spill: { path, bytes }`. If the store cannot write, the text is still cut, and the notice says the rest was not kept.

The cap counts the bytes the entry takes in the log: JSON escaping, the result's details and other blocks, and 1 KiB for the entry's own fields. A capped entry therefore always fits the stores' 64 KiB entry bound. The default `writeCapBytes` of 65,536 leaves the model a little under 64 KiB of plain text, and less of a text full of newlines or quotes. `fileSpillStore({ dir })` from `@buildanagent/harness/context/file` writes one file per capped result, and `memorySpillStore()` serves tests, with absolute paths under `/spill/`. `fileSpillStore().read()` reads only an absolute path inside the session's folder. A file is named by the run id, a count within the run and the call id, because a provider may reuse a call id. A policy with the layer on and no `spill` throws `invalid_context_options`.

**Layer 2, stepped masking.** Before each model call, every tool result before a cutoff shrinks to its first 500 characters and a pointer line. The line names the spill file, or the log entry when the result was never spilled. A cut never leaves half of a surrogate pair. The cutoff is `floor((messages − 8) / 8) × 8`, so it moves once every eight messages. Between moves the view's prefix stays byte-identical, which keeps a provider's prompt cache hitting.

Signed thinking limits where the cutoff may stand. A model that checks each signed block against the earlier request rejects a block that follows an edited message, and a model that thinks in a tool loop needs that loop's own blocks back. So while the tool loop in progress holds signed thinking, the cutoff is computed as though the transcript ended where the loop began, and nothing in the loop is masked. The view also drops the signed reasoning of messages before the loop that follow the first masked result, and keeps the signed reasoning before that result and the loop's own.

Turn a layer off with `layers: { write_cap: false }` or `layers: { mask: false }`; `mask` takes `{ keepChars, stepMessages }`. After each view is built, the policy reports how full it estimates the view to be: `TurnOptions.onContextFill` receives `{ tokens, budget, window }`, and the dispatcher sends `tokens` and `budget` as a `context_fill` event. With a previous response, the estimate is that response's input and output tokens plus the view's growth since, counted as characters over four. Before any response, it is characters over four for the whole view. The other three layers follow.

## A summary replaces an outgrown span between turns, and the log keeps every original

Layer 3 of the context policy runs at the start of a turn, before the turn's input is written. When the context is over the budget, the policy summarises everything before a verbatim tail and writes a `compaction` entry. The budget is `budgetTokens`, which defaults to the smaller of the model's window less 16,384 tokens and 200,000. The tail is the newest messages that add up to `summarize.tailTokens` (default 20,000), moved back until it starts with an assistant message, so a call is never split from its result and the summary is never followed by a second user message.

The policy below sets four options. It keeps the newest 20,000 tokens verbatim, asks the summary to keep the open bugs, caps the summary call at $5 and logs each written entry:

```ts
const context = createContextPolicy({
  spill,
  summarize: { tailTokens: 20_000, focus: "open bugs", capUsd: 5 },
  hooks: { afterCompact: async (entry) => audit(entry) },
});
```

The summary call goes through `Model.complete()` with `cacheRetention: "none"`, on the turn's model or `summarize.model`. It reads the whole discarded span, with each tool result cut to `toolOutputChars` (default 2,000), and asks for the fixed sections of Pi's compaction prompt and its rule to keep exact paths, function names and error messages. The wording is versioned, and each entry records the version in `promptVersion` (`recall-v1`). The span begins with the earlier summary when there is one, so each summary updates the last. A `focus` hint is added to the request and recorded on the entry.

The call's cost goes in a `usage` entry with `source: "summary"`, written before the `compaction` entry that names it. When `summarize.capUsd` is set, the harness projects the call's cost with `projectCallCost()` before it runs. It skips the layer when the session's spend plus that projection would pass the cap, or when either figure is unknown. Spend counts the entries from the root to HEAD, so a branch left behind by a re-run is not counted. The cap guards the summary call only: it keeps no room for the turn's own next call. The request must also fit the summary model's window, less `summarize.maxOutputTokens`.

A failed summary never fails the turn, and `log` reports each failure. A skip before the call, for the cap or the window, writes nothing. A reply rejected after the call, such as one cut off at its output limit or empty, writes only its `usage` entry. A provider error or a throwing `beforeCompact` writes nothing. A throwing `afterCompact` is reported too, but the compaction stands because its entry is already written. An aborted turn still stops.

`hooks.beforeCompact` receives `{ span, tokens, focus? }` and may return `{ summary }`, which replaces the model's. No call is made, the cap is not checked, a zero-cost `usage` entry is written and the entry records `promptVersion: "hook"`. A missing or blank summary leaves the model to write it. `hooks.afterCompact` receives the written entry. `layers: { summarize: false }` turns the layer off.

No entry is edited or removed. `session.toContext()`, and every turn that rebuilds its context from the log, start from the latest compaction: its summary as a user message, then the kept tail, then everything written after it. The tail loses its signed reasoning blocks, because a block that follows the summarised span carries a signature the summary made stale; blocks written after the compaction stay. A re-run from an entry before the compaction rebuilds the original context from the file.

## Two more triggers compact inside a turn: at 90% of a small window, and after a provider overflow

Layer 3 runs between turns. Layers 4 and 5 run inside one: layer 4 when a model call would fill most of a small window, layer 5 when the provider has already refused a request as too large. Both use layer 3's summary call, template, hooks, cap and `log`, and each writes a `compaction` entry whose `layer` is `mid_turn` or `overflow_retry`.

**Layer 4, mid-turn.** The SDK's loop keeps the run's whole transcript, so a compaction in the middle of a run cannot shorten it. It changes the view that every later model call of the run reads. The first call whose context would pass `midTurnRatio` (default 0.9) of the model's window summarises the span before the verbatim tail and writes the entry. From then on the run reads the summary, the tail and what the run adds, and later turns rebuild the same view from the log. A turn compacts mid-turn at most once.

The layer is on by default only for windows under 128,000 tokens, where a single turn can fill the window. Set `layers: { mid_turn: true }` to turn it on for a larger one. The estimate is the last response's input and output tokens plus a character count of what the view added since. The compaction drops the signed reasoning of the kept tail's older messages from the view, because the summary made their signatures stale, and keeps the thinking the run wrote after it.

**Layer 5, overflow retry.** When a run ends because the provider said the request was too large (`error.kind` `overflow`), `runTurn()` asks the policy to compact once, whatever the context's size, and goes on from the rebuilt context with `continueRun()`. That call asks the model again, because the gateway leaves the failed response out of the request. `onRun` is called again with the retry's run. The dispatcher holds a steer or follow-up sent in between until that run exists, and still sends one `turn/settled`. The turn's result adds the two attempts' steps, usage and cost, and the retry gets what the first attempt left of `maxSteps`. `layers: { overflow_retry: false }` turns the layer off.

Three cases end the turn with the overflow error as its result (`stopReason: "error"`) and no further attempt:

- A second overflow, because only one retry is made.
- Nothing before the tail to summarise, such as one message too large for the window.
- A turn given its own `history`, which has neither layer, because the log does not describe its context.

Four limits and interactions follow from this design:

- The retry gets the turn's `budgetUsd` again, not what the first attempt left.
- The retry does not compact mid-turn again.
- The context policy's interceptors run before the harness's own `interceptors` and the permission gate. A mid-turn compaction therefore indexes the run's own transcript, a harness `transformContext` or `beforeModelCall` hook sees the masked and compacted view, and a harness `afterToolCall` hook sees the capped result.
- A steer or follow-up accepted while the retry's summary call runs is delivered only if the retry goes ahead. When the summary is skipped or the turn is aborted, the message is dropped.

## A turn that ends `done` runs the project's checks, and the diff flags are recorded, never fatal

A model's "done" is a claim, so a turn can check it in code. Pass `completion: { sandbox, env }` to `runTurn()`, where `sandbox` is the session's sandbox and `env` is the checks' whole environment, built with `spawnEnv()`. Before the model runs, the turn resolves the project's checks, reads the check config and takes a snapshot of the workspace. It does this for every turn, because whether a turn ends `done` is known only after the model has run, so expect up to 5,000 file reads before each turn. When the run ends `done`, the harness runs the checks it resolved at the start, takes a second snapshot, and writes one `completion_check` entry after `turn_end`. It also calls `onCompletionCheck` with that entry. The turn's stop reason is unchanged: a failed check or a flag is recorded for the CLI and the eval reports to show, and a turn that ends any other way runs no check. `lastEntryId` on the result is the new entry. A `done` turn from the dispatcher runs a check only when `createDispatcher()` is given `completion`, a function that takes a session's id and returns that session's `{ sandbox, env }` (or `undefined` for none).

**A turn resumed after an approval is never checked.** A resume through `createApprovals()` runs no completion check, because the start state is not kept across the pause. So in an agent that uses approvals, a turn that pauses for one and then ends `done` writes no `completion_check` entry, and its "done" goes unchecked.

**The checks are fixed before the model runs.** A turn can't change which commands run by editing `.agents/harness.json`, because they were resolved before it began. A package runner reads a script's body when it runs it, though, and `make` reads the `Makefile`, so a turn that rewrites the `test` script to `true` would still change what `npm run test` does. The harness therefore compares the check config at the end with the start and adds one flag for each part the turn changed:

- `check config changed: .agents/harness.json` for any edit to that file.
- `check config changed: package.json script <name>` for a changed body of `typecheck`, `test`, `check`, any script a check runs through `npm`, `pnpm`, `yarn` or `bun` (such as `npm run e2e`), or the `pre` and `post` hook of any of these, because npm and yarn run the hooks too.
- `check config changed: Makefile test target` when the `test` rule's target line or recipe changed.

A script no check runs is not tracked, and the Makefile comparison covers the `test` rule only, not the rules it depends on.

**A check that can't do its work is recorded, never thrown.** When the checks can't be resolved before the turn (a `.agents/harness.json` that is not valid JSON, say), the turn still runs, and its entry has no checks, `passed: false` and a flag `completion check failed: <message>`. A start snapshot that throws is recorded the same way, and the checks still run. A check that throws, such as one run in a disposed sandbox, gives an entry with no checks, `passed: false` and the same kind of flag. `runTurn()` never throws for a `done` turn because of its completion check, and that includes the append of the entry: when the store refuses it (a lost lock, a conflict), the result comes back without that entry, `lastEntryId` stays the turn's own last entry and `onCompletionCheck` is not called.

**Configure the checks in `.agents/harness.json`.** `completionChecks` is a list, and each item is a command string, split on spaces, or a list of an executable and its arguments. Neither goes through a shell, so write `["sh", "-c", "make lint && make test"]` for one that needs it. A configured list replaces discovery, and an empty list runs nothing:

```json
{ "completionChecks": ["pnpm run typecheck", "pnpm run test", ["make", "e2e"]] }
```

Without the key, the harness runs the `package.json` scripts `typecheck`, `test` and `check`, in that order, when they exist, with `pnpm` or `yarn` when the project has that lockfile and `npm` otherwise. When no script matches, it runs `make test` if the `Makefile` has a `test` target, alone or in a list such as `all test:`; a variable named `test` does not count. `resolveChecks()` shows what a sandbox would run. A file that is not JSON, or a `completionChecks` that is not a list of commands, makes `resolveChecks()` throw `HarnessError` with code `invalid_completion_config`; in a turn, that becomes the failed entry described above.

**What the entry holds.** Every check runs, even after one fails, with `timeoutMs` (default 10 minutes) each. `checks` lists each command with its exit code: 124 for a timeout, 126 when the sandbox's policy refused it, and 130 when the turn's signal aborted it. The check running at the abort and each one after it gets 130 and a flag. A check the signal aborted counts as aborted even when the sandbox returned a result for it, such as exit 143. Once the signal has aborted, no further check is started and no diff is taken. `passed` is true when every exit code is 0, so it is also true for a project with no checks, where `checks` is empty. `flagged` holds, in order, any `completion check failed` flags, the refusals and aborts, the `check config changed` flags, and one sentence for each diff pattern:

- an added skip marker: `.skip(`, `xit(` or `@pytest.mark.skip`
- an added placeholder: `TODO` or `FIXME` in capitals (`todo` is not flagged), or "not implemented" in any case
- a new file whose name has `mock`, `stub` or `fake` in it
- a deleted test file
- a test file with fewer assertion lines (`expect(`, `assert(`, `assert.x(`, `assertEqual(` and Python `assert` statements) than before

A test file is a code file (such as `.ts`, `.js`, `.py`, `.go`, `.rs`, `.java` or `.rb`) in a `test`, `tests` or `__tests__` folder, or a file named `*.test.*`, `*.spec.*`, `*_test.*` or `test_*.py` anywhere. A fixture or snapshot in a test folder, such as `test/fixtures/sample.json`, is not one, so deleting it raises no flag. A line counts as added when the file has more copies of it than before, so moving a line flags nothing. These patterns have honest causes, which is why they never stop a run: expect false positives, and read a flag as a prompt to look.

**The diff needs a way to snapshot the workspace.** The default, `gitSnapshotter`, lists `git ls-files --cached --others --exclude-standard` in the sandbox and reads each file up to 256 KiB as UTF-8 text, at most 5,000 files. The second snapshot reads the first one's paths again and adds the new ones. A file left out for its size, its encoding or the cap, or one it could not read for any reason but its absence (a policy refusal, a sandbox error), is ignored by the diff, so none is reported as deleted. The listing and each read stop after 60 seconds (`SNAPSHOT_TIMEOUT_MS`), and a read that times out is skipped. In a workspace that is no repository, or when the listing times out, it returns nothing, and the entry then has checks and no diff flags. Pass `snapshotter` in `completion` to diff another way.

## The log projects to OpenTelemetry spans with content off, and a meter warns at 80% of the session cap

Telemetry is a projection of the log, so it never becomes a second record: `projectSpans()` from `@buildanagent/harness/telemetry` turns a session's entries into spans, and the same entries give the same spans in any process, on any day. A change to what you export needs no change to what you store, and a session recorded before you added a backend can still be traced.

```ts
import { context, type Span, trace } from "@opentelemetry/api";
await projectSpans(loggedEntries, {
  tracer: trace.getTracer("my-agent"),
  childContext: (parent) => trace.setSpan(context.active(), parent as Span),
});
```

The harness imports nothing from OpenTelemetry, so you pass `childContext` to build each child's context.

**The tree has four levels.** `invoke_agent` covers the session. Under it, a `turn` span covers each run or resume, with the run id, the mode (`run` or `continue`), the stop reason and the step count. Under a turn, a `chat` span covers each model call, from the entry before the answer's first block to its `message_end`, and an `execute_tool` span covers each tool call, from the `message_end` that asked for it to its `tool_result`. A call that waited for a person has an `approval_wait` span beneath it, from the `approval_requested` entry to the `approval_resolved` entry, with the request id and the decision. A tool span is a sibling of the model call that asked for it, as in the SDK's live observer. A call that waited ends in the turn that resumed it, so its span can outlive the turn that started it.

**Special calls and damaged logs get their own spans.** A summary or judge call writes a `chat` span with `buildanagent.usage.source` set to `summary` or `judge`. A host's code call (a `code_call` entry) writes an `execute_tool` span with `buildanagent.tool.code_call` set to `true`. The spans carry the entries' own timestamps, so a duration is what the log recorded. Only an entry right after a message's end prices that message's call; any other model-call `usage` entry belongs to a superseded call and gets its own `chat` span. A span whose closing entry is missing closes at the log's last timestamp and carries `buildanagent.span.unfinished`. Three cases leave a span unfinished: a call still waiting when the log ends, a turn that no `turn_end` closed, and a model call that streamed blocks and never reached its `message_end`, as after a crash.

**The attribute names come from the SDK, and ours sit in their own namespace.** The conventions' names and the pinned commit (`d28355d`, as of November 2026) come from `@buildanagent/sdk/otel`, which the live observer shares, so a rename upstream is one change. `gen_ai.usage.input_tokens` counts every input token, cached ones included, and the cache split uses the conventions' own `gen_ai.usage.cache_read.input_tokens` and `gen_ai.usage.cache_write.input_tokens`, which the SDK's live observer writes too. No convention names cost, so `buildanagent.cost.usd` holds the price of a call, and the sum on a turn and on the session's root span, with `buildanagent.cost.basis` of `provider`, `catalog` or `unknown`. A price that is unknown has the basis `unknown` and no `buildanagent.cost.usd`, and so does every sum that includes it. A usage the provider did not report writes no token counts. The root span also carries `buildanagent.semconv.genai.commit`; a tracer provider's resource is yours, so stamp the same value there if you want it on every span. `BUILDANAGENT_ATTRIBUTES` lists our names.

**Content is off until you ask for it.** With the defaults, no span holds a prompt, a message, a tool argument or a tool result. `content: "attributes"` writes the system prompt, the messages of each call and each tool's result as the conventions' content attributes. A call's messages are what the model was sent, rebuilt from the log the way a resume rebuilds them: after a compaction they are the summary and the messages it kept, and a host code call's result is never among them. `content: "refs"` writes `buildanagent.content.ref` instead, the ids of the entries that hold the content: the turn's system prompt, the compaction that applies, the entry each input message starts at and the answer's own entries. A backend that can fetch entries from the session store holds no text this way. Tool arguments have their own switch, `toolArguments`, which is off by default and independent of `content`, because arguments carry what a user asked for: a path, a query, a customer id. With `content: "attributes"` and `toolArguments: false`, the messages show each tool call's name and leave its arguments out.

**`hashAttributes` keeps a value out of the export and keeps spans groupable.** Name the attributes in `hashAttributes: { key, names }`, and each named attribute carries the HMAC-SHA-256 of its value under `key`, as lower-case hex, instead of the value. Two spans with the same value get the same hash, so a backend can still group by user or tool. A string is hashed as it is, a number or boolean as its text and a list as its JSON. A span's name leaves out a hashed tool name or request model, which it would otherwise repeat. At content level `attributes` the messages repeat a tool's name, call id, arguments and result in plain text, so `projectSpans()` throws a `HarnessError` with code `invalid_telemetry_options` when `hashAttributes` names any content attribute, or the tool's name or call id, at that level; use `refs` or `none`. The key never leaves your process; if you lose it, hashes made with it can no longer be matched against new ones.

**A meter folds the `usage` entries and warns once.** `createBudgetMeter({ capUsd, warnAt, onWarning })` adds each call's cost with `record` or `observe`, and calls `onWarning` once, with the `budget_warning` event the harness sends clients, when the spend first reaches `warnAt` of the cap (80% by default).

```ts
const meter = createBudgetMeter({ capUsd: 5, onWarning: ({ spentUsd, capUsd }) => console.log(spentUsd, capUsd) });
```

The `remainingUsd` method returns the cap less the spend, never below zero, to pass as a turn's `budgetUsd`. A call whose price is unknown makes the spend unknown for good: the meter never warns again, and `remainingUsd` throws a `HarnessError` with code `budget_unknown`, because a turn with a limit it cannot measure against has no limit. `budgetMeterFromEntries(entries, options)` rebuilds the meter from a branch after a restart. It stays quiet about spend the log already holds, since a client that heard the warning once need not hear it again, and warns once if later calls reach the threshold. The meter reports and the caller enforces: nothing here stops a turn, and the SDK's per-call check against `budgetUsd` does that.

## An extension adds hooks and tools in the harness's own process, and project trust only gates loading

An `Extension` from `@buildanagent/harness/extensions` is a name, a version, and any of `interceptors`, `observers` and `tools`. It runs in the harness's process with the harness's permissions, so loading one is a trust decision and nothing more: **trust is not a sandbox.** The permission pipeline still decides every call an extension's tool makes, and an extension's own hooks can do anything the process can.

This audit extension asks a person before every shell command and hands every event to a log. The harness runs it before another extension, `other`, and records both:

```ts
/** A harness that runs the audit extension first, then `other`, with both extensions' tools in `registry`. */
export async function auditedHarness(
  registry: ToolRegistry,
  model: Model,
  log: (e: AgentEvent) => void,
  other: Extension,
) {
  const audit: Extension = {
    name: "audit",
    version: "1.0.0",
    interceptors: { beforeToolCall: (event) => (event.tool === "bash" ? { decision: "ask" } : { decision: "allow" }) },
    observers: [(event) => log(event)],
  };
  const { interceptors, observers } = composeExtensions([audit, other]);
  registerExtensionTools(registry, [audit, other]);
  const extensionRecords = await recordsOf([audit, other]);
  return createHarness({ registry, model, system: SYSTEM, interceptors, observers, extensionRecords });
}
```

`composeExtensions()` joins the hooks in the order given, by the SDK's rules. `transformContext`, `beforeModelCall` and `afterToolCall` chain in registration order. `beforeToolCall` is a gate: the first deny wins and any ask asks. `afterModelCall` passes the message on, so the last override stands. `shouldStop` lets any stop win. Observers run in order and change nothing. A hook that throws fails the moment it belongs to, so a gate that fails closed fails the whole gate closed. `composeExtensions()` and `registerExtensionTools()` refuse two extensions with one name, or one with no name or version, with `invalid_extension`. `registerExtensionTools()` registers each extension's tools with source `extension`; an `override: true` tool replaces a built-in of the same name and nothing else. A turn writes an `extension_loaded` entry for each of `extensionRecords` whose name and hash the session's log does not hold yet.

A project can supply its own extensions, and trust decides whether they load. `@buildanagent/harness/extensions/node` loads them from `.agents/extensions/<folder>/`, each with an `index.mjs` or `index.js` whose default export is an `Extension`, or a function returning one. When a project has extensions, `loadProjectExtensions(root, { trust, headless })` loads none of them and returns a notice saying why if the run is headless or the project is not in the `TrustStore`. A headless run loads a trusted project's extensions only with `loadInHeadless: true`. `fileTrustStore(path)` keeps trusted folders in a 0600 JSON file. The loaders ask a store only about a project's real path, never the spelling the host wrote, because a link can be pointed at another folder after it was trusted: trusting `/work/current` must not trust the clone it points at tomorrow. Two stores in memory serve tests and hosts that decide trust themselves. `memoryTrustStore()`, from the portable `@buildanagent/harness/extensions`, touches no file system and compares paths as written, so give it real paths. `realPathTrustStore()`, from `@buildanagent/harness/extensions/node`, resolves each folder to its real path when the store is built or when its `trust` method adds it. A host that trusts `/tmp/proj`, where `/tmp` is a link to `/private/tmp` as on macOS, therefore gets that project trusted, and a link pointed elsewhere later takes no trust with it. The result of a load holds the `extensions`, the `records` for `extensionRecords` and the `notices`.

Pins keep a trusted project from changing under you. `pinProjectExtensions(root)` writes `.agents/extensions.lock.json`, one SHA-256 per extension folder. The hash covers every file in the folder, in sorted order, each by its path and its own digest. Once a lock file exists, the loader refuses a folder whose hash differs, or that the file does not list, or that the file lists and the project no longer holds, with `extension_hash_mismatch`, and none of the project's extensions load. With no lock file they load and a notice says they are unpinned.

The loader hashes and checks every folder before it imports any, so a refusal runs none of the project's code. Node caches modules for the life of a process, so a folder that changed after the process imported it is refused until the process restarts. An extension folder may not hold a symlink.

Two limits remain. The pin covers the files inside each folder and nothing an extension imports from outside it, such as a relative path that leaves the folder or a package from the project's `node_modules`. And the lock file sits inside the project it pins, so anyone who can edit the project can pin their own changes: the pin catches a change nobody meant, not an attacker who holds the project. Pin a project only after you have read its extensions.

## MCP servers connect side by side, each in its own era, and their tools wait behind tool search

`@buildanagent/harness/mcp` is the MCP client, built on `@modelcontextprotocol/client` 2.4.0 and kept behind its own `McpConnection` interface, so the registry never sees the library. `createMcpManager({ servers, registry })` checks every server's config, and that the registry has `register()`, `registerAll()` and `list()`, when you create it, and starts nothing until `connect()`. That call connects each server on its own, so one slow or broken server never holds back the rest, and it resolves with one status per server: `connected` with the server's era and its tools' canonical names, or `failed` with the error. This example connects one server over stdio:

```ts
export async function connectDocs(registry: ToolRegistry, command: string, args: string[], token: string) {
  const manager = createMcpManager({
    registry,
    servers: [
      {
        name: "docs",
        transport: { kind: "stdio", command, args, env: ["DOCS_REGION"], setEnv: { DOCS_TOKEN: token } },
        requestTimeoutMs: 30_000,
      },
    ],
  });
  const [status] = await manager.connect();
  if (status?.status === "failed") throw status.error;
  return { manager, era: status?.era, tools: status?.tools ?? [] };
}
```

A stdio server gets `spawnEnv()`'s environment and nothing else from the parent: `PATH`, a fresh temp `HOME`, `TMPDIR` and `LANG`, plus the parent variables that `env` names and the values that `setEnv` sets. The harness spawns the child itself, because the library's own stdio transport adds the parent's `HOME`, `LOGNAME`, `PATH`, `SHELL`, `TERM` and `USER` to the environment it is given. `env` follows `spawnEnv()`'s rules, so a name such as `GITHUB_TOKEN` is refused there, and the token goes in `setEnv` with a value the host read from its own secret store. A clean environment is not a sandbox: a stdio server runs on the host as the harness's own user, outside any sandbox, so it can read whatever that user can, `~/.ssh` included. Connect only servers you would run yourself. A server named in `transport: { kind: "in_process", channel }` runs in the harness's process instead, over a channel such as the `InMemoryTransport` of `@modelcontextprotocol/server`, and needs no Node.

**Each server negotiates its own era.** The client sends `server/discover` first, and a server that answers it connects in the 2026-07-28 era. A server that refuses the probe, or stays silent past `probeTimeoutMs`, gets `initialize` and connects as `legacy`. The probe waits 5,000 ms by default, or half of `connectTimeoutMs` when that is shorter, and a `probeTimeoutMs` as long as `connectTimeoutMs` is refused, so a silent server always has time to fall back. A stdio server that exits cleanly after the probe, as servers on some older SDKs do, is started once more and spoken to as legacy from the start. A server that crashes starts once, and the whole connect, a restart included, takes at most `connectTimeoutMs`. `connection.era` and `connection.protocolVersion` record the outcome, so a 2026-07-28 server and a legacy one sit side by side in one harness.

**The tools are registered all or none.** A server's tools take the source `mcp:<name>`, so the registry names them `mcp__<name>__<tool>` and defers them until tool search names them; `exposure` in the config changes that. A server name is 1 to 32 characters from `A-Z`, `a-z`, `0-9` and `-`, and two servers can't share one in any letter case, so no server can take another's prefix or a built-in's name. The manager registers the list through the registry's `registerAll()`, which removes what it added when any tool is refused, so a clash with a tool already registered, even one another manager added a moment before, leaves none of the server's tools behind. It refuses a whole list, registers none of it and closes the server, with an `McpError` of code `mcp_tool_list_refused`, when the list breaks a rule:

- it holds more than `maxTools` tools (default 256), or its pages run past eight;
- a name is over 128 characters or holds a control character;
- an input schema is not an object schema, or is over 64 KiB;
- two names match once normalised to NFKC and lower case, such as `Search` and `search`.

The harness reads the list one page at a time and stops at the page that passes `maxTools`, so a server can make it hold at most one page beyond the limit. A description over 4,096 characters is cut, never inside a character, and the registry hashes a name that needs cleaning.

**A server's schema runs no regular expression.** The SDK checks a call's input against the tool's schema before the permission gate decides the call, and it runs a schema's patterns on a backtracking engine, so a pattern such as `^(a+)+$` could freeze the harness with one crafted input. The harness therefore removes `pattern`, `patternProperties` and `format` from every server's input schema, at any depth, before the tool is defined, and refuses a schema nested deeper than 64 levels. The model reads the schema without them, and the server still checks its own input. The registry builds each tool's definition again for every turn, so a schema is compiled once per turn.

**The server's hints change nothing.** Every MCP tool is registered as not first-party and as a write, whatever its `readOnlyHint` says, so the loop never runs its calls together or runs one again after a crash because of a server's claim. `listTools()` keeps the hints for display only. The tools run through the turn's own tool pipeline, so the permission pipeline decides every call before it is sent, and a denied call never reaches the server. The write cap applies to every result, as to any tool.

**A server's output and descriptions are untrusted.** Each result's entry is stored with `trust: "untrusted"`. That mark is a record only: nothing in a request tells the model which results are untrusted yet, which waits on HD16. Tool search never quotes an MCP tool's description in its own result, which the log stores as trusted; it names the tool, and the description reaches the model with the tool's definition. It scores an MCP tool on its name, counts its description as one word at most, and gives one server at most half the slots, so a description stuffed with keywords can't crowd out the other tools.

**The client gives a server nothing to ask for and nothing to run.** The harness reads a result's content and never its structured content, so it gives the client a validator that compiles no output schema. The client declares no capabilities: a legacy server's sampling, roots and elicitation requests get error -32601, and a 2026-07-28 client drops a server's requests unanswered. No resource link or embedded resource URI is ever fetched.

**Every failure is bounded.** A call fails with an `McpError` of code `mcp_call_failed`, whose `failure` says why:

- `closed`: the server exited or crashed, or the connection closed.
- `timeout`: no answer came within `requestTimeoutMs` (default 60,000 ms).
- `aborted`: the turn's signal fired.
- `input_required`: the server asked for input from the user, which this harness does not supply yet.
- `server_error`: the server answered with an error, and its message is cut to 500 characters.
- `disabled`: the tool is new, changed or removed since it was pinned, and the call never reached the server.

A server that fails to start, or to finish its handshake within `connectTimeoutMs` (default 30,000 ms), fails to connect with `mcp_connect_failed`. A stdio server's line over `maxLineBytes` (default 8 MiB) closes the connection, and a line that is not a JSON object is dropped and logged. Only the newest `maxStderrBytes` (default 64 KiB) of its standard error are kept, for `connection.stderr()`, and they never reach the model.

**Closing ends the server's process group.** `manager.close()` first aborts every handshake still running, so a server that hangs can't hold up the others. It then ends each server's input, waits `closeGraceMs` (default 2,000 ms), sends `SIGTERM`, waits again and then kills the group, so a server that ignores the close, and whatever it started inside its group, still ends. A descendant that leaves the group, by `setsid` or a detached spawn, survives, and on Windows, which has no process groups here, only the server itself is killed. The temp `HOME` is removed, and a tool of a closed server fails when called.

**A signal ends the servers only if the host opts in.** If the harness's process exits without closing, an exit handler kills every group still running. A signal whose default action ends the process emits no exit event, though, and a server's group never gets the terminal's `SIGINT`. The harness adds no signal listener by default, because a listener changes what a signal does to the host. A server that exits when its input ends, as most do, still goes with the host; one that ignores its closed input outlives a signalled host. A host whose process those signals end calls `killMcpServersOnSignal()` once: on the first `SIGINT`, `SIGTERM` or `SIGHUP`, the harness kills every group, removes its listeners and raises the signal again, so the process ends as it would have, and a library such as `signal-exit`, which re-raises only when it is alone, still sees itself alone. A host that handles `SIGINT` to cancel a turn should not opt in, since the first `SIGINT` would end its servers; such a host calls `manager.close()` when it stops. A `SIGKILL` gives the harness no chance to clean up.

**One switch turns MCP off.** With `createMcpManager({ ..., mcp: false })`, `connect()` resolves with an empty list, starts no server and registers nothing.

**A session records which servers ran.** `manager.records()` gives one `extension_loaded` record of tier `mcp` per connected server, in config order; pass them in `extensionRecords` to `createHarness()`, and a turn writes an entry for each record its session's log does not hold yet. A record holds the server's name, the transport kind, the era, and two hashes: one of the command and its args, for a stdio server, or of the URL, for a remote one, and one of the tools as registered, each tool's name, description and input schema, sorted by name. It never holds an argument or an environment value, because either can carry a token, and a server that failed to connect has no record. The command hash is not salted, so anyone who reads the log can check a guess at an argument, such as a short PIN or a token of a known format, by hashing it; put every secret in `setEnv`, never in `args`. Every hash is `sha256:` and the SHA-256 of canonical JSON, so an unchanged server records the same hashes on every connect.

Two limits remain. A server's request for user input fails the call: a server-supplied prompt is untrusted text a person would read as the harness's own, and the owner chose on 2026-11-22 to fail such calls until the connectors work gives a pause a safe form. And the manager takes configs only from host code; a project's own MCP config, which needs project trust, is todo N54.

## A remote server is reached over HTTPS to a public address, and every byte it sends is bounded

A server with `transport: { kind: "http", url }` speaks MCP's streamable HTTP transport, and the era is negotiated as for any other server. `kind: "sse"` is the HTTP+SSE transport of the 2024-11-05 revision, which MCP has deprecated since 2025-03-26; it is for legacy servers only, so the harness connects in the legacy era with no probe. A remote server is untrusted code on another machine, and the harness reaches it with its own network identity, so the URL, every address the URL's name resolves to and every byte that comes back are checked. The client library supplies both transports, and the harness's own guarded fetch sends every request they make. This example, `examples/mcp-remote.ts`, reaches a server through the egress proxy with a token the host read from its secret store, and puts the manager at the turn boundary:

```ts
export function trackerHarness(registry: ToolRegistry, model: Model, proxy: McpEgressFetch, token: string) {
  const manager = createMcpManager({
    registry,
    servers: [
      {
        name: "tracker",
        transport: {
          kind: "http",
          url: "https://mcp.tracker.example/mcp",
          headers: { Authorization: `Bearer ${token}` },
          proxy,
        },
        exposure: "direct",
      },
    ],
    pins: memoryMcpPinStore(),
  });
  manager.start();
  const pipeline = createPermissionPipeline(
    { mode: "default", hooks: [manager.permissionHook()], interactive: true, policyVersion: "v1" },
    registry,
  );
  const harness = createHarness({ registry, model, system: "You track issues.", pipeline, turnBoundaries: [manager] });
  return { manager, harness };
}
```

**The URL and the headers come from host code alone.** The URL must be `https:`, and the harness refuses one with a user name or password, a fragment, a control character, or a query parameter whose name looks like a credential, such as `token` or `api_key`. A credential goes in `headers`, which nothing reads from the environment. A header the transport sets itself, such as Host, Content-Type, Accept-Encoding or Mcp-Session-Id, is refused, and so is a value with a line break. A refusal names the rule and never quotes the value. No log line, error message or `extension_loaded` record holds a header value or the URL: errors and log lines have both replaced with `[redacted]`, and the record holds a hash of the URL. A `401` fails the connect or the call with an `McpError` that says so; the harness runs no OAuth flow and fetches no metadata the server points at.

**Every address is checked, and the request connects to the one that was checked.** Without a proxy, on Node, each request resolves the URL's name once, refuses it when any answer is loopback, private, carrier-grade NAT, link-local (with the cloud metadata address `169.254.169.254`), unspecified, multicast or reserved, or an IPv6 form that wraps one, and connects to the first answer. Once the socket connects, the harness checks the address it reached once more, so a name whose answer changes between two lookups can't steer a request to the host's own network. `allowAddresses` names the ranges one server may reach anyway, such as `10.20.0.0/16`; it never allows loopback. A `/0` range is refused, and so is any IPv6 range that holds the base of a form that wraps IPv4: mapped, compatible, translated, NAT64 or 6to4. `::ffff:0:0/96` is all of IPv4, and `::ffff:10.0.0.0/8` is really `::/8`, so both are refused; write the IPv4 range itself. A range in brackets, such as `[10.0.0.0]/8`, is refused too, since brackets belong to a URL. `unsafeAllowLoopback` lets a test reach a server on `127.0.0.1`, over plain `http:` when every answer is loopback, and nothing else does. `resolve` replaces the system resolver, and every address it returns is checked the same way. With `proxy`, every request goes through the egress proxy's `fetch()`, so its allowlist, its own address checks and its log apply, and the URL must be `https:`. On any other runtime, Cloudflare's workerd included, the platform's `fetch` carries the request. workerd has `node:https` under `nodejs_compat` but refuses the custom lookup the pinned connection needs, so the harness tells it apart by its user agent. There the harness checks a literal address, counts `localhost` and names under `.localhost`, with or without a trailing dot, as loopback, and can't resolve any other name, so the platform decides where it goes.

**TLS is never weakened.** Certificates are always verified, against the system's authorities or the server's own `ca`, over TLS 1.2 or later, and an `https:` URL never falls back to plain HTTP. The harness asks for no compression and refuses a compressed answer on Node, so a decompression bomb is never decoded; through a platform `fetch`, which decodes on its own, the byte caps count decoded bytes.

**No redirect is followed.** The client library would follow a redirect within the server's origin. The harness answers every `3xx` with an error instead, and answers a `304`, which no MCP request asks for, with an error that says so. It never sends a request that leaves the configured origin, such as one to an SSE `endpoint` event on another host.

**Every response is bounded.** A JSON body, one server-sent event and one line may each hold at most `maxMessageBytes` (default 8 MiB), and one stream at most `maxStreamBytes` (default 64 MiB). A response must start within `headersTimeoutMs` (default 30,000 ms), and a stream is cut when it sends nothing for `streamIdleMs` (default 120,000 ms) or stays open past `maxStreamMs` (default an hour). At most `maxStreams` responses (default 8) may be open on one connection; a request past that fails at once. A body, event or line past its size, or any bound on the answer to one request, closes the connection and fails what was waiting on it, with the bound in the error. A streamable HTTP GET stream or a `subscriptions/listen` stream that goes quiet, stays open an hour or passes `maxStreamBytes` is cut and opened again at once, and such a cut never counts against the reopen limits below. A legacy SSE server's event stream is the one channel its answers come on and can't be opened again, so it has only the event and line bounds: a quiet SSE server needs no keepalives. A body on that GET that is not an event stream, such as an error page, is bounded like any answer. The server's session id must be 1 to 256 visible ASCII characters, and the harness sends it back and trusts nothing else about it.

**The server can't set the reconnect delay.** The harness removes every `retry:` field from an event stream, and every `id:` field the client could not send back as `Last-Event-ID`, before the library reads the stream. A streamable HTTP stream that drops, or whose reopen fails, is opened again after one second, doubling to thirty, and after ten such reopens within ten minutes the connection closes, so a legacy server never keeps a connection with no stream for its change notices. A legacy SSE stream is opened once: when it ends, the connection closes, and nothing reconnects it.

## Servers connect in the background, and the first turn waits only for `direct` servers

`manager.start()` connects every server in the background and returns at once. Pass the manager to `createHarness({ turnBoundaries: [manager] })`. Each turn then calls `manager.beginTurn()` before it builds the turn's tools. The first turn waits up to `directWaitMs` (default 10,000 ms) for the servers whose `exposure` is `direct`, and for no other. A deferred server that takes thirty seconds to answer never delays the first model call, and a `direct` server that answers within the wait is in the first request's tools. A server that connects later is registered at the next turn's start, never inside a turn, and a `direct` one is registered as `deferred`, so the tools a request sends never change because a server was slow. A server that fails is tried once and reported once, in its status and through `log`. `manager.statuses()` reports each server, `connecting` until its tools are registered. `manager.close()` aborts the connects still running and every open stream, and clears its timers. `connect()` still connects everything and waits, for a host that wants every server before its first turn.

## A tool runs only while its definition matches its pin, and a change waits for the next turn

The manager pins each tool's definition: `sha256:` and the SHA-256 of the canonical JSON of its `name`, `description` and `inputSchema`. The annotations are left out, because they change nothing the harness does. With `pins`, a store of approved definitions, a tool that has no pin, or whose definition hashes differently, starts disabled, and a server the store holds nothing for has every tool disabled. Without a store, each server's tools as listed at connect are its pins for the life of the manager. `fileMcpPinStore(".agents/extensions.lock.json")` from `@buildanagent/harness/extensions/node` keeps the pins in the project's lock file, under `mcp.<server>.tools`, beside the extension pins, and each writer keeps the other's entries. `readMcpPins(file, server)` and `writeMcpPins(file, server, pins)` from the same entry read and write one server's pins directly, for a host that builds its own store; `writeMcpPins()` refuses a lock file it can't read. Every write to one path in this process, through any store or `writeLock()`, runs after the one before it. A lock file with MCP pins alone pins no extension, so writing it never makes a project's extensions refused, and the loader's notice says the file holds no extension pins. A lock file that is a link, not a regular file, or over 1 MiB is refused. The harness checks and reads it through one open handle, so a file swapped in between the check and the read is never read. The lock file sits in the project, so anyone who can commit to the project can approve definitions for any server the host configures: give a project's `fileMcpPinStore()` to the manager only for a project the person trusts, as project extensions load only then. `pinProjectExtensions()` replaces a lock file it can't read, such as one with merge-conflict markers, and its MCP pins go with it; an MCP pin write refuses such a file, since dropping the extension pins would let unpinned extensions load.

**A disabled tool is refused before its server.** `manager.permissionHook()` denies a call to a disabled tool before anything else decides, so a sticky allowance, an allow rule or `bypass` mode can't run it; put it first in the pipeline's `hooks`. A disabled tool's own `execute` refuses the call too, with `failure: "disabled"`, so the server is never reached without the hook either. `manager.pending()` lists the tools waiting for a person, with each one's definition for the person to read and its hash. `manager.approve(server, tool, hash)` writes the pin and then records the approval, so a failed write approves nothing, and the tool may run from the next turn. A hash that is no longer the server's current one is refused, so an approval never covers a definition the person did not see, and a tool that changes after its approval is disabled again. A tool runs only when both its server's current definition and the definition it was registered with match its pin, because the model reads the registered one all session. The registered definition's hash is the one taken from the same list the tool was registered from, so a server that lists another definition between its connect and the turn that registers it can't make the registered one pass. A tool registered with an unapproved definition therefore stays disabled for the session even if the server later lists the approved one, and a new session registers that one.

**A changed list is read again and announced at the next turn.** A legacy server's `notifications/tools/list_changed`, and the same notice on the `subscriptions/listen` stream that the harness opens on a 2026-07-28 server that advertises `tools.listChanged`, make the manager read the list again, at most once per `relistIntervalMs` (default 2,000 ms), however many notices come. A dropped listen stream is opened again after one second, doubling to a minute; after eight short-lived streams in a row, it stays closed. At the next turn's start, a changed, new or removed tool is disabled, an approved one is enabled, and the turn writes one notice, a text block of origin `harness` in front of the user's input. The gateway's transcript has no system role, so this block is how an append-only log tells the model that tools changed. The notice names each tool by its canonical name, which keeps only `A-Z`, `a-z`, `0-9`, `_` and `-` of the server's name for it, and says what changed. It never quotes a description, it counts the tools a server added mid-session instead of naming them, it lists at most 20 changes, and a change that is undone before the turn announces nothing. A notice counts as told only once the turn has written it, through `manager.commitNotices()`, so a turn that fails before its input is written tells it again next time.

**The tools a request sends never change mid-session.** A changed tool keeps the definition it was registered with, so the model reads the old description until a new session. A tool a server adds mid-session is not registered: it waits in `manager.pending()`, and once approved it joins the next session's tools.

Four limits come with the remote transports and the pins:

- the post-connect address check and the reconnect delay clamp are second guards, behind the pinned lookup and the removed `retry:` field;
- the manager's tool state is per manager, so two sessions that share one manager see each other's turn boundaries;
- a response stream that breaks loses its request, and the harness never sends a tool call again, since every MCP tool is a write;
- on any runtime but Node, Cloudflare's workerd included, a name is resolved by the platform, which the harness can't check; `localhost` and names under `.localhost` count as loopback there.

## A skill is a file the model reads, and only its name, description and path are in the prompt

A skill is a folder under `.agents/skills/` with a `SKILL.md` whose frontmatter has a `name` and a `description`. `discoverSkills(cwd, { trust })` from `@buildanagent/harness/extensions/node` finds them in `cwd` and in every folder above it up to the repository root, which is the first folder with a `.git`. A `cwd` in no repository searches only itself. It returns the `skills`, the `records` for `extensionRecords` (tier `skill`, the SHA-256 of each `SKILL.md`'s bytes as stored) and the `notices`. The nearer folder wins when two skills share a name, and a file that is not a skill is skipped with a notice. The loader also skips three things, each with a notice: a `SKILL.md` that is a link leaving the project, a `SKILL.md` past 256 KiB (a limit we chose so that every record's hash covers a whole file), and a folder whose name holds a control character or, on POSIX, a `\`.

```ts
const { skills, records } = await discoverSkills(cwd, { trust: fileTrustStore(trustFile), headless: false });
const system = withSkills("You help.", skills);
const harness = createHarness({ registry, model, system, skills, extensionRecords: records, env: { cwd } });
```

`withSkills()` adds a `## Skills` section that lists each skill's name, description and path and never its body. The model loads a skill by reading its `SKILL.md` with the `read` tool, and the turn then writes a `skill_loaded` entry with the skill's name and path. A harness records one entry for each successful `read` whose `path` or `file_path` input names a listed skill's own `SKILL.md`, once per read, because a compaction can drop the body and a second read loads it again. A read of another file in the skill's folder, one that failed, or one that asks for part of the file with an `offset` or a `limit` writes none. To record loads, pass `skills` to `createHarness()`, and pass the same `cwd` you gave `discoverSkills()` as `env.cwd`. The turn matches each read against `skills` and takes a relative path from `env.cwd`. If you leave `env.cwd` out, it is `/`, and a relative read such as `.agents/skills/triage/SKILL.md` matches no skill. A skill whose path starts with a drive such as `C:\` matches Windows reads, where `\` separates folders as `/` does; any other skill path is a POSIX one, where only `/` does.

The frontmatter checks follow Pi's skills documentation. A name is lowercase letters, digits and single hyphens, at most 64 characters, and a description is at most 1,024; a file past either limit, or with no description, is not listed. A skill's name should match its folder's, and one that differs loads with a notice. The frontmatter reader handles a small subset of YAML: `key: value` lines, quoted or plain, with a value that continues on indented lines or is a `>` or `|` block.

Skills are inside the project-trust gate, as the guide says, and `trust` is required, as it is for `loadProjectExtensions()`: a skill's name and description go into the system prompt, so an untrusted checkout must not reach it by a caller leaving the store out. An untrusted project, or a headless run without `loadInHeadless: true`, lists no skills and returns one notice saying why. A host that trusts every project it opens passes a store that says so. As with extensions, trust decides what loads and nothing more: a loaded skill is text the model may follow, and no sandbox comes with it.

## `AGENTS.md`, `CLAUDE.md` and the plan files lead every request, labelled untrusted

`contextFiles(cwd)` reads `AGENTS.md` and then `CLAUDE.md` in each folder from the repository root down to `cwd`, so the file nearest the work comes last. A `CLAUDE.md` that is a link to the `AGENTS.md` beside it is read once. Context files load whether or not the project is trusted, because they are text and not code, and `contextFiles()` takes no trust store. Each file is cut at 64 KiB: no more than that is read, however long the file, and the cut falls between characters. `contextFiles()` returns every file it read, and `projectContext()` holds them together to 128 KiB (`CONTEXT_FILES_MAX_TOTAL_BYTES`), because the block is added after the context policy has counted the request, so compaction can't shrink it. Past that limit the outermost files are left out first, so the ones nearest the work stay, and the block names those it left out, so the model knows they exist. A link that leaves the project is skipped with a notice, so a cloned repository cannot point `AGENTS.md` at `~/.ssh/id_rsa` and send it to the model provider.

```ts
const { files } = await contextFiles(cwd);
const context = projectContext({ files, plan: planFileSource(cwd) });
const { interceptors } = composeExtensions([context]);
const harness = createHarness({ registry, model, system: withPlanConvention(system), interceptors });
```

`projectContext()` returns an extension whose `transformContext` hook puts the files at the start of the first user message of every request, as one text block whose bytes never change, followed by a second block for the plan files. Each file sits in an `<untrusted-project-context-TOKEN source="…">` section under a note that says the text is the project's and not the user's. The token is the first 16 hex digits of the SHA-256 of the file's path and text, and the section ends only at `</untrusted-project-context-TOKEN>` with the same token. A file would have to hold its own hash to close its section early, and the token stays the same while the file does, so the block's bytes still never change. As a second guard, every spelling of the label's tag in a file is escaped. The match runs on a folded copy of the text: white space and format characters are removed, and the rest is normalised to NFKC and lower case. It therefore catches fullwidth brackets, a tag name split across lines, and entities for `<` with or without their `;`. The text is rebuilt from the files for each request and is not written to the log, so a compaction that replaces the early messages with a summary can't remove it: the first request after a compaction holds the `AGENTS.md` text again, beside the summary. The cost is that the log doesn't hold the context files' text, so a replay needs the same files.

A long task keeps its state in two files under the project's `.agents/` folder: `plan.md` (Markdown: the goal, the steps, which are done) and `progress.json` (JSON: what is done and what is next). `withPlanConvention()` adds a paragraph to the system prompt that tells the model to keep and update them. `planFileSource(root)` reads both files from disk. `projectContext()` asks the source at the first model call of every run, whether the run is a new turn or a resume, so the first request of a resumed session holds what the last process left. The same text is sent for the rest of the run, so the model's own edits during a run show in the next run, and the run's later calls read the prompt cache. A plan edit is not free, though. The plan sits in the first message, and a provider caches a prompt by its prefix, so the first call of the run after an edit reads none of the conversation from the cache: everything after the system prompt and tools is sent uncached once, and later calls read it from the cache again. Putting the plan in its own block after the context files keeps their text unchanged but does not avoid that pass. The gateway puts cache breakpoints on the system prompt, the tools and the newest message, never between the two blocks. A file that doesn't exist is left out, and a `progress.json` that isn't valid JSON, which a crash can leave, is shown as written with a notice. The harness only reads these files; the model writes them with its ordinary tools.

## Long-term memory is an extension of sourced records that expire, and a delete reaches the log

A wrong fact that never expires misleads every later run, and a deleted fact that stays in a transcript is not deleted. `memoryExtension()` from `@buildanagent/harness/memory` gives an agent facts that outlast a session, kept as files under the project's `.agents/memory/`. It is off until you load it: with it left out, no `memory` tool and no index reach the model. Load one per session, beside the registry the session's tools are in. `fileMemoryFiles(root)` from the Node-only `@buildanagent/harness/memory/node` keeps the folder on disk, and a host on another runtime passes its own `MemoryFiles`, five calls over names relative to the folder.

```ts
/** A harness with long-term memory for the session `sessionId` of the project at `root`. */
export function memoryHarness(registry: ToolRegistry, model: Model, root: string, sessionId: string) {
  const memory = memoryExtension({ root, files: fileMemoryFiles(root), registry, sessionId });
  const { interceptors, observers } = composeExtensions([memory]);
  registerExtensionTools(registry, [memory]);
  const harness = createHarness({ registry, model, system: SYSTEM, interceptors, observers });
  return { harness, memory };
}
```

**One file holds one record.** A `MemoryRecord` has a `subject`, the `fact`, a `source` (a `file:line`, a URL or the user's own words), a `type` (`project`, `task` or `preference`), the `created` and `validated` dates, an `expires` date (`null` for a preference that holds until it is changed) and a `trust` of `trusted` or `low`. A task record also names its `session`, the one whose `endSession()` expires it. A change or a renewal from another session keeps that name, and `endSession()` returns without a change when the folder is refused, as the index does. The file is Markdown: front matter between two `---` lines, one field per line with its value as a JSON string or `null`, then the fact as the body.

```md
---
subject: "How to build"
source: "AGENTS.md:12"
type: "project"
created: "2026-11-22T09:00:00.000Z"
validated: "2026-11-22T09:00:00.000Z"
expires: "2027-02-20T09:00:00.000Z"
trust: "trusted"
---
Run pnpm build from the repository root; the SDK needs the gateway's dist first.
```

**The `memory` tool has five commands.** `view` shows a record, with its source, its dates and its trust beside the fact, or lists the records of a folder. `create` writes a new record from `path`, `subject`, `fact`, `source` and `type`. `str_replace` changes the fact from `old_str` to `new_str`, and may give a new `source`. `delete` removes a record, and `rename` moves one from `old_path` to `new_path`. A path is relative to the project root, or absolute under it, and must already be canonical and inside `.agents/memory/`. A path with a `.` or `..` segment, a percent sign, a backslash, a control character or a name that starts with a dot is an error result, and the tool reads nothing for it, so neither `.agents/memory/../secrets.env` nor `.agents/memory/%2e%2e/secrets.env` reaches a file. `fileMemoryFiles()` then walks the real path one folder at a time and refuses a link anywhere on the way, the record included, so a link planted in a cloned project can't send a read or a write outside the folder. A `delete` or a `rename` of the folder itself is refused. A write that holds a credential's shape, or one of the `secrets` the host passes, is refused and stored nowhere.

**The index leads each run's first request.** The index is one line per record that still holds, with its subject, type, trust and path, and never its fact. Like the context files, it is built into the start of the first user message by a `transformContext` hook, labelled untrusted, and is in neither the system prompt nor the log. It is read at each run's first model call, so a record written in one run shows in the next. It stops at 200 lines or 25 KiB, whichever comes first (`MEMORY_INDEX_MAX_LINES`, `MEMORY_INDEX_MAX_BYTES`), heading and note included, and the note says how many records it left out. Trusted records come first, then the most recently validated. The agent finds the rest with `grep` and `glob`.

**A record expires unless a write renews it.** Every date comes from the extension's injected `clock`. A record is shown in `view` and in the index only until it expires (`MEMORY_EXPIRY_DAYS`):

| Type | Trusted | Low trust |
| --- | --- | --- |
| `project` | 90 days after it was last validated | 30 days |
| `preference` | until it is changed | 30 days |
| `task` | when `endSession()` runs, or 7 days | when `endSession()` runs, or 1 day |

A `view` never moves `validated`. A `create` or a `str_replace` sets it to now, and a `str_replace` whose `old_str` equals its `new_str` renews a record without changing it: the tool's description tells the model to do that only after it has re-read the record's source and found the fact still true. The extension does not read the source itself, so the check is the model's. An expired record stays on disk until a `create` replaces it or a `delete` removes it.

**Writes after untrusted input are low trust, and no write raises a record's trust.** Once a result from a tool whose `outputTrust` is `untrusted` is in the session, or the model has viewed a low-trust record, every write the session makes is stored with `trust: "low"`. A `str_replace` keeps the lower of the record's trust and the session's, so a renewal or a change in a trusted session leaves a low-trust record low trust, with the low-trust period. Only a `create` over an expired or deleted record starts from the session's trust. A call to such a tool in the same step as the write also makes it low trust, because the two may run together. The `memory` tool's own results are logged as `untrusted`, because a record may have been planted, but a view of a trusted record does not make later writes low trust. The session's earlier tool results are read from the conversation, so after a compaction removes them in a new process, only a fresh untrusted result marks the session again.

**The built-in `write` and `edit` tools can't write the memory folder.** The extension's `beforeToolCall` gate denies a `write` or an `edit` whose path, resolved against the root and compared without case, is in `.agents/memory/`, so a record can't skip the memory tool's trust and secret checks, and the bookkeeping files can't be written over. The gate reads only those two tools' paths. `bash`, and any tool whose writes it can't read, can still write the folder, and a link to the folder from elsewhere in the project is not seen. A record carries no mark of the tool that wrote it, so a record planted that way reads like any other, though its expiry is still capped by its type and trust.

**A delete marks every call that held the record.** The extension remembers each call that wrote or returned a record: every `memory` call on it, and any other tool's call whose result holds the record, whatever its input names, such as a `read` of the record's file, `cd .agents && cat memory/x.md` or a copy of the fact elsewhere. A result holds a record when it holds the fact, a line of the fact or the file's `subject` line verbatim, or the fact with its white space collapsed, as a result that wraps the fact's lines shows it. A text under 12 characters is too likely to occur by chance, so a fact that short is marked only on the `memory` tool's own calls, and a cut result that keeps none of a record's lines is not marked. An expired record counts too, because its file stays readable until a `create` or a `delete` replaces it. The extension never fails another tool's call to track it. If the folder is refused or the bookkeeping can't be read, the call stays unmarked and its result reaches the model unchanged.

**The calls file is bounded.** A record keeps its newest 100 calls, and the calls file stays under 2 MiB. Older calls, and the calls of a record whose file another tool removed, go to the purge list early rather than being dropped. A calls file the extension can't read is moved to `.calls-unread.json`, and memory keeps working without the calls it held.

**The purge list is read with `readPurgeMarks()` and cleared with `clearPurgeMarks()`.** A `delete` adds a mark for each of those calls to the purge list, and `readPurgeMarks(files)` returns them as `PurgeMark`s, each a run id, a call id, a tool name and the date it joined the list. `purgeSession()` from `@buildanagent/harness/session` rewrites a session so that no marked entry keeps its content, and `clearPurgeMarks()` removes the marks it is given once every session that held them is purged. The `unmatched` option of `clearPurgeMarks()` takes the marks a pass over every session found in none, such as a mark whose call never reached the log, and drops each once it has been on the list for 30 days, so the list can't grow for good and a pending delete is not dropped early. The clear waits for the memory calls of any extension in the process over the same `MemoryFiles` object, and `fileMemoryFiles()` returns one object per root, so a delete that runs meanwhile keeps its marks. Nothing coordinates two processes, so clear where no session over the folder runs in another. The pass below does four things: it purges each session (a fork before the session it continues), deletes the purged results' spill files, and clears the marks the purges applied:

```ts
/**
 * Purges each session once, adding the marks each purge applied to `applied`, and returns the sessions that a fork
 * still continues, with the conflict that names one of them.
 */
async function purgeRound(
  log: Log,
  userId: string,
  sessionIds: readonly string[],
  marks: readonly PurgeMark[],
  applied: PurgeMark[],
  removeSpill: (path: string) => Promise<void>,
) {
  const waiting: string[] = [];
  let conflict: unknown;
  for (const sessionId of sessionIds) {
    try {
      const result = await purgeSession({ ...log, key: { userId, sessionId }, marks });
      if (!result.purged) continue;
      applied.push(...result.marks);
      for (const path of result.spills) await removeSpill(path);
    } catch (error) {
      if (!isHarnessError(error) || error.code !== "session_conflict") throw error;
      waiting.push(sessionId);
      conflict = error;
    }
  }
  return { waiting, conflict };
}

/**
 * Purges every deleted record from each of the user's sessions, then clears the marks those purges applied. A session
 * that a fork continues waits until the fork is purged, so the order of `sessionIds` does not matter. `sessionIds` must
 * list every session that could hold a mark, because a mark the pass finds in none leaves the list after 30 days.
 */
export async function purgeDeleted(
  root: string,
  log: Log,
  userId: string,
  sessionIds: readonly string[],
  removeSpill: (path: string) => Promise<void>,
) {
  const files = fileMemoryFiles(root);
  const marks = await readPurgeMarks(files);
  const applied: PurgeMark[] = [];
  for (let pending = [...sessionIds]; pending.length > 0; ) {
    const { waiting, conflict } = await purgeRound(log, userId, pending, marks, applied, removeSpill);
    // No session was purged this round, so the forks they wait for are not among `sessionIds`.
    if (waiting.length === pending.length) throw conflict;
    pending = waiting;
  }
  // A session purged earlier holds nothing now, so a mark no purge applied this time held nothing in any session.
  const unmatched = marks.filter((mark) => !applied.includes(mark));
  await clearPurgeMarks(files, applied, { unmatched });
}
```

A purge blanks each marked call's input to `{}` and its result's content to `PURGED_TEXT`, and every entry keeps its base fields, so the session still rebuilds. The result's `spills` lists the spill file of each purged result, for the caller to delete with the spill store that wrote it. Its `residual` lists, by entry id, the compaction summaries and the model's own text after the first marked call, which the purge leaves as they are. A fork that continues a file the purge would rewrite must be purged first, or the purge throws `session_conflict` before it writes anything. The [session format page](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/docs/session-format.md#a-memory-delete-marks-entries-and-a-targeted-purge-removes-their-content) says how marks match, how the new files are named and replaced, and what a purge leaves behind.

## A call that needs a person is a signed pause that any process with the key file can resume

When the permission pipeline's gate returns `ask`, the turn ends `awaiting_approval`, and the signed request is the log's `approval_requested` entry, written before any observer of the harness sees the event. A client that listens on the run's own handle, not on the harness's observers, can hear of a request a moment before the log has it. The harness never blocks on an approval, so a restart loses nothing. The entry holds the SDK's request unchanged, with the input the call would run with. It names its key by id and holds no key bytes.

`createApprovals(harness)` from `@buildanagent/harness/session` reads and answers the pauses:

- `pending(session)` lists the requests whose call has no result yet, each with its input. A request stays listed after an answer until its call runs.
- `resolve(session, resolutions, options?)` throws `approval_not_pending` for a request that doesn't wait, and `approval_unavailable` when the harness has no `signer`. It writes each answer as an `approval_resolved` entry, lets the quorum policy decide each request, then calls `continueRun()` with the harness's signer for the requests the policy settled. The SDK verifies each request's signature, call and input, so a tampered request runs nothing, writes a new `approval_requested` entry and asks again.
- Each approved call goes through the permission pipeline once more before it runs. A deny rule added after the pause turns the approval into a denial result, and a question the pipeline would ask again does not stop a call a person approved.
- `options` takes the same settings as a turn: `budgetUsd`, `signal`, `hostContext`, `clock`, `newId`, `maxSteps`, `output`, `turnRetries` and `modelOptions`, plus `model`. The log holds none of the settings except the tools, so the host passes them again.
- The tools are the paused turn's, read from the log. A `model` that differs from the paused turn's is recorded as a `loadout`.
- A request bound to a `hostContext` when it paused runs only when the resume passes the same value, so that value is the caller's identity. The resumed turn starts with a `turn_start` of mode `continue`.

The host fills `Resolution.by` only after it has authenticated the approver. An answer never ends a wait by itself: a request waits until its call has a result, so a resume the SDK refuses leaves the pause as it was. A second answer for the same request is appended after the first, and the later resume uses it. If a resume dies after it was given an allow, the call may have run. The next turn settles that call as a crash and does not ask again, even when the run died before it reached the call.

### One answer can cover more than its call, and a quorum can ask for several

`resolve()` takes four more options (`sticky`, `commandPrefix`, `group` and `requesterId`), and `createApprovals(harness, { quorum, secrets })` takes a quorum policy and a secret list.

- **Sticky allowances.** `sticky: "run"` or `"session"` makes an `allow` cover the same call again. The `approval_resolved` entry carries the `sticky` scope and an `allowance`: the tool and the call's input hash or, with `commandPrefix`, a command prefix, and the policy version it was given under. When the pipeline would ask about a call that an allowance covers, the call runs, and a `permission_decision` entry with `by: "sticky"` records why. A deny rule still wins, because the allowance only answers an ask. A `run` allowance lasts until the next turn starts, resumes included. A `session` allowance counts from the start of the session's own file, so a fork never inherits it. It is ignored once the permission policy's version changes, because a person approved it under the earlier policy.
- **Never covered.** A command whose first word, by any path, is a shell, an interpreter, a package runner or a wrapper such as `env`, `sudo` or `xargs` throws `sticky_refused`. That includes the listed prefixes (`bash -c`, `sh -c`, `sh -lc`, `zsh -c`, `node -e`, `python -c`, `bun run`, `npx`, `uvx`), `/bin/sh -c`, `env bash -c` and `python3 -c`. So does a call whose input holds a value that `secrets()` returns, whether the secret appears as plain text or as JSON would escape it, and any sticky answer under a custom quorum policy, because one approver's click would then skip the quorum on every later call.
- **Prefix rules.** A command prefix must be a non-empty start of the approved command, on a call that has a `command`, and it covers only a simple command: one with no operator, quote, glob, expansion, substitution or line break. A `git status` prefix covers `git status -s` and not `git status && curl x | sh`.
- **Reuse.** `approvalReuse` is `both` (the default), `sticky`, `group` or `none`, and a tool takes only the kinds it names. A refused answer throws `approval_reuse_refused` before anything is written, and the call asks again next time.
- **Grouped answers.** With `group: true`, an answer reaches every waiting request of the step with the same tool and the same whole input; for a shell command the spaces outside quotes are normalised first, and a field such as `cwd` still tells two commands apart. The entries share a `groupId`, and each counts as that approver's answer on its request, so a quorum above one still needs more approvers. Only a group that joins more than one request needs its tool to allow grouping.
- **Quorum policy.** A `QuorumPolicy` has one method, `evaluate(request, resolutions)`, that returns `met`, `pending`, `rejected` or `expired`. `oneResolution` is the default and follows the latest answer. `quorumOf(n)` needs `n` distinct approvers named in `Resolution.by`, counts only allows, and refuses an `n` that is not a whole number of at least one. `met` runs the call, `rejected` and `expired` turn it into a denial result, and `pending` leaves it waiting: the turn ends `awaiting_approval` again. Calling `resolve(session, [])` asks the policy about every request of a paused turn, which is how a policy that keeps its own clock expires an old one. It leaves a code call's request waiting: the policy decides that call when it is next answered, so a late allow for an expired call comes back `denied`.
- **What the log keeps.** A denial by the policy, not a person, is written with `by: "policy"`. A pending answer is marked `quorum: "pending"` so that crash detection does not read it as an answer a run received.
- **Requester.** `requesterId` names who asked, and an approver equal to it throws `approver_is_requester`. The host authenticates approvers and fills `Resolution.by`; the harness trusts what it is given.

### Code runs a side effect through the same pipeline and pause as the model, with no model call

`harness.invokeTool(session, { tool, input, hostContext })` runs one tool call that your code chose, such as an approved reply or a refund. The call goes through the same permission pipeline, signed pause and log as a call the model makes, and the model is never called. The session must be open with its lock.

```ts
const call = { tool: "refund", input: { orderId: "o1" }, hostContext: { user: "ada" } };
const result = await harness.invokeTool(session, call);
if (result.status === "awaiting_approval") {
  await createApprovals(harness).resolve(session, [{ requestId: result.pending.id, decision: "allow", by: "grace" }], { hostContext: call.hostContext });
}
```

The call's own entries start with a `code_call` entry, which holds the call's `callId`, the tool's canonical name, the input and its hash. The entry's id is the call id. Before it, `invokeTool()` writes what the session still lacks: a new session's `session_header` and `env_stamp`, and a `tool_result` for each earlier code call that a crash left open. The pipeline then decides the call with `initiator: "code"` and writes its `permission_decision`, and the call ends one of three ways:

- **`done`.** An allow runs the tool through the harness's `wrap` with the call's host context, and writes its `tool_result`. A sticky allowance covers a code call as it covers a model call. `result` holds the whole of what the tool returned, even when the stored entry is capped.
- **`denied`.** A deny writes an error `tool_result` and returns the reason. The tool never runs.
- **`awaiting_approval`.** An ask signs the request with `createPendingRequest()` and the harness's signer, and writes it as an `approval_requested` entry before the result returns. The request signs a MAC of `hostContext` when one is given, so only the same host context can resolve it. `Approvals.pending(session)` lists a paused turn's requests first and this request after them.

The stored result is capped as a model call's is. The harness's context policy caps it and spills the full text. A result still over the store's entry bound is cut to fit, with its outcome kept at the front, so a call that ran always gets its result. A tool that throws gets an error result; for a write, its outcome is `unknown`, because the write may have taken effect.

`resolve()` routes an answer by its request. An answer to a code call's request resolves that call on its own and returns a `CodeCallResult`, so it can't share a `resolve()` with any other answer (`invalid_code_call`). Before anything is written, the answer is checked against the request: the signature under a key in the ring, the bound host context, the call and the tool, and the input, which must hash to the signed hash in the `code_call` entry, the `approval_requested` entry and the request alike. A request that fails throws `approval_refused` with the cause, writes nothing and runs nothing. The answer is then written, and the quorum policy decides. `met` decides the call again with the pipeline, so a deny rule added after the pause wins, and then runs the tool with `options.hostContext` and `options.signal`. `rejected` and `expired` deny the call, and `pending` returns `awaiting_approval`. A code call's expiry is enforced when it is next answered, because `resolve(session, [])` leaves its request waiting. `sticky`, `group` and `requesterId` apply as they do for a turn, and `approvalReuse` refuses a sticky or grouped answer the same way. A code call has no step, so a grouped answer covers only its own call. `budgetUsd` and the model settings don't apply, because no model is called.

Every result except `denied` carries `effectKey`, the call's effect identity. It comes from the tool's business key (`effect.businessKey`) when the tool declares one, and otherwise from `effectScope(session, harness, callId)`, whose call id is the `code_call` entry's id. A tool that builds its own key with `effectScope(session, harness, ctx.callId)` therefore gets the same key, and a resolution in another process finds it again.

A code call is the host's, so the model never reads it or its result. Each code call runs at most once, even across a crash. Two terms carry the rule. A call *starts* once its log holds the entry that clears it to run: the pipeline's allow, a sticky allowance, or, after a person's allow, the pipeline's fresh decision when it is not a deny. The tool starts right after that entry. To *settle* a call is to write the result it lacks, for a call that crashed, never ran or was interrupted. The next `invokeTool()` on the session settles every call a crash left open:

| The call | What its log holds | What the next `invokeTool()` does |
| --- | --- | --- |
| Has a result | A `tool_result` | Nothing. The call no longer waits, so a replayed answer throws `approval_not_pending`. |
| Started, no result | The entry that cleared it, and no `tool_result` | Settles it with the result an interrupted model call gets, and never runs it again, because it may have taken effect. |
| Answered or never asked, never started | No entry that cleared it, and either a final answer or no request | Settles it with an error that says it never ran, so a compensation that names it is refused. |

A call that asked and has no final answer is not open: it still waits.

Within one process, one code call of a session runs at a time.

A code call runs no turn, so the harness's `interceptors` and `observers` don't see it: they are the hooks and events of a model step. A `beforeToolCall` may replace the input or ask through the run's own pause, neither of which fits a call whose input is recorded and hashed before it is decided. What applies to a code call is the permission pipeline, whose `hooks` see `initiator: "code"`; the harness's `wrap`, which can guard or redact around the tool; and the context policy's write cap. Put a guard that must cover code calls in the pipeline's `hooks` or in `wrap`.

`compensates` names the call id of an earlier code call that this one undoes, such as a refund reversal after a refund. The earlier call must have run, and the compensation must reach an effect key of its own, or `invokeTool()` throws `invalid_code_call`. The compensation's `code_call` entry records the link.

`invokeTool()` throws before it writes anything:

- `invalid_code_call`: a tool the registry lacks or that runs on the client, an input or host context with no canonical JSON form, a business key that fails, a harness with no pipeline, or a compensation that fails its check.
- `approval_unavailable`: a harness with no signer.
- An aborted signal throws its reason.

It does not check the input against the tool's schema, because your code, not a model, chose it.

### The key ring is a 0600 file outside the log and the sandbox

`fileKeyStore(path?)` from `@buildanagent/harness/session/jsonl` is a `KeyStore` over one file, by default `$XDG_STATE_HOME/buildanagent/keys.json` (or `~/.local/state/buildanagent/keys.json`). `load()` creates a ring with one random 256-bit key when the file is missing, in a folder of mode `0700`, and refuses a file that group or others can read, that belongs to another user, or that is a symbolic link. Pass the loaded ring to `hmacSigner()` and give the signer to `createHarness({ signer })`; the SDK reads the key by the id a request names, so a request signed with an older key still verifies. `rotate()` adds a new current key, and `prune(inUse)` removes every key not in `inUse` except the current one, so pass the `keyId` of every request that still waits. `rotate()` and `prune()` take a lock file beside the ring, so two processes that change it together keep both changes. A tool or sandbox sees none of this: the ring is in the host's files, and a spawned process gets [a cleared environment](#every-spawned-process-gets-a-cleared-environment).

### A read-only secret can hold the key ring instead

On a serverless host the harness can read its key but not write it, so `secretKeyStore({ read })` from `@buildanagent/harness/session` is a `KeyStore` with `load()` only. `read()` returns the secret's text, the JSON ring that `parseKeyRing()` reads, such as `{"current":"2026-11","keys":{"2026-11":"<key>"}}` with each key at least 32 random bytes in unpadded base64url. `load()` calls `read()` every time and keeps no copy, so a ring the platform rotated takes effect at the next load. `load()` throws `invalid_key_store` for a `read()` that fails or returns a non-string, and for a ring that is not JSON, holds a key that is not base64url or is shorter than 32 bytes, or names a `current` it lacks. The error's message is fixed text and the error has no cause, so it never holds the secret's text, a key id, a key or the error `read()` threw. To find which rule a ring breaks, check the secret itself. The store imports no Node module, so a Cloudflare, AWS or Vercel adapter only has to supply `read` (N46a, N47a and N48a build those).

The owner rotates such a ring with the platform's own tooling: add a new key and make it current, then remove an old key once no waiting request names it. `rotateKeys(store)` and `pruneKeys(store, inUse)` call a store's `rotate()` and `prune()` when it has them. On a store without them they reject with `key_store_read_only`, whose message names the platform's secret tooling (by default "such as wrangler secret put, aws secretsmanager put-secret-value or vercel env"; pass `platformHint` for your own text). 
`keyStoreConformanceCases(factory)` and `runKeyStoreConformance(factory)` in `@buildanagent/harness/testing` check a store with five cases. `load()` returns a usable ring, returns the same ring twice, and gives a ring that signs and verifies through `hmacSigner()`. `rotate()` keeps the old key loadable, and `prune()` keeps the current and in-use keys and returns the ids it removed. The rotate and prune cases skip with a reason when a store leaves the methods out. Run `runKeyStoreConformance(factory)` against any store you write.



## Every removable component has one ablation switch and one header hash

`@buildanagent/harness/ablation` defines `AblationConfig`—one switch per removable component—along with `DEFAULT_ABLATION`, `defaultAblation()`, `validateAblation()`, `ablationHash()` and `credentialEnvOf()`. `AblationConfig` omits the session log, permission pipeline and protocol because they form the harness's non-removable spine.

Build a config with `defaultAblation(overrides)` and pass `ablation` to `createHarness()` to stamp `ablationHash(ablation)` into `session_header.ablationHash` and `ablation.sandbox` into `env_stamp.sandbox`. Safety components fail safe when turned off: `credentialProxy: false` makes `credentialEnvOf()` return `{}` so tools receive no credentials, and `sandbox: "none"` throws `unsafe_sandbox_not_acknowledged` unless you pass `unsafe: true`.

By default every component runs:

| Flag | Default | When off (or changed) |
| --- | --- | --- |
| `context.write_cap` | `true` | Stores tool results uncapped without spilling. |
| `context.mask` | `true` | Leaves older tool results unmasked in the request view. |
| `context.summarize` | `true` | Skips between-turn summarization. |
| `context.mid_turn` | `true` | Skips mid-turn compaction. |
| `context.overflow_retry` | `true` | Skips overflow retry on the turn. |
| `mcp` | `true` | Omits MCP tools, turn boundaries and MCP-tier extension records. |
| `extensions.inProcess` | `true` | Omits in-process extension tools and extension records. |
| `extensions.mcp` | `true` | Omits MCP-tier extension tools, turn boundaries and extension records. |
| `extensions.skills` | `true` | Omits skills from the harness and skips `skill_loaded` entries. |
| `toolSearch` | `true` | Omits `tool_search` from active tools. |
| `credentialProxy` | `true` | Returns `{}` from `credentialEnvOf()` so tools receive no credentials. |
| `telemetry` | `true` | Drops events to harness and turn observers. |
| `completionCheck` | `true` | Skips post-turn `completion_check` entries. |
| `sandbox` | `"os"` | Sets `env_stamp.sandbox` to the chosen tier; `"none"` requires `unsafe: true`. |

## One portability suite tests all eight target seams

`@buildanagent/harness/testing` exports `portabilityConformanceCases()` and `runPortabilityConformance()` to verify all eight portable seams of a deployment target. The module also exports standalone runners for the seven harness seams, while `effectStore` reuses `effectStoreConformance()` from `@buildanagent/agent-safety/testing`:

| Target field | Seam | Standalone runner |
| --- | --- | --- |
| `store` | `SessionStore` | `runStoreConformance()` |
| `lock` | `SessionLock` | `runLockConformance()` |
| `scheduler` | `Scheduler` | `runSchedulerConformance()` |
| `keyStore` | `KeyStore` | `runKeyStoreConformance()` |
| `sandbox` | `SandboxClient` | `runSandboxConformance()` |
| `egress` | `EgressPolicy` | `runEgressConformance()` |
| `transport` | Protocol transport | `runTransportConformance()` |
| `effectStore` | `EffectStore` | `effectStoreConformance()` (`@buildanagent/agent-safety/testing`) |

`runEgressConformance()` checks `EGRESS_DENIED_TARGETS` so every backend refuses non-allowlisted hosts, loopback addresses (`127.0.0.1`, `[::1]`, `localhost`) and cloud metadata endpoints (`169.254.169.254`, `[fd00:ec2::254]`, `metadata.google.internal`, `100.100.100.200`). None of the suites import Node modules, so local Node, Cloudflare, AWS and Vercel targets run the same cases. Pass your target's seam factories to `runPortabilityConformance(target)` to verify a new backend.

## On Vercel, Postgres holds the log and the lock, and each wake is one Workflow run

A Vercel Function stops after its maximum duration and starts cold on another instance, so a run's state and its wakes must live outside the function. `@buildanagent/harness/vercel` supplies four of the eight portable seams for that host, and each passes the portability suite offline. `postgresStore()` keeps the session log in Postgres, and `postgresLock()` keeps one lease row per session. `workflowScheduler()` turns each wake into a Vercel Workflow run, and `envKeyStore()` reads the approval key ring from a secret environment variable. The entry imports no Postgres driver and no Workflow SDK code: you pass in a client with `query(text, values)` that resolves to `{ rows }`, such as `pg`'s `Pool` or Neon's serverless `Pool`, and the SDK's own functions. The sandbox and egress seams on Vercel belong to the Vercel Sandbox backend, which this entry leaves out.

Run `createPostgresHarnessTables(client)` once, or the statements in `POSTGRES_HARNESS_SCHEMA` as a migration, and build the seams over one client:

```ts
export async function vercelState(client: PgClientLike, env?: Readonly<Record<string, string | undefined>>) {
  await createPostgresHarnessTables(client);
  return {
    store: postgresStore(client),
    lock: postgresLock(client, { leaseMs: LEASE_MS }),
    ledger: postgresWakeLedger(client),
    keyStore: envKeyStore({ name: "HARNESS_KEY_RING", ...(env === undefined ? {} : { env }) }),
  };
}
```

### An append is one `INSERT`, and the primary key on `seq` is its compare-and-swap

`postgresStore(client)` writes each entry as one row of `harness_session_entries`, keyed by user, session and `seq`, with the entry kept as the JSON text it was written as. An append reads the log's tail and the stored entries that share an id with the batch, then applies the same rules as every store: idempotency by id, `expectedLastId`, the header first and the 64 KiB bound. It writes the new entries in one multi-row `INSERT`. Two writers that read the same tail both try to write the same `seq`, so Postgres refuses one `INSERT` whole with a unique violation. The losing append plans again from what is now stored. A stale `expectedLastId` then throws `ConflictError`, and an append with no expected tail lands at the next `seq`; after five lost races it gives up with `ConflictError`. Each statement runs on its own, so the store needs no transaction and works through a pooled client. A `load()` reads the entries present when it began, 256 rows a page (`pageSize`), and the store also offers `loadRaw()`. Postgres writes a row whole or not at all, so the torn-line cases of the suite skip.

### A lock is a lease row on the database's clock, with a fence that only grows

`postgresLock(client, { leaseMs, renewMs })` takes a session with one `INSERT … ON CONFLICT … DO UPDATE … WHERE` statement. It inserts the row, or takes over a row whose lease has lapsed, under Postgres's row lock, so of many writers that race for one session exactly one gets a handle. A lapsed lease is the only staleness rule, because no host can check another host's process. The holder renews every `renewMs` (default 10 seconds, or a third of the 30-second lease) through a `ProcessScheduler`, which suits a function that holds the lock for one step. A renewal that finds another writer's token, or a lease already lapsed, ends the hold. `release()` frees the row only while it still carries the hold's token, so a late release never frees the next writer's lock.

Clock skew cannot stretch a lease, for two reasons. First, the database's `clock_timestamp()` sets every lease's start and end, so writers on hosts whose clocks disagree still agree on when a lease lapses. Second, the holder times its own lease on a monotonic local clock from before it sent the statement, so `held()` turns `false` no later than the row's lease ends, whatever the network delay; it also turns `false` when renewals keep failing. Only a difference in how fast two clocks run can matter then, which is far smaller than any lease. Set `leaseMs` longer than the slowest step plus a renewal's round trip. Each handle is a `PostgresLockHandle` with a `fence`, a number that grows on every acquire of the session, because a released row keeps its count. Pass it to any resource that can refuse a lower number. The session log needs no fence: its expected-last-id check already refuses an append from a writer whose tail is out of date.

### A wake is a Workflow run that sleeps, and its turn runs in one step

`workflowScheduler({ ledger, start, resumeHook })` records each wake as a row of `harness_wakes` through `postgresWakeLedger(client)`, then starts one Workflow run with a `WakeRequest` of plain data: the id, the time and a hook token. The run's body is `runWakeWorkflow()` from `@buildanagent/harness/vercel/workflow`, which imports nothing, so the Workflow SDK's bundler can place it in a workflow bundle. It waits with the SDK's `sleep()` and races that sleep against a hook made with `createHook()`. When the time comes, it calls your step once, and the step calls `deliverWake()`. The turn therefore runs inside one step, and the engine records the step's result rather than replaying a model call: one step per `continueRun`, never the inner loop. Your app holds the workflow and the step:

```ts
export async function harnessWake(request: WakeRequest) {
  "use workflow";
  return runWakeWorkflow(request, { sleep, createHook, deliver: deliverHarnessWake });
}

export async function deliverHarnessWake(request: WakeRequest) {
  "use step";
  const { connect, onWake } = app;
  if (connect === undefined || onWake === undefined) throw new Error("set app.connect and app.onWake first");
  return deliverWake(request, { ledger: postgresWakeLedger(connect()), handler: onWake });
}
```

Give the harness `workflowScheduler()` with `start: (request) => start(harnessWake, [request])` and `resumeHook`, both from `workflow/api`; `examples/vercel-wake.ts` holds the whole file. The ledger makes `cancel(id)` exact across instances. `cancel()` removes the id's rows, so a run that wakes later finds no row and delivers nothing, and it resumes each run's hook so the run ends at once instead of sleeping on. A wake is at-least-once. A wake asked for twice may start two runs, and the second finds the token taken and ends without delivering. A handler that throws leaves the row in place, so the SDK's retry of the step delivers it again, and the handler must treat a second delivery as harmless. Because the turn runs in a step, its function's maximum duration bounds one turn, and a cold start costs a reload of the log from Postgres; nothing waits in memory.

### The key ring comes from a secret environment variable, and nothing shows its value

`envKeyStore({ name })` is `secretKeyStore()` over one variable, by default `HARNESS_KEY_RING`, read at every `load()`. It has no `rotate()` or `prune()`, so change the variable with `vercel env` and redeploy, keeping an old key in the ring until no waiting request names it. A function reads the value its deployment was built with. A missing or empty variable throws `invalid_key_store` with the variable's name; a value that is not a usable ring throws it with fixed text and no cause. The store keeps no copy of the value, so neither its `inspect()` output, its JSON nor any error it throws holds the key.

### The live run checks the adapters against your own Postgres, and only you start it

`pnpm --filter @buildanagent/harness live:vercel` runs the suite's store, lock, key store and effect store cases against a real database, then checks that a lease lapses on the database's clock and that the wake ledger round-trips. It runs only with `HARNESS_LIVE_VERCEL=1` and `DATABASE_URL` set, so CI and `pnpm test` never start it. Build first with `pnpm --filter "@buildanagent/harness..." build`, and use the database's unpooled connection string, because the run sets a `search_path` on each connection. It reads `DATABASE_URL` only to connect and never prints it. It works in a schema of its own, `harness_live_<random>`, which it drops at the end, and its key store case uses a ring it makes, not yours. The Workflow side needs a deployed app: deploy `examples/vercel-wake.ts`, ask for a wake a minute ahead, and check that `onWake` ran once.

## The triage capstone runs the SDK's support agent on the harness, and a second process answers its pause

`examples/triage-session.ts` runs the SDK's support-triage agent on the harness, with its tools in `examples/triage-tools.ts`. The registry holds two tools, `lookup_customer` and `escalate`, and no built-in tool, so each request offers those two and the output tool `submit_triage`. The pipeline allows the lookup and asks before an escalation. A deny rule added after the pause wins over an allow a person gave before it.

`triageHarness({ model, signer, registry, policy })` builds the harness. `startTriage(run, ticket)` runs the first turn, which ends `awaiting_approval` when the model asks to escalate. `answerTriage(run, answers)` resumes the turn from any process that can open the session and load the key ring. The customer travels as the turn's host context, so the lookup reads the signed-in customer and never the model's arguments.

The package's capstone test checks the rows of the harness plan's capstone table on a scripted model. It covers the approved, rejected and policy-changed cases, a byte-identical playback, a checkout and a long session that compacts once. It also scans every entry and span for planted secrets, and kills the process after the pager accepts a page to check that the resume reconciles to `applied`. The CLI's tests resolve the same pause from a second `buildanagent rpc` process. The recorded sessions and their model pairs are in `test/fixtures/capstone/`, for an offline replay suite.
