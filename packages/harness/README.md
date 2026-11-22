# @buildanagent/harness

The harness wraps the SDK's loop with what a coding agent needs around it: a session log, a context policy, tools, permissions, a sandbox and credentials. Only the sandbox interface is built so far, so nothing runs a turn from it yet.

As of November 2026 the package is private and not on npm. Each removable component gets its own subpath, so a caller imports only what it uses and an ablation can drop the rest. Every subpath except `./sandbox` and `./testing` is an empty stub that holds the component's place. The [harness plan](https://github.com/laudebugs/buildanagent/blob/main/docs/plans/build-harness.md) says what each package will hold and in which order.

## A sandbox says what it stops, and the host decides what it may touch

`./sandbox` defines `SandboxClient`, a backend that provisions a `Sandbox` for a workspace and a `SandboxPolicy`: the folders it may read and write, and the hosts it may reach. The policy is separate from the `ApprovalPolicy` that says when a denied action may be asked for again, and the model never changes either. A backend reports a `tier` and the `stops` it claims, and it claims a stop only when its tier and setup deliver it:

| Tier | Backend | Stops | What it is |
| --- | --- | --- | --- |
| `none` | `noneSandbox({ unsafe: true })` | nothing | A command runs as the user, with the machine's files and network. For a machine that is already disposable, and for tests of the rest of the harness |
| `os` | `srt`, coming | mistakes, and exfiltration with the proxy | An operating-system sandbox that shares the host's kernel |
| `container` | Docker, coming | mistakes and exfiltration, as far as its setup allows | A container with its capabilities dropped and no network by default |

`mistakes` are the agent's own errors, such as a write outside the workspace. `exfiltration` is sending data to a host that is not allowed. No backend claims to stop a `hostile_process`, because a sandbox that shares the host's kernel can't promise it. A backend that can't start throws `SandboxUnavailableError`, and the host must not run unconfined, so no backend falls back to `none`.

`noneSandbox()` needs `unsafe: true`: leaving it out is a type error, and a JavaScript caller gets a `HarnessError` with the code `unsafe_sandbox_not_acknowledged`. Each sandbox it provisions writes a warning to standard error, or to the `warn` option. It enforces no policy, which is what `stops: []` says.

```ts
import { noneSandbox, spawnEnv } from "@buildanagent/harness/sandbox";

const sandbox = await noneSandbox({ unsafe: true }).provision({ root: "/work/repo" }, policy);
const result = await sandbox.exec(["pnpm", "test"], { env: spawnEnv([]), signal: controller.signal, timeoutMs: 120_000 });
if ("denied" in result) console.log(result.denied.reason);
else console.log(result.exitCode, result.stdout);
```

`exec` takes an executable and its arguments, with no shell, and resolves with the exit code and output. A failing command is a result, not an error, and a command the policy refuses resolves with `{ denied }`. A command that runs past `timeoutMs` stops with exit code 124, one the system can't find gives 127, and one that a signal killed gives 128 plus the signal's number, with `signal` naming it. A working directory that isn't an existing folder is a `HarnessError`, not a 127. Output past `maxOutputBytes` (8 MiB for each stream by default) is dropped and the result says `truncated: true`. The `none` backend starts each command in its own process group, so a timeout, an abort or `dispose()` kills the command and everything it started, and `exec` settles even when a background process still holds the output pipes. A bad `timeoutMs` or `maxOutputBytes` is a `HarnessError`. An already aborted signal rejects before the command runs, and reading a missing file rejects with the code `sandbox_not_found`.

## Every spawned process gets a cleared environment

`spawnEnv(allow, extra)` builds the whole environment for a spawned process. It returns `PATH`, a fresh temp `HOME`, `TMPDIR` and `LANG`, the parent variables that `allow` names and the parent has, and `extra`. Nothing else is copied, so a key set in the parent never reaches a child. The caller removes the temp `HOME` when the process is done; an `extra.HOME` replaces it and no folder is made. `PATH` is the parent's with every entry that isn't absolute removed, so a `.` can't run a program from the working directory, and `TMPDIR` is the shared system temp directory, not a private one.

`allow` refuses a reserved name, a name that makes a program load code (`NODE_OPTIONS`, `LD_PRELOAD`) and a name that looks like a credential: one whose `_`-separated part is `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PAT`, `AUTH` and the like, or a connection string or proxy URL such as `DATABASE_URL` or `HTTPS_PROXY`, so `ANTHROPIC_API_KEY` is refused and `GIT_AUTHOR_NAME` isn't. The check goes by name and can't catch a credential under an unremarkable one, so name only variables you know. A credential can reach a child only as an explicit `extra`, written in code, such as a dummy key for the credential proxy. That keeps credentials out of the sandbox, as ADR 0036 requires. A name that isn't a valid variable name, or a value with a NUL character, throws a `HarnessError` with the code `invalid_spawn_env`.

## Test a sandbox with the fake and the conformance suite

`./testing` has `fakeSandbox()`, a sandbox in memory that enforces the policy it is given and records every `exec`, but runs no program: it understands `echo`, `env`, `cat`, `write`, `true`, `false`, `sleep` and `net-probe`. It claims tier `os`, because it enforces file roots and the network allowlist, and that says nothing about a real process.

`runSandboxConformance(factory)` pins the interface for every backend. Its cases check that a file reads back as written, that `exec` reports exit codes and output, that the environment holds only the variables given, that an aborted signal rejects and a timeout stops with 124, that an abort or timeout ends the command's whole process tree when the caller passes `processTree`, and that `dispose` ends the sandbox. A case that needs enforcement runs only when the backend's `stops` claim it: a write or read outside the roots, a path that climbs out with `..`, a symlink that points outside (the factory passes a `symlink` function), a working directory outside the workspace, and the network, where the caller passes two hosts it controls, such as two loopback listeners, so the allowed one must be reached and the blocked one must not. `none` passes the rest and skips those with a reason. The suite tells errors apart by `isHarnessError()` and the error's `code`, so a backend bundled separately from the suite still passes. A backend that can't start skips every case with its reason and fails none. `sandboxConformanceCases(factory)` returns the same cases one by one, for a runner that wants a test for each.
