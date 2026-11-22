# N54: Project-supplied MCP server configs behind project trust

| Field | Value |
| --- | --- |
| ID | `N54` |
| Status | `ready` |
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

- [ ] Read how N22's `loadProjectExtensions()`, `TrustStore` and `pinProjectExtensions()` gate and pin extensions, and reuse them rather than add a second trust store.
- [ ] Choose the config path and format, and write the parser with the checks of `checkServerConfig()`.
- [ ] Add the trust gate and the notice that lists each server's command and args.
- [ ] Add the pins to the lock file, keyed by server name, and the refusal on a mismatch.
- [ ] Write the README section and the tests.

## Acceptance criteria

- [ ] A project MCP config needs project trust: it is denied by default, the notice shows each server's exact command and args, and the config is pinned by content hash, so a change asks again
- [ ] An untrusted project starts no server and registers no tool, and a test proves the command never ran
- [ ] A headless run starts no project server without the explicit opt-in
- [ ] A project config can't set a credential's value; a test shows the refusal
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass offline from the repo root

## Tests

`packages/harness/test/mcp/project-config.test.ts`, with a fixture project folder and a marker file that shows whether a command ran.

## Docs to update

`packages/harness/README.md`, the MCP section. The plan's todo table in [build-harness.md §4.5](../../plans/build-harness.md#45-stage-5-adds-extensions-skills-and-the-mcp-client).

## Risks and open questions

A pin covers the config, not the program it names: a trusted project can change the script a pinned command runs, as N22's pins cover only the extension's own folder. Decide whether the pin should also hash a script inside the project that the command names.

## Definition of done

- [ ] Claimed: the first commit moved this file `ready/` → `ongoing/` (Status `ongoing`)
- [ ] Prose drafted with `/anthropic-skills:writing` and reviewed with `/anthropic-skills:writing-review`, with the fixes applied and changed claims re-checked
- [ ] `pnpm check`, `pnpm typecheck` and `pnpm test` pass locally; pushed after each meaningful step
- [ ] This file moved `ongoing/` → `done/` (Status `done`), and the plan's todo table updated
