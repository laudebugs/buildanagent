# Fact-check: the srt OS sandbox backend

This log checks the claims that `packages/harness/src/sandbox/srt/`, the harness README's srt section and todo N16's outcome make on 2026-11-22, against `@anthropic-ai/sandbox-runtime` 0.0.83 (its package, its README and its compiled source) and runs on this host (Ubuntu 24.04, bubblewrap and socat from apt, Node 22).

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N16-1 | Version 0.0.83 was published on 2026-11-13, so it meets the one-week age rule on 2026-11-22 | ✅ | `npm view @anthropic-ai/sandbox-runtime time`: 0.0.83 at 2026-11-13T02:30:40Z, the newest release; 0.0.82 at 2026-11-10 |
| N16-2 | The package is Apache-2.0 licensed | ✅ | Its `package.json` `license` field, and the `LICENSE` file in the package |
| N16-3 | The package calls itself a "Beta Research Preview" and says its APIs and configuration formats may evolve | ✅ | Its `README.md`, the note that opens the file: "As this is an early research preview, APIs and configuration formats may evolve" |
| N16-4 | On Linux `srt` uses bubblewrap, removes the sandboxed process's network namespace, and routes network traffic through proxies on the host | ✅ | Its `README.md`, "How It Works" and "Network Isolation"; a real run with no proxy variables could reach nothing, and the proxy answered 403 for a host that was not allowed |
| N16-5 | `allowRead` takes precedence over `denyRead`, so denying `/` and allowing folders back is a valid policy | ✅ | Its `README.md`, "Filesystem Isolation", and `FilesystemConfigSchema` in `sandbox-config.js`; the conformance run passes with `denyRead: ["/"]` |
| N16-6 | A path entry marked `literal: true` is never read as a pattern | ✅ | `filesystemPathEntrySchema` in `sandbox-config.d.ts`: a spelling is a pattern when it reads as one, and `{ path, literal: true }` never is |
| N16-7 | `srt` needs its seccomp helper readable inside the sandbox, and creates its proxy sockets in `os.tmpdir()` | ✅ | A first run with `denyRead: ["/"]` failed with `apply-seccomp: No such file or directory` until the package's `vendor` folder was allowed; `linux-sandbox-utils.js` builds the socket paths with `join(tmpdir(), "claude-http-…")`, and a run with `TMPDIR` set put the sockets there |
| N16-8 | `srt` adds proxy variables to a command's environment, listed in `SRT_ADDED_ENVIRONMENT` | ✅ | A run of `env` inside the sandbox with one given variable printed those 26 names besides it and `PWD`, `SHLVL` and `_`, and the conformance environment case passes with exactly that list |
| N16-9 | `srt` makes empty protected files in the workspace (`.bashrc`, `.claude` and more) and removes them when it exits; a `SIGKILL` leaves them, and a `SIGTERM` does not | ✅ | `--debug` output ("Cleaned up bwrap mount point"); a run killed with `SIGKILL` left twelve such files in the workspace; the abort test, which stops a command with `SIGTERM` first, finds none |
| N16-10 | Ending `srt`'s process group ends the sandboxed process tree | ✅ | A command's background `sleep` was gone within a second of a `SIGKILL` and of a `SIGTERM` to the group, checked against `/proc`; the conformance process-tree case and the abort test pass |
| N16-11 | A process inside the sandbox has its own process-id namespace, so the id it writes is not the host's | ✅ | A command wrote `$!` as 3 while the host's `sleep` had another id; the tests find the process by its command line instead |
| N16-12 | Two `srt` processes at once in one workspace can disturb each other | ⚠️ | Our inference from a flaky run: a file call through `srt` made while a command started sometimes left that command without output, and the fault went away with the file calls in the host. A run of six commands started together never failed, so the claim stays a caution in the README |
| N16-13 | Without `bwrap`, `socat`, a binary or a working `srt`, `provision()` throws `SandboxUnavailableError` and runs nothing | ✅ | The unavailable tests: a missing binary, a `PATH` without `bwrap`, and a fake `srt` that fails each throw it, and the private folder is removed each time |
| N16-14 | The sandbox can't read the host's home or reach the host's loopback network, and a symlink that the command makes can't carry a write out | ✅ | The escape tests against the real `srt`; weakening the write list or the read denial made three of them fail |

**Totals:** 14 claims: 13 ✅, 0 ✏️, 1 ⚠️.
