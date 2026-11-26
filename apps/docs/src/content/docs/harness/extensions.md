---
title: Extensions add hooks and tools to a harness
description: How an extension adds hooks, observers and tools, how a project's extensions load only when you trust them, and how skills and project context files reach the model.
---

You will add your own hooks and tools to a harness with an extension, and decide which of a project's extensions may load. You need this when a project must change how an agent behaves.

An extension runs in the harness's own process with the process's permissions. Loading one is a trust decision, and trust is not a sandbox. The [permission pipeline](/harness/permissions/) still decides every call that an extension's tool makes, but an extension's own hooks can do anything the process can.

## An extension is a name, a version and any of three parts

An extension has a `name`, a `version` and any of `interceptors`, `observers` and `tools`. An interceptor is a hook that runs at a fixed point of the loop, such as before a tool call, and may change or stop what happens next. An observer receives each event and changes nothing. A tool is registered with the source `extension`.

This audit extension asks a person before every shell command and hands every event to a log. The harness runs it before another extension, `other`, and records both in the session log:

```ts file="packages/harness/examples/audit-extension.ts" region="audit"
```

`composeExtensions()` joins the hooks in the order you give. For `beforeToolCall`, the first deny wins and any ask asks. `transformContext`, `beforeModelCall` and `afterToolCall` chain in order, and `shouldStop` lets any extension stop the run. A hook that throws fails the joined hook for every extension, because the joined hook is one function. The failure closes the run unless every extension sets `onFailure: "continue"`, and an extension that leaves it unset counts as closed. Two extensions with one name, or one without a name or version, throw `invalid_extension`.

A tool from an extension replaces a built-in tool of the same name only when it sets `override: true`. Any other repeated name throws `duplicate_tool`.

## A project's extensions load only from a trusted project

A project can ship its own extensions in `.agents/extensions/<folder>/`, each with an `index.mjs` or `index.js` whose default export is an extension. Because they run in your process, `loadProjectExtensions()` loads none of them unless you trust the project. A headless run, one with nobody at the keyboard, loads none either unless you pass `loadInHeadless: true`. A skipped project returns a notice that says why.

This function trusts the project at `root` only when the host says so, and loads the extensions that the lock file allows:

```ts file="packages/harness/examples/project-extensions.ts" region="load"
```

A lock file pins each extension folder to a hash of its files. After a person has read the extensions, `pinProjectExtensions(root)` writes `.agents/extensions.lock.json`. Once the file exists, the loader hashes every folder before it imports any of them, and refuses a folder whose files changed, that the file does not list, or that the file lists and the project no longer holds. The refusal is `extension_hash_mismatch`, and none of the project's extensions load. With no lock file, the extensions load and a notice says they are not pinned.

The pin has two limits. It covers the files inside each folder, not what an extension imports from outside it. And the lock file sits inside the project, so anyone who can edit the project can pin their own changes. The pin catches a change nobody meant, not an attacker who holds the project.

Trust is stored by a project's real path, never by the spelling you wrote, because a link can point somewhere else after you trust it.

## A skill is a file the model reads when it needs it

A skill is a folder under `.agents/skills/` with a `SKILL.md` file whose first lines give a `name` and a `description`. `discoverSkills()` finds skills in the working folder and every folder above it up to the repository root, and it needs a trust store as well, because a skill's name and description enter the system prompt.

The prompt lists only each skill's name, description and path. The model loads a skill by reading its `SKILL.md` with the `read` tool, and the turn then records a `skill_loaded` entry. A skill is text the model may follow, so trust decides what loads and no sandbox comes with it.

## Project context files lead every request, labelled untrusted

`AGENTS.md` and `CLAUDE.md` files, read from the repository root down to the working folder, give the model a project's instructions. `contextFiles()` reads them whether or not the project is trusted, because they are text and not code. The harness puts them at the start of the first user message of each request, inside a section labelled as the project's text and not the user's.

Each file is cut at 64 KiB, and the block holds 128 KiB in all. Past that, the outermost files are left out first and the block names them. A link that leaves the project is skipped, so a cloned repository cannot point `AGENTS.md` at a private file and send it to the model provider.

Next, find a fix in [problems and fixes](/harness/problems-and-fixes/).
