# @buildanagent/harness

The harness wraps the SDK's loop with what a coding agent needs around it: a session log that survives a crash, a context policy, tools, permissions, a sandbox and credentials kept out of it. Use it to run an agent whose every turn is recorded and can be resumed, checked and replayed.

As of November 2026 the package is private and not on npm. Each removable component has its own subpath, so you import only what you use and an ablation can drop the rest. `session`, `context`, `tools`, `permissions`, `sandbox`, `credentials`, `extensions`, `server` and `testing` are built. `mcp`, `memory`, `telemetry` and `ablation` are empty stubs that hold their place until their components arrive.

## The session log holds twenty entry types

`@buildanagent/harness/session` re-exports the entry union from `@buildanagent/protocol`, where the [stable fields and the JSON Schema](https://github.com/laudebugs/buildanagent/blob/main/packages/protocol/README.md#a-session-file-is-a-list-of-entries-one-per-line) are documented. Every entry carries `id`, `parentId`, `seq`, `timestamp`, `type` and `origin`. The [session format page](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/docs/session-format.md) lists every field of every type and says which are stable, and a test checks it against the JSON Schema. The types, in the order of the union:

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

The package's opt-in sandbox tests run the conformance suite and the escape cases against the real `srt`, and they fail on a skipped case instead of skipping. They are opt-in because they start bubblewrap. Without `srt`, the other tests check the settings and the unavailable paths.

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

The same opt-in tests run the conformance suite and the lock-down cases against a real daemon, with a pinned Node image, and fail on a skipped case. Without Docker, the other tests check the flags and the unavailable paths with a fake client.

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

The package's tests run the proxy against a real HTTPS server on loopback, with a self-signed certificate that only the test trusts and a table in place of DNS.

## Every spawned process gets a cleared environment

`spawnEnv(allow, extra)` builds the whole environment for a spawned process. It returns `PATH`, a fresh temp `HOME`, `TMPDIR` and `LANG`, the parent variables that `allow` names and the parent has, and `extra`. Nothing else is copied, so a key set in the parent never reaches a child. The caller removes the temp `HOME` when the process is done; an `extra.HOME` replaces it and no folder is made. `PATH` is the parent's with every entry that isn't absolute removed, so a `.` can't run a program from the working directory, and `TMPDIR` is the shared system temp directory, not a private one.

A name that isn't a valid variable name, or a value with a NUL character, throws a `HarnessError` with the code `invalid_spawn_env`. `allow` also refuses three kinds of name:

- a reserved name, which is always set already;
- a name that makes a program load code, such as `NODE_OPTIONS` or `LD_PRELOAD`;
- a name that looks like a credential: one with a `_`-separated part such as `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PAT` or `AUTH`, or a connection string or proxy URL such as `DATABASE_URL` or `HTTPS_PROXY`. So `ANTHROPIC_API_KEY` is refused and `GIT_AUTHOR_NAME` isn't.

The check goes by name and can't catch a credential under an unremarkable one, so name only variables you know. A credential can reach a child only as an explicit `extra`, written in code, such as a dummy key for the credential proxy. That keeps credentials out of the sandbox.

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

The package sets no default period, and `days` must be a positive number or the call throws `invalid_retention`. The [session format page](docs/session-format.md#nothing-expires-unless-you-set-a-retention-period) says where the archive is, and it has the [disk-cost projection](docs/session-format.md#what-a-month-of-sessions-costs-on-disk).

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

`stdioTransport(dispatcher, { input, output, log }, { maxLineBytes, signal })` connects one client and resolves when that client is done. `input` is a Node `Readable` such as `process.stdin` or a Web `ReadableStream`, and `output` is a Node `Writable` such as `process.stdout` or a Web `WritableStream`. `log` takes the transport's own diagnostics, one line each, and a host points it at stderr, because `output` carries protocol lines only. A diagnostic never quotes what the client sent. The file imports no Node module, so the same function can serve a Worker's streams. The [protocol README](https://github.com/laudebugs/buildanagent/blob/main/packages/protocol/README.md#over-stdio-each-message-is-one-line-and-stdout-carries-nothing-else) gives the wire rules: one message per line, an error for each bad line, and commands that may be answered out of order.

- **Backpressure.** The transport writes a message, and when `output` reports itself full, the connection's queue waits for `drain` before it hands over the next one. A client that stops reading therefore keeps the server's backlog near the stream's own buffer, and the dispatcher drops live events past `queueSize` instead of holding them. While `output` is full, every write shares one wait for room, so a long session adds no listener to the stream.
- **Bad lines.** The transport answers a line it can't read itself, outside the connection's queue. An answer the output takes at once costs nothing, so a client that reads can send any number of bad lines. Once 128 answers wait on a full output, the client is sending without reading, and the transport stops. A malformed response, one that carries `result` or `error`, is only logged, because JSON-RPC never answers a response; the server's request it meant to answer still waits for a good one.
- **A message JSON can't carry.** When `encode()` refuses a message the server built, such as a tool call whose input holds a `bigint`, the transport logs it. A response goes out as `InternalError`. A server request is answered back into the connection with `InternalError`, as if the client had failed it, so a tool call ends with an error result instead of waiting. A notification is dropped.
- **Shutdown.** When `input` ends, the transport waits until every command it read has its response queued and every line is written, then closes the connection and resolves. An `input` that fails is logged and handled as an end. The transport resolves at once, closing the connection and logging why, when `output` fails or closes, when the dispatcher closes the connection (as it does past 128 unread refusals, which `connect()`'s `onClose` option reports), or when `signal` aborts. A client that closes its input and never reads leaves the transport waiting on the write, so a host that needs a deadline aborts `signal`.
- **The streams stay the host's.** The transport never ends, closes, destroys or cancels either stream. When it resolves, it has removed every listener it added, paused a Node `input` and released a Web stream's lock, so the host can go on using both and decides when its process exits.
- **What the transport does not check.** It checks each message's envelope with `decode()`, and the dispatcher reads the params of a command without checking them against the protocol schema, so a command with malformed params is answered with `InternalError`. The transport also authenticates nobody: whoever holds the two streams acts as the dispatcher's user.

A test in `test/server/stdio.test.ts` runs the server in a child process spawned with `spawnEnv([])`, and `test/server/stdio-transport.test.ts` drives the transport in process over streams it holds, for the stops, the bounds and the streams left behind. The child-process test checks that a client completes a turn, that stdout holds only protocol lines, that the end of stdin still gets every answer, and that a client that stops reading leaves at most 256 KiB waiting while 25,000 events stream. It also sets a variable in the parent and checks that the child's environment holds only `PATH`, `HOME`, `TMPDIR` and `LANG`.

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

The cap counts the bytes the entry takes in the log: JSON escaping, the result's details and other blocks, and 1 KiB for the entry's own fields. A capped entry therefore always fits the stores' 64 KiB entry bound. The default `writeCapBytes` of 65,536 leaves the model a little under 64 KiB of plain text, and less of a text full of newlines or quotes. `fileSpillStore({ dir })` from `@buildanagent/harness/context/file` writes one file per capped result, and `memorySpillStore()` serves tests. A file is named by the run id, a count within the run and the call id, because a provider may reuse a call id. A policy with the layer on and no `spill` throws `invalid_context_options`.

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

A project can supply its own extensions, and trust decides whether they load. `@buildanagent/harness/extensions/node` loads them from `.agents/extensions/<folder>/`, each with an `index.mjs` or `index.js` whose default export is an `Extension`, or a function returning one. When a project has extensions, `loadProjectExtensions(root, { trust, headless })` loads none of them and returns a notice saying why if the run is headless or the project is not in the `TrustStore`. A headless run loads a trusted project's extensions only with `loadInHeadless: true`. `fileTrustStore(path)` keeps trusted folders in a 0600 JSON file. `memoryTrustStore()` serves tests and hosts that decide trust themselves; it compares the paths it is given, so a host passes the same real paths the loader does. The result of a load holds the `extensions`, the `records` for `extensionRecords` and the `notices`.

Pins keep a trusted project from changing under you. `pinProjectExtensions(root)` writes `.agents/extensions.lock.json`, one SHA-256 per extension folder. The hash covers every file in the folder, in sorted order, each by its path and its own digest. Once a lock file exists, the loader refuses a folder whose hash differs, or that the file does not list, or that the file lists and the project no longer holds, with `extension_hash_mismatch`, and none of the project's extensions load. With no lock file they load and a notice says they are unpinned.

The loader hashes and checks every folder before it imports any, so a refusal runs none of the project's code. Node caches modules for the life of a process, so a folder that changed after the process imported it is refused until the process restarts. An extension folder may not hold a symlink.

Two limits remain. The pin covers the files inside each folder and nothing an extension imports from outside it, such as a relative path that leaves the folder or a package from the project's `node_modules`. And the lock file sits inside the project it pins, so anyone who can edit the project can pin their own changes: the pin catches a change nobody meant, not an attacker who holds the project. Pin a project only after you have read its extensions.

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
- **Quorum policy.** A `QuorumPolicy` has one method, `evaluate(request, resolutions)`, that returns `met`, `pending`, `rejected` or `expired`. `oneResolution` is the default and follows the latest answer. `quorumOf(n)` needs `n` distinct approvers named in `Resolution.by`, counts only allows, and refuses an `n` that is not a whole number of at least one. `met` runs the call, `rejected` and `expired` turn it into a denial result, and `pending` leaves it waiting: the turn ends `awaiting_approval` again. Calling `resolve(session, [])` asks the policy about every waiting request, which is how a policy that keeps its own clock expires an old one.
- **What the log keeps.** A denial by the policy, not a person, is written with `by: "policy"`. A pending answer is marked `quorum: "pending"` so that crash detection does not read it as an answer a run received.
- **Requester.** `requesterId` names who asked, and an approver equal to it throws `approver_is_requester`. The host authenticates approvers and fills `Resolution.by`; the harness trusts what it is given.

### The key ring is a 0600 file outside the log and the sandbox

`fileKeyStore(path?)` from `@buildanagent/harness/session/jsonl` is a `KeyStore` over one file, by default `$XDG_STATE_HOME/buildanagent/keys.json` (or `~/.local/state/buildanagent/keys.json`). `load()` creates a ring with one random 256-bit key when the file is missing, in a folder of mode `0700`, and refuses a file that group or others can read, that belongs to another user, or that is a symbolic link. Pass the loaded ring to `hmacSigner()` and give the signer to `createHarness({ signer })`; the SDK reads the key by the id a request names, so a request signed with an older key still verifies. `rotate()` adds a new current key, and `prune(inUse)` removes every key not in `inUse` except the current one, so pass the `keyId` of every request that still waits. `rotate()` and `prune()` take a lock file beside the ring, so two processes that change it together keep both changes. A tool or sandbox sees none of this: the ring is in the host's files, and a spawned process gets [a cleared environment](#every-spawned-process-gets-a-cleared-environment).

### A read-only secret can hold the key ring instead

On a serverless host the harness can read its key but not write it, so `secretKeyStore({ read })` from `@buildanagent/harness/session` is a `KeyStore` with `load()` only. `read()` returns the secret's text, the JSON ring that `parseKeyRing()` reads, such as `{"current":"2026-11","keys":{"2026-11":"<key>"}}` with each key at least 32 random bytes in unpadded base64url. `load()` calls `read()` every time and keeps no copy, so a ring the platform rotated takes effect at the next load. `load()` throws `invalid_key_store` for a `read()` that fails or returns a non-string, and for a ring that is not JSON, holds a key that is not base64url or is shorter than 32 bytes, or names a `current` it lacks. The error's message is fixed text and the error has no cause, so it never holds the secret's text, a key id, a key or the error `read()` threw. To find which rule a ring breaks, check the secret itself. The store imports no Node module, so a Cloudflare, AWS or Vercel adapter only has to supply `read` (N46a, N47a and N48a build those).

The owner rotates such a ring with the platform's own tooling: add a new key and make it current, then remove an old key once no waiting request names it. `rotateKeys(store)` and `pruneKeys(store, inUse)` call a store's `rotate()` and `prune()` when it has them. On a store without them they reject with `key_store_read_only`, whose message names the platform's secret tooling (by default "such as wrangler secret put, aws secretsmanager put-secret-value or vercel env"; pass `platformHint` for your own text). 
`keyStoreConformanceCases(factory)` and `runKeyStoreConformance(factory)` in `@buildanagent/harness/testing` check a store with five cases. `load()` returns a usable ring, returns the same ring twice, and gives a ring that signs and verifies through `hmacSigner()`. `rotate()` keeps the old key loadable, and `prune()` keeps the current and in-use keys and returns the ids it removed. The rotate and prune cases skip with a reason when a store leaves the methods out. Run `runKeyStoreConformance(factory)` against any store you write.

