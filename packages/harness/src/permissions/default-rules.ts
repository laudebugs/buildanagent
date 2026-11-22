import type { Rule } from "./types.js";

// The tools that change or remove a file, under the names the built-in tools use.
const EDIT_TOOLS = /^(write|edit|multi_edit|apply_patch|delete|remove|move|rename)$/;

const TEST_PATHS = [
  "**/*.test.*",
  "**/*.spec.*",
  "**/*_test.*",
  "**/test_*.*",
  "**/__tests__/**",
  "**/test/**",
  "**/tests/**",
];

// The files that decide what runs or what is allowed: hooks, CI, and the rules files that steer an agent.
const CONTROL_PATHS = [
  "**/.git/hooks/**",
  "**/.husky/**",
  "**/.github/workflows/**",
  "**/.gitlab-ci.yml",
  "**/.circleci/**",
  "**/Jenkinsfile",
  "**/lefthook.yml",
  "**/.pre-commit-config.yaml",
  "**/AGENTS.md",
  "**/CLAUDE.md",
  "**/.claude/**",
  "**/.agents/**",
  "**/.cursor/rules/**",
];

/**
 * The ask rules the harness ships: a change to a test file, and a change to a hook, CI configuration or a rules file.
 * They match by path, so they ask for every change to such a file and can't tell a deleted test from an edited one; a
 * product that wants to tell them apart does it in a hook. A bash command that edits these files is not covered.
 */
export const defaultAskRules: readonly Rule[] = [
  { tool: EDIT_TOOLS, paths: TEST_PATHS, reason: "This changes a test file, and a test is how the change is checked." },
  {
    tool: EDIT_TOOLS,
    paths: CONTROL_PATHS,
    reason: "This changes a hook, CI configuration or a rules file, which decide what runs and what is allowed.",
  },
  { tool: "bash", commandPrefix: ["git", "rm"], reason: "This deletes tracked files, which may include tests." },
];
