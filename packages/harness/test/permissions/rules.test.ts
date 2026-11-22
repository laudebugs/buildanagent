// Rule matching: tool names and aliases, path globs, command prefixes and the shell parsing behind them.
import assert from "node:assert/strict";
import { createPermissionPipeline, defaultAskRules, type Rule } from "@buildanagent/harness/permissions";
import { test } from "vitest";
import { base, call, input, registryOf } from "./helpers.js";

async function decisionFor(rules: { deny?: Rule[]; ask?: Rule[]; allow?: Rule[] }, tool: string, toolInput: unknown) {
  const pipeline = createPermissionPipeline({ ...base, interactive: false, ...rules }, registryOf());
  return (await pipeline.decide(call(tool, toolInput), input())).decision;
}

test("a rule matches a tool by name, by alias, by a pattern with *, and by a regular expression", async () => {
  for (const tool of ["web_fetch", "fetch", "mcp__github__*", /^mcp__github__/, /^web_/]) {
    const name =
      tool === "fetch" || tool === "web_fetch" || (tool instanceof RegExp && tool.source.includes("web"))
        ? "web_fetch"
        : "mcp__github__search";
    assert.equal(await decisionFor({ deny: [{ tool }] }, name, {}), "deny", String(tool));
  }
  assert.equal(
    await decisionFor({ deny: [{ tool: "read" }] }, "grep", {}),
    "deny",
    "no rule, so headless denies by default too",
  );
  assert.equal(
    await decisionFor({ allow: [{ tool: "read" }] }, "grep", {}),
    "deny",
    "an allow rule for another tool allows nothing",
  );
});

test("a global regular expression matches the same on every call", async () => {
  const rule: Rule = { tool: /^read$/g };
  for (let i = 0; i < 3; i += 1) assert.equal(await decisionFor({ allow: [rule] }, "read", {}), "allow");
});

test("a path glob matches the path fields of the input, with * inside a directory and ** across them", async () => {
  const rules = { deny: [{ tool: "write", paths: ["src/*.ts", "docs/**"] }] };
  assert.equal(await decisionFor(rules, "write", { path: "src/a.ts" }), "deny");
  assert.equal(await decisionFor(rules, "write", { path: "docs/a/b/c.md" }), "deny");
  assert.equal(
    await decisionFor({ ...rules, allow: [{ tool: "write" }] }, "write", { path: "src/deep/a.ts" }),
    "allow",
    "* stops at a slash",
  );
  assert.equal(await decisionFor(rules, "write", { file_path: "src/a.ts" }), "deny", "file_path counts as a path");
  assert.equal(
    await decisionFor(rules, "write", { paths: ["ok.txt", "docs/x.md"] }),
    "deny",
    "any listed path can match",
  );
});

test("a path is normalised before matching, so ./ and .. do not slip past a rule", async () => {
  const rules = { deny: [{ tool: "write", paths: [".github/**"] }], allow: [{ tool: "write" }] };
  for (const path of [".github/ci.yml", "./.github/ci.yml", "src/../.github/ci.yml", ".github//ci.yml"]) {
    assert.equal(await decisionFor(rules, "write", { path }), "deny", path);
  }
  assert.equal(
    await decisionFor(rules, "write", { path: "../../.github/ci.yml" }),
    "allow",
    "a path that leaves the tree is another path",
  );
});

test("an allow rule with paths needs every path of the call inside its globs", async () => {
  const allow = [{ tool: "write", paths: ["src/**"] }];
  assert.equal(await decisionFor({ allow }, "write", { path: "src/a.ts" }), "allow");
  assert.equal(await decisionFor({ allow }, "write", { paths: ["src/a.ts", "etc/passwd"] }), "deny");
  assert.equal(
    await decisionFor({ allow }, "write", {}),
    "deny",
    "a call with no path the rule can read is not covered",
  );
  assert.equal(
    await decisionFor({ allow }, "write", { path: "/src/a.ts" }),
    "deny",
    "an absolute path is not a relative one",
  );
});

test("a deny rule matches a command prefix, so git push is refused and git status is not", async () => {
  const deny = [{ tool: "bash", commandPrefix: ["git", "push"] }];
  const allow = [{ tool: "bash" }];
  assert.equal(await decisionFor({ deny, allow }, "bash", { command: "git push origin main" }), "deny");
  assert.equal(await decisionFor({ deny, allow }, "bash", { command: "git status" }), "allow");
  assert.equal(
    await decisionFor({ deny, allow }, "bash", { command: ["git", "push"] }),
    "deny",
    "a list of words is one command",
  );
});

test("chained commands are split, and a deny rule matches any part", async () => {
  const deny = [{ tool: "bash", commandPrefix: ["rm"] }];
  const allow = [{ tool: "bash" }];
  for (const command of [
    "ls && rm -rf build",
    "ls; rm -rf build",
    "ls || rm -rf build",
    "ls | rm -rf build",
    "ls\nrm -rf build",
    "ls & rm -rf build",
    "echo 'a && b'; rm x",
  ]) {
    assert.equal(await decisionFor({ deny, allow }, "bash", { command }), "deny", command);
  }
  assert.equal(
    await decisionFor({ deny, allow }, "bash", { command: "echo 'rm -rf build && ls'" }),
    "allow",
    "a quoted separator and a quoted word are text",
  );
  assert.equal(await decisionFor({ deny, allow }, "bash", { command: 'grep "a;b" file' }), "allow");
});

test("an allow rule with a command prefix needs every part of a chain covered", async () => {
  const allow = [
    { tool: "bash", commandPrefix: ["git", "status"] },
    { tool: "bash", commandPrefix: ["ls"] },
  ];
  assert.equal(
    await decisionFor({ allow }, "bash", { command: "git status && ls -la" }),
    "allow",
    "two rules cover two parts",
  );
  assert.equal(await decisionFor({ allow }, "bash", { command: "git status && rm -rf /" }), "deny");
  assert.equal(await decisionFor({ allow }, "bash", { command: "git status; git push" }), "deny");
  assert.equal(await decisionFor({ allow }, "bash", { command: "" }), "deny", "an empty command is not covered");
});

test("a command that hides commands in a substitution is never allowed, and a deny rule still sees inside it", async () => {
  const allow = [{ tool: "bash", commandPrefix: ["echo"] }];
  const deny = [{ tool: "bash", commandPrefix: ["rm"] }];
  for (const command of ["echo $(rm -rf x)", "echo `rm -rf x`", "echo <(rm -rf x)"]) {
    assert.equal(
      await decisionFor({ allow }, "bash", { command: command.replace("rm -rf x", "ls") }),
      "deny",
      `${command} is opaque`,
    );
    assert.equal(
      await decisionFor({ allow: [{ tool: "bash" }], deny }, "bash", { command }),
      "deny",
      `${command} hides an rm`,
    );
  }
});

test("a shell -c script is read as commands too", async () => {
  const deny = [{ tool: "bash", commandPrefix: ["rm"] }];
  const allow = [
    { tool: "bash", commandPrefix: ["bash"] },
    { tool: "bash", commandPrefix: ["sh"] },
  ];
  assert.equal(
    await decisionFor({ deny, allow: [{ tool: "bash" }] }, "bash", { command: 'bash -c "ls && rm x"' }),
    "deny",
  );
  assert.equal(await decisionFor({ deny, allow: [{ tool: "bash" }] }, "bash", { command: "sh -lc 'rm x'" }), "deny");
  assert.equal(await decisionFor({ deny, allow }, "bash", { command: "bash -c 'rm x'" }), "deny");
});

test("a deny rule looks past env assignments and wrappers, and an allow rule does not", async () => {
  const deny = [{ tool: "bash", commandPrefix: ["rm"] }];
  for (const command of ["sudo rm x", "FOO=1 rm x", "env FOO=1 rm x", "nohup sudo rm x"]) {
    assert.equal(await decisionFor({ deny, allow: [{ tool: "bash" }] }, "bash", { command }), "deny", command);
  }
  const allow = [{ tool: "bash", commandPrefix: ["git", "status"] }];
  assert.equal(
    await decisionFor({ allow }, "bash", { command: "sudo git status" }),
    "deny",
    "sudo changes who runs it",
  );
  assert.equal(await decisionFor({ allow }, "bash", { command: "FOO=1 git status" }), "deny");
});

test("defaultAskRules ask for an edit that removes a test file, and for a change to a hook, CI file or rules file", async () => {
  const pipeline = createPermissionPipeline({ ...base, mode: "accept_edits", ask: defaultAskRules }, registryOf());
  const asks = async (tool: string, path: string) => (await pipeline.decide(call(tool, { path }), input())).decision;
  assert.equal(await asks("edit", "tests/a.test.ts"), "ask");
  assert.equal(await asks("write", "/repo/src/__tests__/a.ts"), "ask");
  assert.equal(await asks("edit", ".github/workflows/ci.yml"), "ask");
  assert.equal(await asks("write", "AGENTS.md"), "ask");
  assert.equal(await asks("write", ".husky/pre-commit"), "ask");
  assert.equal(await asks("edit", "src/a.ts"), "allow", "an ordinary source file is an accepted edit");
  const bash = (command: string) => pipeline.decide(call("bash", { command }), input());
  assert.equal((await bash("git rm tests/a.test.ts")).decision, "ask");
});

test("a rule's reason reaches the decision", async () => {
  const pipeline = createPermissionPipeline(
    { ...base, deny: [{ tool: "bash", reason: "no shell here" }] },
    registryOf(),
  );
  assert.equal((await pipeline.decide(call("bash"), input())).reason, "no shell here");
});
