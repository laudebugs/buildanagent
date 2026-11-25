# Fact-check: the E2B sandbox backend

This log checks the claims that `packages/harness/src/sandbox/e2b/`, the fake in `packages/harness/test/sandbox/fake-e2b.ts`, the harness README's E2B section and todo N47b's outcome make about E2B, on 2026-11-25. The sources are the pinned `e2b` 2.63.0 package (`dist/index.d.ts` and `dist/index.mjs` in `node_modules`), npm's registry, and E2B's documentation, fetched with curl on 2026-11-25 as Markdown from `docs.e2b.dev/<page>.md`. The rows first logged as ⚠️ for want of a source were rechecked against E2B's commands, background-commands, sandbox and template pages on 2026-11-25 (rows N47b-29, N47b-30 and N47b-36 to N47b-38). No E2B account was used, so nothing here was observed on a real sandbox; the opt-in live run (`test/live/e2b-live.ts`) checks the ⚠️ rows that a real sandbox can settle.

Legend: ✅ confirmed · ✏️ corrected while drafting · ⚠️ unverified or our own inference.

## The pin

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N47b-1 | `e2b` 2.63.0 was published on 2026-11-04 and 2.64.0 on 2026-11-13, so both were more than a week old on 2026-11-25; the todo names 2.63.0, which is pinned | ✅ | `npm view e2b time`; [todo N47b](../../todos/done/N47b-e2b-sandbox-backend.md) scope. The portable agents report chose 2.63.0 because 2.64.0 was under a week old on 2026-11-18 |
| N47b-2 | `e2b` 2.63.0 is MIT-licensed and needs Node 22.19.0 or later, the same floor as the harness | ✅ | `npm view e2b@2.63.0 license engines`; `packages/harness/package.json` `engines` |
| N47b-3 | Every package pnpm added with `e2b` was at least a week old; the newest, `minimatch` 11.0.9, was published on 2026-11-16 | ✅ | `npm view <name> time` for each new lockfile entry: `@bufbuild/protobuf` 2.17.0 (2026-11-05), `@connectrpc/connect` and `connect-web` 2.3.0 (2026-10-27), `@e2b/dockerfile-utils` 0.1.2 (2026-11-13), `glob` 14.0.6 (2026-11-12), `path-scurry` 3.0.0 (2026-10-27), `openapi-fetch` 0.17.0 (2026-02-11) |
| N47b-4 | `{ Sandbox, Secret }` from `e2b` 2.63.0 satisfies the backend's structural `E2BSdk` type | ✅ | `test/sandbox/e2b-types.test.ts` assigns them under `tsc`; changing `fill`'s return type to `number` made `tsc` fail on that line |

## Egress

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N47b-5 | A sandbox's egress is open unless it is restricted: with no `allowOut`, all outbound traffic is allowed | ✅ | `SandboxNetworkOpts.allowOut` TSDoc ("If `allowOut` is not specified, all outbound traffic is allowed"); [internet access](https://docs.e2b.dev/network/internet-access): "Every sandbox has outbound access to the internet by default" |
| N47b-6 | Domain filtering needs `0.0.0.0/0` in `denyOut`, and an allow entry beats a deny entry | ✅ | Internet access page: "When using domain-based filtering, you must deny all other traffic in `denyOut`" and "allow rules always take precedence over deny rules"; the schema's `allowOut` description says the same |
| N47b-7 | `denyOut` takes CIDR blocks and addresses only, never a domain | ✅ | `SandboxNetworkConfig.denyOut` description: "Domain names are not supported for deny rules"; internet access page. The backend therefore refuses a non-empty `network.deny` |
| N47b-8 | `allowOut` accepts `*.example.com` and `*`, so a wildcard widens a policy | ✅ | `allowOut` description lists `"*.example.com"`; internet access page, "Catch-all wildcard". The backend refuses both |
| N47b-9 | Domain filtering matches HTTP by Host on port 80 and TLS by SNI on port 443 only; other ports are filtered by address | ✅ | Internet access page: "Domain-based filtering only works for HTTP traffic on port 80 … and TLS traffic on port 443 … Traffic on other ports uses CIDR-based filtering only". The backend refuses a host with a port |
| N47b-10 | Once `allowOut` holds a domain, E2B opens all traffic, not only DNS, to `8.8.8.8` unless `dnsServers` says otherwise, and `dnsServers: []` opens none | ✅ | `SandboxNetworkOpts.dnsServers` TSDoc and the internet access page, "DNS when you filter by domain": "This covers **all traffic to `8.8.8.8`**" and "Pass an empty list to allow no DNS server at all" |
| N47b-11 | With `dnsServers: []`, an allowed name still works if `/etc/hosts` maps it to any public address, because E2B routes by Host or SNI | ✅ | Internet access page, "Resolving names with no DNS server". The live script uses `curl --resolve` for the same effect |
| N47b-12 | `allowInternetAccess: false` behaves like `denyOut: ["0.0.0.0/0"]` | ✅ | `SandboxOpts.allowInternetAccess` TSDoc; `SandboxNetworkUpdateConfig.allow_internet_access` description |
| N47b-13 | A denied TCP connection can look open from inside the sandbox, so a probe must check for an application response | ✅ | Internet access page, "Behavior of blocked TCP connections". The probes check curl's exit code and an HTTP status, and the fake times out a denied request |
| N47b-14 | `getInfo()` reports the network as `allowOut`, `denyOut`, `rules`, `egressProxy` and `dnsServers`, and a missing `dnsServers` means the default `8.8.8.8` | ✅ | `SandboxInfo.network` and `SandboxNetworkInfo` in `index.d.ts`; internet access page: "When it's missing there, the default applies" |
| N47b-15 | `getInfo()` reports `dnsServers: []` for a sandbox created with it, rather than leaving the field out | ⚠️ | The page says a set list is shown, but not whether an empty list counts. If E2B leaves it out, the read-back adds `8.8.8.8` and every provision fails with `network.allow`, which fails closed; the live run settles it |
| N47b-16 | E2B's egress filter has no IPv6 path for a sandbox to use, so denying `0.0.0.0/0` closes egress | ⚠️ | Neither the types nor the network pages mention IPv6, and `ALL_TRAFFIC` is the IPv4 range only. The fake gives the VM no IPv6 route; the live run's `[fd00:ec2::254]` and `[::1]` probes test it |
| N47b-17 | A SOCKS5 egress proxy fails closed, so method scoping can go through our own proxy | ✅ | `SandboxEgressProxyOpts` TSDoc ("Egress fails closed") and [BYOP](https://docs.e2b.dev/network/byop). The backend doesn't configure one, and its read-back refuses one it didn't ask for |

## Secrets

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N47b-18 | A rule's header can hold `Secret.fill(name)`, a placeholder E2B's egress proxy replaces with the secret's value outside the sandbox, on HTTPS only | ✅ | [Injecting secrets](https://docs.e2b.dev/secrets/inject): "Stored secrets are injected into the sandbox's outbound **HTTPS** requests … Plain HTTP requests do not receive injected headers"; `Secret.fill` in `index.mjs` returns `${e2b.secrets.<name>}` |
| N47b-19 | E2B checks a secret only when a request uses it, and an unresolved reference omits the whole header while the request is still forwarded | ✅ | Injecting secrets, "Resolution failures are silent for traffic": "Referencing a valid secret name that doesn't exist does **not** fail at sandbox creation" and "The request is still forwarded … Every header containing an unresolved reference is omitted in full". This is why provisioning checks first |
| N47b-20 | A rule replaces a header of the same name sent by the sandbox, and removes it when resolution fails | ✅ | Injecting secrets, same section. The fake plays both, and a test sends a forged `Authorization` that the host never sees |
| N47b-21 | Injection is keyed on host and reaches every process in the sandbox, whatever the method | ✅ | Injecting secrets, the warning: "Every process in the sandbox that sends an HTTPS request to that host gets the secret". No rule field names a method or path (`SandboxNetworkRule` and `SandboxNetworkTransform` in `index.d.ts`). The backend requires `unscopedInjection: true` |
| N47b-22 | `Secret.exists(nameOrId)` checks existence without returning a value, and secret values are write-only | ✅ | `Secret.exists` in `index.mjs` calls `getInfo` and returns `false` on `SecretNotFoundError`; the `Secret` class TSDoc: "Secret values are write-only"; [secrets overview](https://docs.e2b.dev/secrets) |
| N47b-23 | A secret name is 1–128 ASCII letters, digits, `_` or `-`, is stored in lower case, and may not start with `sec_` | ✅ | [Creating secrets](https://docs.e2b.dev/secrets/create), "Secret names"; the `NewSecret.name` description in `index.d.ts`. The SDK itself rejects only an empty name, braces and control characters (`validateSecretName`) |
| N47b-24 | For a host with a rule, E2B intercepts TLS with its own certificate authority, which it adds to the sandbox's system bundle | ✅ | Internet access page, "TLS certificates". The research report records the same ([portable agents](../../research/deployment/portable-agents.md#four-hosted-sandboxes-meet-our-three-hard-rules-and-e2b-should-come-first)) |

## Lifecycle and commands

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N47b-25 | `Sandbox.create` takes `timeoutMs`, `metadata`, `network` and `lifecycle.onTimeout`, and the timeout's maximum is 24 hours on Pro and 1 hour on Hobby | ✅ | `SandboxOpts` and `SandboxLifecycle` in `index.d.ts` |
| N47b-26 | A sandbox's default lifetime, with no `timeoutMs`, is 300 seconds | ✅ | The API schema's `timeout` field, `@default 300`, in `index.d.ts`. The backend always sets its own, 15 minutes by default |
| N47b-27 | `Sandbox.kill(id)` kills a running or paused sandbox and resolves `false` when E2B no longer has it; `Sandbox.list` filters by metadata | ✅ | `SandboxApi.kill` and `SandboxListOpts.query.metadata` in `index.d.ts` |
| N47b-28 | `Sandbox.connect(id)` resumes a paused sandbox, and `pause()` keeps its state | ✅ | `Sandbox.connect` TSDoc ("If the sandbox is paused, it will be automatically resumed") and `pause` in `index.d.ts` |
| N47b-29 | `commands.run(cmd)` runs `/bin/bash -l -c cmd`, with the request's `envs` added to the process's environment | ✅ | [Running commands](https://docs.e2b.dev/commands), "Custom shell": "By default, commands run in a Bash login shell (`/bin/bash -l -c <cmd>`)"; `Commands.start` in `index.mjs` sends `cmd: "/bin/bash"`, `args: ["-l", "-c", cmd]` and `envs` |
| N47b-30 | A command's own timeout defaults to 60 seconds and kills the process even in the background, and `timeoutMs: 0` turns it off, so the backend passes `0` and times the command itself | ✅ | [Running commands in background](https://docs.e2b.dev/commands/background), "Disable the command timeout": "`timeoutMs: 0` … disables the command timeout. The default is 60 seconds, and when it expires the process is killed in the sandbox, even when `background` is set"; `CommandStartOpts.timeoutMs` TSDoc gives the same default |
| N47b-31 | `wait()` throws `CommandExitError`, carrying `exitCode`, for a non-zero exit, and a missing file throws `FileNotFoundError` | ✅ | `CommandExitError` and `FileNotFoundError` in `index.d.ts`; `index.mjs` sets each class's `name`, which the backend matches |
| N47b-32 | `bash -l -c` provides `compgen -e`, which the prelude uses to list exported variables | ⚠️ | A bash builtin on Debian's bash; not checked in E2B's `base` template. The live run's environment case fails if it is missing |
| N47b-33 | `CommandHandle.kill()` sends `SIGKILL` to the command's process, and E2B makes that process a process group's leader, so `kill -KILL -- -pid` ends what it started | ⚠️ | `Commands.kill` TSDoc says `SIGKILL`; nothing says whether envd starts a command in its own group. The live run's process-tree case checks it |
| N47b-36 | E2B's commands page offers a `shell` option to replace `bash -l -c`, which the pinned 2.63.0 lacks, so the live docs run ahead of the pin and the backend doesn't use it | ✅ | [Running commands](https://docs.e2b.dev/commands), "Custom shell"; `CommandStartOpts` in 2.63.0's `index.d.ts` has no `shell` field and `Commands.start` always sends `/bin/bash` |
| N47b-37 | A command started with `timeoutMs: 0` keeps running after the client disconnects or exits, so after a crash of the host process the sandbox's lifetime is what ends it | ✅ | Running commands in background, same section: "With the timeout disabled, the process keeps running after the client disconnects or exits". The backend's `timeoutMs` (15 minutes by default) is that lifetime |
| N47b-38 | A template is pinned to an exact build by starting from `<template>:<build_id>`, while a tag can be moved | ✏️ | [Template tags and versioning](https://docs.e2b.dev/template/tags), "Instead of using a named tag, you can start a sandbox from a specific build by passing its `build_id`". The README and the `template` option first said "pin it by id or tag"; corrected to a build id |

## Modelling in the fake

| # | Claim | Verdict | Source and reason |
| --- | --- | --- | --- |
| N47b-34 | The fake gives a denied connection curl's exit 28, after E2B accepts and drops it | ✏️ | Drafted first as a refused connection (exit 7); corrected to a timeout from row N47b-13's page. Loopback, which stays inside the VM, keeps exit 7 |
| N47b-35 | The fake applies a rule only on HTTPS to the rule's exact host, not to subdomains | ⚠️ | Our reading of the rule-key description (exact names take precedence, and wildcards are separate keys). The backend writes only exact names, so the subdomain case doesn't arise |

**Totals:** 38 claims: 31 ✅, 2 ✏️, 5 ⚠️.
