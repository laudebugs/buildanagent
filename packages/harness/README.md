# @buildanagent/harness

The harness wraps the SDK's loop with what a coding agent needs around it: a session log, a context policy, tools, permissions, a sandbox and credentials. No loop runs from it yet.

As of November 2026 the package is private and not on npm. Each removable component gets its own subpath, so a caller imports only what it uses and an ablation can drop the rest. Today `session` holds the entry types it re-exports from the protocol package, `sandbox` and `testing` hold the sandbox interface, and `tools` holds the tool registry, so every other subpath is an empty stub that holds the component's place. The [harness plan](https://github.com/laudebugs/buildanagent/blob/main/docs/plans/build-harness.md) says what each package will hold and in which order.

## The session log holds eighteen entry types

`@buildanagent/harness/session` re-exports the entry union from `@buildanagent/protocol`, where the [stable fields and the JSON Schema](../protocol/README.md#a-session-file-is-a-list-of-entries-one-per-line) are documented. Every entry carries `id`, `parentId`, `seq`, `timestamp`, `type` and `origin`. The types, in the order of the union:

- `session_header`: the first entry of a file, with the format, harness and SDK versions, the defaults hash, the capabilities, the ablation hash and, optionally, the parent session and the product.
- `turn_start`: a run began, with the frozen system prompt.
- `message_block` and `message_end`: one content block of a message, and the close of the message with its model and stop reason.
- `tool_result`: what a tool returned, with whether its output is trusted.
- `permission_decision`: the permission pipeline's verdict on one call.
- `usage`: the tokens and cost of a model call, a summary or a judge call.
- `turn_end`: a run ended, with its stop reason and step count.
- `checkout`: HEAD moved to another entry.
- `compaction`: a summary replaced older entries in the context.
- `env_stamp` and `loadout`: the environment a session ran in, and a change of tools or model.
- `completion_check`: the commands that checked a finished task, and whether they passed.
- `skill_loaded` and `extension_loaded`: a skill or an extension entered the session.
- `subagent_link`: a child session exists, and which call or step started it.
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

```ts
import { noneSandbox, spawnEnv } from "@buildanagent/harness/sandbox";

const sandbox = await noneSandbox({ unsafe: true }).provision({ root: "/work/repo" }, policy);
const result = await sandbox.exec(["pnpm", "test"], { env: spawnEnv([]), signal: controller.signal, timeoutMs: 120_000 });
if ("denied" in result) console.log(result.denied.reason);
else console.log(result.exitCode, result.stdout);
```

`exec` takes an executable and its arguments, with no shell, and resolves with the exit code and output. A failing command is a result, not an error, and a command the policy refuses resolves with `{ denied }`. A command that runs past `timeoutMs` stops with exit code 124, and one the system can't find gives 127. A command that a signal killed gives 128 plus the signal's number, with `signal` naming it. Output past `maxOutputBytes` (8 MiB for each stream by default) is dropped, and the result says `truncated: true`.

The `none` backend starts each command in its own process group. A timeout, an abort or `dispose()` therefore kills the command and everything it started, and `exec` settles even when a background process still holds the output pipes.

Bad input is an error, not a result. A working directory that isn't an existing folder, a bad `timeoutMs` or a bad `maxOutputBytes` throws a `HarnessError`. An already aborted signal rejects before the command runs, and reading a missing file rejects with the code `sandbox_not_found`.

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

`pnpm --filter @buildanagent/harness test:sandbox` runs the conformance suite and the escape cases against the real `srt`. It is opt-in because it starts bubblewrap, and it fails on a skipped case instead of skipping. Without `srt`, the rest of `pnpm test` checks the settings and the unavailable paths.

## The Docker backend runs each command in a locked-down container

`dockerSandbox({ image })` from `./sandbox/docker` runs each command in its own container, made from an image that is already on the Docker host: `provision()` never pulls, and you should pin the image by digest. The container has all capabilities dropped, a read-only root file system, no network, no new privileges and no shared IPC.

The container also has a limit on processes (`pidsLimit`, 256 by default), CPUs (`cpus`, 1) and memory with no swap (`memoryMb`, 1024). It runs as your user and group, so the files it writes stay yours, and its only other writable place is a 64 MiB `/tmp` in memory.

The policy decides what is mounted, at the same path inside as outside. A write root is mounted writable, and it must exist. A read root and an `extraReadRoots` folder are mounted read-only. A `denyWrite` folder inside a write root is made if it is missing and mounted read-only on top, so the session log stays out of the agent's reach. A `denyWrite` path outside every write root is not mounted at all. The protected files that `srt` also guards, such as `.bashrc`, `.claude`, `.git/hooks` and `.git/config` at the top of a write root, are mounted read-only when they exist, and `writeFile` refuses them. Nothing else is mounted, so a path outside the roots does not exist in the container.

The workspace must lie inside a root. The backend never mounts the Docker socket: a root that resolves to `/`, or that holds the daemon's socket (`/var/run/docker.sock`, `/run/docker.sock` or the one `dockerHost` names), is refused.

The container has no network, so a command reaches a host only through `proxySocket`: a Unix socket on the host, mounted at `DOCKER_PROXY_SOCKET_PATH` (`/run/harness/proxy.sock`), that the credential proxy listens on. The program in the image has to speak to that socket itself. Without `proxySocket`, no host is reachable, including the ones the policy allows.

`provision()` starts the `docker` client with a clean environment: a `PATH`, a private empty `HOME`, and `DOCKER_HOST` when the option or the host sets one. It never copies the host's environment. A missing client, a daemon that doesn't answer or an image that isn't on the host throws `SandboxUnavailableError` and runs nothing.

A command's environment is exactly the one it was given. `env -i` clears the image's own variables, so the image needs an `env` that takes `-i` and `--`, as BusyBox and GNU coreutils do. It also clears `PATH`, and a program name is then looked up on the C library's default path, which differs between images. Pass a `PATH`, as `spawnEnv()` does, for a program that lives elsewhere, such as `/usr/local/bin/node` in a Debian image. A command whose first word contains `=` resolves with exit code 127, as under `none`.

Each command is created and then started. A timeout, an abort or `dispose()` kills the container by name, so nothing outlives the call, and `dispose()` also removes any container of this sandbox that a stopped client left behind.

Five limits are worth knowing:

- **Shared kernel.** A container shares the host's kernel, so a process that is trying to escape is out of scope, and no `hostile_process` stop is claimed.
- **Protected files made later.** A protected file that is missing when `provision()` runs, or one in a subfolder, is not protected inside the container, because a mount needs a file to cover. An agent could write `.git/hooks/pre-commit` there, and the host's next `git commit` would run it. Keep `.git/hooks` and `.git/config` in place, or list them in `denyWrite`.
- **Linux and a rootful daemon.** Only Linux was tested, against a rootful daemon. Rootless Docker mounts differently and was not tested.
- **File calls run in the host.** `readFile` and `writeFile` check each path by its real path and through `/proc`, as under `srt`, and `writeFile` refuses a `denyWrite` folder. A hostile process could still win that race.
- **The network lock rests on the daemon.** `--network none` is checked by inspecting the running container, because a test host with no bridge can't tell a closed network from a missing one.

`pnpm --filter @buildanagent/harness test:sandbox` runs the conformance suite and the lock-down cases against a real daemon, with a pinned Node image. It is opt-in, and it fails on a skipped case instead of skipping. Without Docker, the rest of `pnpm test` checks the flags and the unavailable paths with a fake client.

## The egress proxy keeps every credential outside the sandbox

`startEgressProxy({ allow, routes, log })` from `./credentials` starts a proxy on `127.0.0.1`, or on a Unix socket you give it (`socketPath`, which is what `dockerSandbox`'s `proxySocket` mounts). Nothing leaves the sandbox except through it. It refuses everything that isn't on its allowlist with a 403, and it writes one log record for each request: the host, the method, the status and the bytes, never a header or a body. Give the sandbox `proxy.url` as `HTTPS_PROXY`. On a Unix socket, `proxy.url` is `unix:<path>`, which is not a proxy URL, and the program inside the container connects to the socket itself.

A tunnel (`CONNECT`) goes only to an allowlisted name on an allowlisted port, which is 443 unless the entry says `:port`. An entry is a name, or `*.name` for every name under it. The proxy resolves the name itself, checks every address it gets, and refuses the whole request if any one is not public: loopback, link-local (which holds the cloud metadata address 169.254.169.254), private, shared, multicast and reserved ranges, for IPv4 and IPv6, and IPv6 addresses that wrap one of them. The refused ranges include the IANA special-purpose ones and the deprecated site-local and IPv4-translated forms.

The proxy then connects to the address it checked, so a name that answers differently a moment later can't redirect the connection. An address literal as a target, an HTTP proxy request in absolute form and a malformed target are refused without a lookup.

A tool that needs a credential uses a route. `routes` lists, for each one, a name, an HTTPS host, the methods it accepts, the header that carries the credential and a function that returns the real secret. The sandbox sends `http://127.0.0.1:<port>/<route>/path` and puts `proxy.sentinels[route]`, a random placeholder, where the credential goes, such as `Authorization: Bearer <sentinel>`. The proxy checks the route, the method and the sentinel, replaces the sentinel with the secret and forwards the request over HTTPS to the route's host, with the same address check.

The secret is read for each request, so a rotated key is used at once, and it never enters the sandbox's environment, a log record or a response from the proxy.

`proxy.fetch(input, init)` is for tools that run in the harness's own process, which a network sandbox doesn't confine. It applies the same allowlist, address check and pinned connection, and it rejects with `egress_denied` for a host that isn't allowed. It uses HTTPS only and doesn't follow redirects, so each hop is a new call that the allowlist checks. A URL under `proxy.url`, or under `http://egress.proxy`, which also works on a Unix socket, is a route request with the same injection. An aborted signal rejects with its reason.

`scrubSecrets(entry, secrets)` returns a copy of a session entry with each secret replaced by `[REDACTED]`, in every string and key at any depth, and also when the secret was percent-encoded, JSON-escaped or turned into base64, alone or inside a longer value such as a Basic authorization header. An entry's `type`, `id`, `parentId`, `seq`, `timestamp`, `origin` and `formatVersion` are never rewritten. Apply it before every append, with `await proxy.knownSecrets()` and the tokens and session URLs of any hosted-browser, CDP or OAuth connector tool, because the scrubber can only remove a secret it is told about.

Four limits are worth knowing:

- **An allowed credential can still act.** The sandbox holds a placeholder, not the secret, but it can ask the proxy to use the real one on that host and those methods. Scope each route to the host and methods the task needs.
- **A service that echoes the credential back reveals it.** The proxy doesn't read responses, so a route to a service that returns the request's headers hands the secret to the sandbox. Scrub the entry, and don't route to such a service.
- **No TLS inspection.** A tunnel is an opaque stream: the proxy knows the name, not what the tool sends. Only a route can add a credential, and only a route sees the request.
- **Local processes can reach it.** The proxy listens on loopback, so any process on the host can use its allowed tunnels. Only a process that knows a sentinel can use a route, and sentinels are random for each proxy. A Unix socket narrows access to the socket's file permissions.

`pnpm test` runs the proxy against a real HTTPS server on loopback with a self-signed certificate that only the test trusts, and a table in place of DNS.

## Every spawned process gets a cleared environment

`spawnEnv(allow, extra)` builds the whole environment for a spawned process. It returns `PATH`, a fresh temp `HOME`, `TMPDIR` and `LANG`, the parent variables that `allow` names and the parent has, and `extra`. Nothing else is copied, so a key set in the parent never reaches a child. The caller removes the temp `HOME` when the process is done; an `extra.HOME` replaces it and no folder is made. `PATH` is the parent's with every entry that isn't absolute removed, so a `.` can't run a program from the working directory, and `TMPDIR` is the shared system temp directory, not a private one.

A name that isn't a valid variable name, or a value with a NUL character, throws a `HarnessError` with the code `invalid_spawn_env`. `allow` also refuses three kinds of name:

- a reserved name, which is always set already;
- a name that makes a program load code, such as `NODE_OPTIONS` or `LD_PRELOAD`;
- a name that looks like a credential: one with a `_`-separated part such as `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PAT` or `AUTH`, or a connection string or proxy URL such as `DATABASE_URL` or `HTTPS_PROXY`. So `ANTHROPIC_API_KEY` is refused and `GIT_AUTHOR_NAME` isn't.

The check goes by name and can't catch a credential under an unremarkable one, so name only variables you know. A credential can reach a child only as an explicit `extra`, written in code, such as a dummy key for the credential proxy. That keeps credentials out of the sandbox, as ADR 0036 requires.

## Test a sandbox with the fake and the conformance suite

`./testing` has `fakeSandbox()`, a sandbox in memory that enforces the policy it is given and records every `exec`, but runs no program: it understands `echo`, `env`, `cat`, `write`, `true`, `false`, `sleep` and `net-probe`. It claims tier `os`, because it enforces file roots and the network allowlist, but it confines no real process.

`runSandboxConformance(factory)` pins the interface for every backend. Its cases check that a file reads back as written, that `exec` reports exit codes and output, that the environment holds only the variables given, that an aborted signal rejects and a timeout stops with 124, and that `dispose` ends the sandbox and any command still running. When the caller passes `processTree`, a case also checks that an abort or timeout ends the command's whole process tree. A backend that adds variables of its own, such as proxy settings, lists them in `addedEnvironment`, and the environment case accepts those and no others.

A case that needs enforcement runs only when the backend's `stops` claim it:

- a write or read outside the roots, and a path that climbs out with `..`;
- a symlink that points outside, where the factory passes a `symlink` function;
- a working directory outside the workspace;
- the network, where the caller passes two hosts it controls, such as two loopback listeners: the allowed one must be reached and the blocked one must not.

`none` passes the rest and skips those with a reason, and a backend that can't start skips every case with its reason and fails none. The suite tells errors apart by `isHarnessError()` and the error's `code`, so a backend bundled separately from the suite still passes. `sandboxConformanceCases(factory)` returns the same cases one by one, for a runner that wants a test for each.

## One registry names, defers and wraps every tool

`@buildanagent/harness/tools` holds the tools of every source in one registry, so permission rules, tool search and the session log read one description of each. `createToolRegistry()` returns it, and `register()` adds a tool with its source: `builtin`, `extension`, `client` or `mcp:<server>`.

- **Names.** A tool's canonical name is checked once, at registration, against the SDK's rule of 1 to 64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`. An MCP tool is namespaced as `mcp__<server>__<tool>`. A second tool with a name already taken throws a `DuplicateToolError`, and an extension replaces a built-in only with `override: true`.
- **Hashes.** An MCP tool whose server or tool name needs cleaning, holds a double underscore, starts or ends with an underscore, or makes the name run past 64 characters gets `_` and an eight-digit hash of its source and name. A name therefore depends on its tool alone and never on what was registered before it.
- **Aliases.** A native or display alias stays apart from the canonical name. No alias may equal another tool's name or alias, in either order of registration, so a rule that matches either matches one tool.
- **Exposure.** Every source has an exposure that the registry writes to each tool's `exposure`: `deferred` for MCP tools and `direct` for the rest. `setExposure(source, exposure)` changes it for a source, now and for tools registered later. A run keeps the exposure `definitions()` gave its tools, so call `definitions()` again for the next run. `definitions()` returns the tools in registration order and keeps it, so the cached prefix does not move when a tool activates.
- **Tool search.** `toolSearchTool(registry, { activated })` is a `tool_search` tool, and `activated` is required. It matches a query against the `deferred` tools' names and descriptions, records the best matches in `activated` and names them to the model. `toolSearchInterceptors(registry, activated)` sends the run's tools, including any from outside the registry, plus the activated ones. A deferred tool is therefore absent from each request until the model asks for it, and present in the next. The search ignores common words such as `the` and `for`, counts a repeated word once, and takes a `maxResults` of 1 or more. A `hidden` tool is never found, and `tool_search` itself is always sent, so a source set to `deferred` cannot leave the model with no way to find a tool. Register `tool_search` in the registry, because the interceptor sends it by that name and throws when the registry lacks it. Pass the same set to the tool and the interceptor, and a new one to each run.
- **Host context.** `definitions(wrap, hostContext)` runs each tool through `wrap`, which can bind a write cap, shadow mode, a sandbox or the turn's host context. The registry sets the result's name and exposure, so a wrapper cannot rename or expose a tool. The host context reaches `execute` by the wrapper's closure, never through a schema, so it is in no request, event or saved context.
- **Output trust.** A tool's `outputTrust` is `untrusted` for an MCP tool and for a tool registered with `remoteAgent: true`, `trusted` otherwise, and the value a registration declares wins. `approvalReuse` defaults to `both`, and `pattern` records whether the tool runs `in_process` or by a `client_request`.
- **Preamble size.** `preambleTokens({ system })` estimates the tokens a request carries before any message: the system prompt and every `direct` tool. A `deferred` tool adds nothing, which is why the default for MCP is `deferred`. A `RegisteredTool` that `register()` returns is a snapshot, so call `get()` after `setExposure()` to read the current exposure.

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
- **The crash test.** `test/session/lock-crash.test.ts` spawns a child that takes the lock and appends in a loop, kills it with `SIGKILL`, and requires a new writer to get the lock within one lease and every complete entry to load.

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

Call `runTurn()` once at a time per `Session`: its writes stay in order within one call, but two concurrent calls on one `Session` can interleave their entries. A turn may set `system`, `output`, `model`, `maxSteps`, `turnRetries`, `modelOptions`, `budgetUsd`, `signal`, `tools` and `hostContext`. `tools` is an allowlist of registered names, and an unknown name throws `invalid_turn_options`. `hostContext` reaches a tool as `ctx.app` and reaches no entry. `onRun` hands the caller the run, so it can `steer()` or `followUp()` it.
