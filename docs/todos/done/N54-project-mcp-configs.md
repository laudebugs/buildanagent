# N54: Project-supplied MCP server configs behind project trust

| Field | Value |
| --- | --- |
| ID | `N54` |
| Status | `done` |
| Plan | [Build harness §4, Stage 5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client) |
| Round / milestone | Round N (build harness), M6 |
| Depends on | [N24](../done/N24-mcp-stdio.md), [N22](../done/N22-in-process-extensions.md) |
| Size | M |

## Goal

Load MCP server configs that a project supplies, such as a `.mcp.json`, only after the user trusts the project, so that cloning a repository can never start a program on the user's machine. A stdio MCP server runs on the host, outside any sandbox, with the harness's user, so a project config is code the project chooses to run. Today `createMcpManager()` takes configs from host code only (N24), and this todo adds the project path the owner asked for on 2026-11-22.

## Context

- [N24 Outcome](../done/N24-mcp-stdio.md#outcome): the MCP client, its config shape (`McpServerConfig`) and the owner's decision that project configs need project trust
- [N22](../done/N22-in-process-extensions.md): the project-trust gate for extensions, `TrustStore`, and the content-hash pins in `.agents/extensions.lock.json`; this todo applies the same rules to MCP configs
- [harness guide §7](../../guides/agent-harness.md#7-extensions-come-in-three-trust-tiers-and-project-trust-gates-loading-not-execution): trust gates loading, not execution
- [`spawnEnv()`](../../../packages/harness/README.md#every-spawned-process-gets-a-cleared-environment): what a server inherits, which a project config must not widen

## Scope

**In scope**

- Reading project MCP configs from a fixed path (choose `.mcp.json`, `.agents/mcp.json` or both, and say why) into `McpServerConfig` values, with the same checks `createMcpManager()` makes
- The trust gate: a project config loads only when the project is trusted; a headless run loads it only with an explicit opt-in, as N22's `loadInHeadless`
- Showing the exact command and args of each server before trust is given, so the user approves what will run
- Pinning each server's config by content hash in the lock file, so a changed command, args or variable list asks again
- `setEnv` values: a project file must not carry a secret, so decide how a project config names a credential (a reference the host resolves, never a value in the file)

**Out of scope** (and which todo covers it)

- Remote MCP transports and their credentials (N25)
- Pinning the servers' tool lists (N25)

## Tasks

- [x] Read how N22's `loadProjectExtensions()`, `TrustStore` and `pinProjectExtensions()` gate and pin extensions, and reuse them rather than add a second trust store.
- [x] Choose the config path and format, and write the parser with the checks of `checkServerConfig()`.
- [x] Add the trust gate and the notice that lists each server's command and args.
- [x] Add the pins to the lock file, keyed by server name, and the refusal on a mismatch.
- [x] Write the README section and the tests.

## Acceptance criteria

- [ ] A project MCP config needs project trust: it is denied by default, the notice shows each server's exact command and args, and the config is pinned by content hash, so a change asks again
- [x] An untrusted project starts no server and registers no tool, and a test proves the command never ran
- [x] A headless run starts no project server without the explicit opt-in
- [x] A project config can't set a credential's value; a test shows the refusal
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/mcp/project-config.test.ts`, with a fixture project folder and a marker file that shows whether a command ran.

## Docs to update

`packages/harness/README.md`, the MCP section. The plan's todo table in [build-harness.md §4.5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client).

## Risks and open questions

A pin covers the config, not the program it names: a trusted project can change the script a pinned command runs, as N22's pins cover only the extension's own folder. Decide whether the pin should also hash a script inside the project that the command names.

## Definition of done

- [x] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [x] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated

## Outcome

`loadProjectMcpServers()` in `@buildanagent/harness/extensions/node` now reads a project's `.mcp.json` and starts a server only when the project is trusted and the server's config matches its pin. [The README's MCP section](../../../packages/harness/README.md#a-projects-mcpjson-starts-no-server-until-the-project-is-trusted-and-the-servers-config-is-pinned) documents it. The code is in commits `ea2b4099` and `e4ce5f94`, with the first review's fixes in `5f2c1c3e` and `a1caae0b` and the second review's after them: `packages/harness/src/extensions/mcp-config-node.ts`, `files-node.ts`, `lock.ts`, `spawn-env.ts` and 39 tests in `packages/harness/test/mcp/project-config.test.ts`.

**API.** `loadProjectMcpServers(root, { trust, headless, loadInHeadless?, configFile?, lockFile?, secrets? })` returns `{ servers, declared, notices }`. `pinProjectMcpServer(root, server, hash)` records an approval, `describeProjectMcpServer()` renders the notice line, and `PROJECT_MCP_CONFIG`, `readMcpConfigPins` and `writeMcpConfigPin` come with the types `ProjectMcpOptions`, `ProjectMcpFiles`, `ProjectMcpServer` and `ProjectMcpServers`.

**Decisions.**

- **Path: `.mcp.json` at the project root only.** One file means no precedence rules. It is the `mcpServers` shape that Claude Code's docs give for project scope (checked on 2026-11-26) and that Pi's mirrored docs give for `.pi/mcp.json` (`docs/reference/pi/source/coding-agent/mcp.md`).
- **Gate: N22's.** It reuses `TrustStore` through `projectTrusted()` and the `loadInHeadless` rule, so there is no second trust store. A headless run without the opt-in only checks that the file exists.
- **An untrusted project parses but runs nothing.** The file and the lock file are read and the named paths hashed, all inside the project, so the notice shows each server's exact command and args and its pin state. A test proves the command never ran: it starts whatever the loader returned, and the fixture server, which writes a marker file the moment it starts, leaves no marker. A server the project's own lock file pins is `pinned` there, and its notice says that once the project is trusted it needs no further question and starts as any pinned server does: in a run that is not headless or sets `loadInHeadless`, and when the host supplies every variable it names.
- **Pins: `mcp.<server>.config` in `.agents/extensions.lock.json`,** beside N25's `mcp.<server>.tools`. A server starts only when trusted and its config hash matches; a new or changed config waits, and `pinProjectMcpServer()` refuses a hash the config no longer has.
- **Credentials by reference.** An `env` value must be exactly `"${NAME}"`. The host's `secrets(name, server)` resolves it, asked only for a server about to start. Any other value is refused with `invalid_mcp_config` without being quoted.
- **No widening of `spawnEnv()`.** There are no parent-variable copies. `PATH`, `HOME`, `TMPDIR`, `LANG` and loader variables such as `NODE_OPTIONS` and `LD_PRELOAD` are refused, as is every name that starts with `LD_`, `DYLD_`, `NPM_CONFIG_`, `GIT_`, `PYTHON`, `PERL`, `RUBY`, `JAVA_` or `_JAVA_` and a few named ones, such as `ZDOTDIR`. It is a denylist, because the host supplies every value and the project picks only the name. `${` in the command or args is refused too.
- **The notice can't be made to read as another command.** A name, command or argument with a control or format character, a line or paragraph separator, a combining mark or a non-ASCII space is refused, as is one over 1,024 characters, more than 64 args or more than 32 variables. The notice and every error quote the project's strings with everything outside printable ASCII escaped.
- **Every refusal is `invalid_mcp_config`,** the lock file's included, and its message starts with the file's name.

**Answer to the todo's open question.** Yes, the pin also hashes each path inside the project that the command line names: the command when it is a path, each argument, and the value of each `--option=value` argument, a file by its SHA-256 and a folder by every file in it. A changed `server.mjs` or `--import=./p.mjs` asks again. Each path is resolved to its real path first and keyed by it, so two spellings of one file are one entry. A path written inside the project whose real path leaves it refuses the config before anything there is read, as does a folder that holds a link; one load hashes at most 4,096 files and folders, each charged as the walk lists it, and 64 MiB, and no file over 16 MiB. A default lock file under a linked `.agents`, or one that leads nowhere, is refused. The pin does not cover what the named code loads by other means, a module named by name (`python -m pkg`) or the project root itself (`node .`).

**Remaining risks.** The pin doesn't cover what the named code loads by other means, a module named by name, the project root, the packages that `npx` or `uvx` fetch, or a change between the check and the spawn. So the first acceptance box stays unticked: a change nobody pinned asks again, but a change that brings its own pin does not. The lock file lives in the project, so a `git pull` that changes both `.mcp.json` and the lock file starts the new command without asking, and a cloned project's own lock file approves its servers at the moment of trust, after the notice shows them. N22's extension pins share this.

**Open question for the owner.** Should approvals live outside the project, in the user's trust store, so a project's own files can never approve its servers? That would close the `git pull` and clone cases for MCP configs and extension pins alike, at the cost of a per-user store the host must keep. It is the owner's decision, and this todo leaves it open.

**Checks.** `pnpm check`, `pnpm typecheck`, `pnpm check:links`, `pnpm fact-check-logs` and the harness docs check pass locally. The box naming `pnpm test` stays unticked: the root `pnpm test` stops at `verify/copilot-sdk` on this Mac, which has no `unshare`, and 5 harness tests fail locally on main from the environment. CI runs both. The review boxes stay unticked until the pull request's reviews run.
