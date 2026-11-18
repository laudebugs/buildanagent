# Copilot surfaces beyond VS Code: how proposed changes are shown and confirmed, compared with other agents (as of November 2026)

*Working material for the [Copilot diff review report](../copilot-diff-review.md); the report and its [fact-check log](../fact-check.md#copilot-diff-review-report-2026-11-18) supersede this note where they disagree.*

Fetched 2026-11-18 with `curl -sSL --max-time 30`. docs.github.com pages were read through the article-body API (`https://docs.github.com/api/article/body?pathname=...`); the URLs below are the human-facing paths. Microsoft Learn pages carry `updated_at` 2026-10-13/14. SDK types are from `@github/copilot-sdk@1.0.31`, which bundles runtime `1.0.109` (`node_modules/.pnpm/@github+copilot-sdk@1.0.31/node_modules/@github/copilot-sdk/package.json`). Paths below abbreviate the SDK dist folder as `dist/` = `/home/user/agent-speak/node_modules/.pnpm/@github+copilot-sdk@1.0.31/node_modules/@github/copilot-sdk/dist/`. VS Code's Copilot working set, Claude Code checkpoints, Cursor, Zed and Cline checkpoints are already covered in `docs/research/agent-ui/notes/agent-product-undo-patterns.md` and `docs/research/agent-ui/undo-agent-edits.md`; this file only adds to them.

Three patterns used throughout:
- **Confirm-then-apply**: the change is shown (diff or description) before the write, and the write runs only on approval.
- **Apply-then-review**: the write lands on disk first; the user then Keeps or Undoes it (or rewinds).
- **Review-then-merge**: the change lands on a branch; a pull request review and merge is the confirm step.

## Copilot CLI: does the permission prompt show a diff, and does the edit run only after approval?

### Takeaway
Copilot CLI is confirm-then-apply per tool call in its default (manual) mode: a tool that modifies or executes files asks first, with "Yes / Yes for the session / No, and tell Copilot what to do differently". The docs do not say in words that the prompt shows a diff, but the runtime's `write` permission request carries a unified diff and full before/after text, so a diff preview is strongly implied (inference). Approval is per tool call, not per task, and `--allow-tool='write'`, `--allow-all-tools` or `/yolo` remove the confirm step, after which `/diff` and `/undo` (`/rewind`) are the review layer.

### Cited Findings
- In manual approval mode "Copilot asks for your approval when a tool request isn't already allowed", including tools that modify or execute files such as `touch`, `chmod`, `node`, `sed` — [About Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- The prompt's three options: "1. Yes", "2. Yes, and approve TOOL for the rest of the running session", "3. No, and tell Copilot what to do differently (Esc)" — [About Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli); [Using Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli)
- Option 2: approval lasts for the running session and "Any pending parallel permission requests of the same type will be auto-approved"; it asks again in new or resumed sessions — [Using Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli); [About Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- Option 3: "Copilot will not run the command. Instead, it ends the current operation and awaits your next prompt"; you can also give inline feedback on rejection — [Using Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli)
- `--allow-tool='write'` "allows Copilot to edit files without your individual approval"; `write` covers "tools—other than shell commands" that modify files; `shell(COMMAND)` and MCP server/tool specs are the other forms; `--deny-tool` takes precedence — [About Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- `write` rule kind: "File creation or modification", e.g. `write(src/*.ts)`; `--deny-tool='write(PATH)'` resolves symlinks and `.`/`..` — [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference)
- With `--allow-all-tools`, Copilot "can run any shell commands that you can run, without getting your prior approval" — [About Copilot CLI](https://docs.github.com/en/copilot/concepts/agents/about-copilot-cli)
- `--allow-all` / `--yolo` (or `/permissions allow-all`, `/yolo`) grant broad permissions "without a model safety review"; an "assisted permissions" mode lets an LLM auto-approve requests it judges safe — [Using Copilot CLI](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli)
- `/permissions [default|assisted|allow-all|show]` switches permission modes; `/reset-allowed-tools` clears session approvals — [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference)
- The CLI README markets: "Preview every action before execution — nothing happens without your explicit approval" (vendor marketing; true only in manual mode) — [github/copilot-cli README](https://github.com/github/copilot-cli)
- `/diff`: "Review changes in the current directory; auto-switches to branch diff when the working tree is clean (experimental)"; diff mode has `b` to toggle "unstaged changes and branch diff" — [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference). This is a post-hoc review of what is already on disk, not a staging area.
- `/undo`, `/rewind`: choose **Conversation only** or **Conversation + files**, which restores files Copilot changed "to their pre-change contents, skipping any you have since edited yourself"; "File changes are tracked per turn across editing tools, shell commands, and sub-agents, so Git is not required. A rewind cannot be undone"; use `/fork` first to keep a copy — [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference)
- Plan mode blocks edits to project files, "enforced directly", but is "a safety net, not a guarantee": shell commands whose effect "can't be clearly determined in advance" and MCP tools are let through; "Once you're happy with the plan, approve it to exit plan mode" — [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference)
- `--plan --mode autopilot` moves from plan to autopilot "without waiting for a human to approve the transition" — [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference)
- Rich diff rendering exists (`--plain-diff` / `PLAIN_DIFF` disables it, using "the diff tool specified by your Git config") — [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference)

### Inferences
- The SDK guide says the SDK "puts the engine behind Copilot CLI inside your application" (`docs/reference/copilot-sdk/guide.md:5`), and the runtime's `PermissionRequestWrite` carries `diff` and before/after contents (next section). So the CLI's file-edit prompt very likely renders a diff before writing. I found no docs.github.com sentence that says so in words; a screenshot or a run of the CLI would confirm it.
- "Approve TOOL for the rest of the session" turns later edits into apply-then-review, so a CLI session typically starts confirm-then-apply and drifts toward apply-then-review as the user grants session approvals.
- Shell commands are confirmed by command text, not by their effect: the prompt cannot show the diff a `sed -i` or a build script will produce.

### Gaps
- No primary doc text or screenshot confirming what the CLI's write prompt displays (diff, file name, intention). Not verified as of November 2026.
- Whether `/rewind` "Conversation + files" is atomic across files is undocumented in the CLI reference; the SDK JSDoc (below) describes rollback behavior for the runtime.

## GitHub Copilot SDK 1.0.31 / runtime 1.0.109: what a `write` permission request carries, and when the write happens

### Takeaway
The runtime asks before a file write with a `kind: "write"` request that carries the file name, a human-readable intention, a unified diff and (when available) complete before/after text for each file. That is a held, previewable copy of one tool call's proposed change, and the tool body runs only after approval: this is the part of the owner's hypothesis that is accurate. It is per tool call, not per task, and the experimental file-change tracking that powers rewind is explicitly "Not crash-atomic".

### Cited Findings
- `PermissionRequest` is a union of 12 kinds including `PermissionRequestShell` and `PermissionRequestWrite` — `dist/generated/session-events.d.ts:1264`
- `PermissionRequestWrite` (`dist/generated/session-events.d.ts:11359–11418`) fields:
  - `canOfferSessionApproval: boolean` — "Whether the UI can offer session-wide approval for file write operations" (`:11360–11363`)
  - `diff: string` — "Unified diff showing the proposed changes" (`:11364–11367`)
  - `fileEdits?` — "Complete before/after text previews captured while planning this request"; omitted for "pre-read sandbox requests and non-UTF-8 files"; "Missing sides mean creation or deletion" (`:11368–11373`)
  - `fileName: string` — "Path of the file being written to" (`:11374–11377`)
  - `intention: string` — "Human-readable description of the intended file change" (`:11378–11381`)
  - `kind: "write"` (`:11385`)
  - `managedApprovalRequired?` — managed policy "requires a human response and forbids host auto-approval" (`:11386–11389`)
  - `newFileContents?` — "Complete new file contents for newly created files" (`:11390–11393`)
  - `requestSandboxBypass?` — for `apply_patch` / `str_replace_editor` writes the sandbox would block: "This is a request, not a grant: the write happens unsandboxed only if the user approves this permission request" (`:11394–11397`)
  - `toolCallId?` (`:11415–11417`)
- `PermissionWriteFileEdit` has `before?` ("File content read while planning the operation") and `after?` ("Complete file content the operation plans to write"), each a `{ content, path }` snapshot; "Different before and after paths describe a move" — `dist/generated/session-events.d.ts:11419–11444`
- Decision kinds include `approve-once` (`dist/generated/rpc.d.ts:25391`), `approve-for-session` ("Approve and remember for the rest of the session", `:25404–25412`), `approve-for-location` (`:25633`), `approve-permanently` (`:25839`) and `reject` (`:25856`)
- The Node README's handler comment: `request.fileName — file being written (for write)`; `request.fullCommandText — full shell command (for shell)` — `docs/reference/copilot-sdk/source/nodejs/README.md:2019–2020` (mirrored from `github/copilot-sdk` tag `v1.0.31`)
- The repo verified the ordering for custom tools: "Before the handler runs, the runtime asks `onPermissionRequest`" and a declined escalation "never runs" — `docs/reference/copilot-sdk/guide.md:79,212` [verified: 02, 09]. The repo did **not** exercise the `write` or `shell` kinds: "The mock never calls `bash`, `edit`, `web_fetch` … so their behavior, the `shell` and `write` permission kinds … went untested" — `docs/reference/copilot-sdk/fact-check.md:160`
- Built-in file tools on this runtime are `view`, `create` and `edit` (not `write_file`); `shell` is a permission kind, not a tool name — `docs/reference/copilot-sdk/fact-check.md:112`
- `enableFileChangeTracking?: boolean` — "Opt in to capturing file changes for session rewind and cumulative session diff"; on resume it "cannot reconstruct changes from earlier untracked turns" — `dist/types.d.ts:2523–2528`
- The RPC-level JSDoc for the same option says a subagent write is attributed to the turn open "when the capture was staged, just before the tool body ran" — `dist/generated/rpc.d.ts:32428`
- `session.rpc.history` methods: `listRewindPoints()`, `previewRewind(params)` ("Previews the files that a conversation-and-files rewind would restore") and `rewind(params)` — `dist/generated/rpc.d.ts:45617–45637`; request shape `{ eventId, mode }` where `eventId` is the `user.message` "that begins the discarded suffix" — `:17384–17393`
- `rewind` JSDoc: "Not crash-atomic: file restore and conversation truncation are separate stores, applied in that order"; "There is no recovery journal"; re-running is the recovery path because file restore is idempotent — `dist/generated/rpc.d.ts:45630`
- `HistoryRewindMode`: `"conversation"` ("leaving files unchanged") or `"conversation-and-files"` — `dist/generated/rpc.d.ts:3218–3222`
- `HistoryRewindOutcome` includes `"files-rolled-back"` ("File restore failed and all applied file changes were rolled back"), `"rollback-incomplete"` ("rollback could not fully restore the pre-rewind state"), `"truncation-failed"`, `"session-busy"` and `"unsupported-remote-session"` — `dist/generated/rpc.d.ts:3230–3247`
- Skip reasons on restore: `"user-modified"` ("The file changed after Copilot's last captured write") and `"skipped-capture"` ("A faithful preimage was not captured") — `dist/generated/rpc.d.ts:3171–3179`
- The repo's guide on the hold pattern: return `{ kind: "no-result" }` and the call waits until `session.rpc.permissions.handlePendingPermissionRequest({ requestId, result })` answers — `docs/reference/copilot-sdk/guide.md:100` [verified: 09]

### Inferences
- The `write` request is a per-call staged change: the runtime has planned the edit (it holds `before` and `after` text and a diff) and has not yet run the tool body. An SDK host can render it, hold it pending (`no-result`), and approve or reject. This matches "has a copy … and lets the user confirm or reject the diff" at the granularity of one tool call on one file (or one move).
- It is not a task-level transaction: a multi-file change arrives as several permission requests, each approved and applied on its own; there is no API that commits several held edits in one step.
- Restore-side rollback (`files-rolled-back`) means the rewind tries to be all-or-nothing across files, but the JSDoc admits `rollback-incomplete` and no crash journal, so it is best-effort, not ACID.
- `fileEdits` is optional and missing for non-UTF-8 files, so a host UI cannot always show full before/after text; `diff` is the always-present field.
- Whether the runtime re-checks that the file still matches `before` at write time (a conflict check if the user edits during the prompt) is not stated in the types.

### Gaps
- Runtime behavior for `kind: "write"` and `kind: "shell"` was not run by this repo's harness (mock never calls host tools, by policy). Untested as of November 2026.
- No doc on what happens if the file changes between the permission request and approval.

## Copilot in Visual Studio and JetBrains IDEs

### Takeaway
Both IDEs are apply-then-review for agent-mode file edits: edits stream into the files and the user Keeps/Accepts or Undoes/Discards them afterward, with checkpoints for rollback. Terminal commands and non-built-in tools are confirm-then-apply. Visual Studio's older "Copilot Edits" flow and JetBrains' edit mode are the closest to confirm-then-apply, because changes appear as proposals the user accepts per chunk or file.

### Cited Findings
- Visual Studio agent mode "makes code edits, runs terminal commands, invokes tools, and applies changes across your codebase" — [VS: Copilot agent mode](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-agent-mode) (updated 2026-10-13)
- VS: "Copilot requests confirmation before running a terminal command or using a tool that isn't built in"; the Allow dropdown can auto-confirm a tool "for the current session or solution, or all future invocations" — [VS: Copilot agent mode](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-agent-mode)
- VS review: "Keep or discard the suggested edits as a whole in Total changes"; "Review individual file diffs and apply them selectively"; "keep or undo edits made to each chunk of code"; Keep/Undo in Total changes covers "all edits made since the last time that you selected Keep or Undo" — [VS: Copilot agent mode](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-agent-mode)
- VS 2026 18.6 adds a multi-file summary diff view "with granular accept and undo controls" — [VS: Copilot agent mode](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-agent-mode)
- VS revert: "select Restore next to the checkpoint before the prompt"; "the Visual Studio Copilot agent doesn't support stepwise undo or redo" — [VS: Copilot agent mode](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-agent-mode)
- VS: "For terminal commands, agent mode has the same permissions as the running Visual Studio process … Carefully review proposed terminal commands before you run them" — [VS: Copilot agent mode](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-agent-mode)
- VS Copilot Edits: proposed changes "appear as a diff in the code editor"; Tab accepts, Alt+Delete rejects; "you can preview these suggestions … You can then accept the proposed changes to commit them"; "Reset changes" restores files "to their state before the iteration was generated"; checkpoints "remain until you close Visual Studio" — [VS: Copilot Edits](https://learn.microsoft.com/en-us/visualstudio/ide/copilot-edits) (updated 2026-10-14)
- JetBrains agent mode: "Copilot streams the edits in the editor, updates the working set, and if necessary, suggests terminal commands to run"; then "Review the changes. If Copilot suggested terminal commands, confirm whether or not Copilot can run them" — [Using agent mode in your IDE (JetBrains tab)](https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/use-copilot-agents/use-agent-mode)
- Cross-IDE: users "Confirm or reject each terminal command" and "Review streamed edits as they appear and undo any you do not want" — [Using agent mode in your IDE](https://docs.github.com/en/copilot/how-tos/copilot-in-your-ide/use-copilot-agents/use-agent-mode)
- JetBrains edit mode: "Make controlled edits across multiple files that you review and accept individually"; "Review the changes and **Accept** or **Discard** the edits for each file"; edit mode "is only available in Visual Studio Code and JetBrains IDEs" — [Asking Copilot questions in your IDE](https://docs.github.com/en/copilot/how-tos/chat-with-copilot/chat-in-ide)
- JetBrains also offers a "Copilot CLI" agent (terminal-first, "multiple isolation modes") and cloud-sandbox sessions (public preview) where "Copilot makes code changes and runs commands and tests in the sandbox" — [Asking Copilot questions in your IDE](https://docs.github.com/en/copilot/how-tos/chat-with-copilot/chat-in-ide)

### Inferences
- "Streams the edits in the editor" plus "undo any you do not want" means the edit is applied before the user decides (apply-then-review). Whether JetBrains buffers are saved to disk before Accept is not stated; VS Code's docs say pending edits are "already saved to disk" (existing repo notes), and VS's wording "applies changes across your codebase" points the same way (inference).
- VS's "accept the proposed changes to commit them" is UI language, not a Git commit or a transactional commit.

### Gaps
- No JetBrains-specific doc on checkpoints, per-hunk Keep/Undo in agent mode, or whether pending edits are on disk. The JetBrains Marketplace page was not checked.
- VS docs do not say whether agent-mode edits are written to disk before Keep.

## Copilot coding agent (cloud agent): branch and pull request

### Takeaway
The cloud agent is review-then-merge: it pushes only to one `copilot/` branch (or the PR's branch), opens a draft PR it cannot mark ready, approve or merge, and Actions workflows wait for human approval by default. The PR is the closest thing in the Copilot family to a held copy of the whole task that a person commits in one step (the merge).

### Cited Findings
- "Copilot cloud agent only has the ability to push to a single branch"; otherwise "a new `copilot/` branch is created" — [Risks and mitigations for Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
- "Copilot cloud agent can only perform simple push operations. It cannot directly run `git push` or other Git commands" — [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
- "Draft pull requests created by Copilot cloud agent must be reviewed and merged by a human"; it "cannot mark its pull requests as 'Ready for review' and cannot approve or merge" — [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
- "By default, workflows are not triggered until Copilot cloud agent's code is reviewed" and a write-access user clicks **Approve and run workflows** (configurable) — [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
- The requester cannot approve the PR; an extra approval is required when the PR is under Copilot's app identity — [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
- Internet access is restricted by a firewall; each commit message links to session logs — [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
- On GitHub.com chat, "You can review the proposed changes and ask for refinements before creating a pull request"; in Actions-based and cloud-sandbox sessions Copilot "can only work on one branch at a time and can open one pull request per task" — [Copilot on GitHub.com and GitHub Mobile](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)
- Agent Merge ("Watch and fix") lets Copilot work on failed workflows or merge conflicts on a PR — [Copilot on GitHub.com and GitHub Mobile](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)

### Inferences
- A merge is atomic at the Git level (one commit or merge commit updates the base branch), so "confirm or reject the whole change" holds best here. The analogy still breaks for side effects during the run (network calls allowed through the firewall, MCP calls, approved workflow runs), which a rejected PR does not undo.
- The old `/en/copilot/concepts/agents/coding-agent/about-coding-agent` URL now serves the broader "Copilot on GitHub.com" page; the product is called "Copilot cloud agent" in current docs.

### Gaps
- Page dates for docs.github.com articles are not exposed by the API used; treat as "as fetched 2026-11-18".

## Comparison with other agents (brief, building on existing repo notes)

### Takeaway
Only Claude Code (VS Code extension, Manual mode) and Cline document a diff shown before the write with accept/reject; Copilot CLI and SDK carry the diff in the permission request; VS, JetBrains, VS Code's working set, Cursor and Zed apply first and review after. None is transactional across a task: every local product works per tool call or per file, and all exclude shell side effects from review.

### Cited Findings
- Claude Code VS Code, Manual mode: "it shows a side-by-side comparison of the original and proposed changes, then asks for permission. You can accept, reject, or tell Claude what to do instead"; per-change **Accept this change / Reject this change** (v2.1.275+); diffs over 100 changes open without per-change buttons — [Claude Code in VS Code](https://code.claude.com/docs/en/vs-code.md)
- Claude Code permission modes: `default` "Prompts for permission on first use of each tool" (labeled Manual); `acceptEdits` "Automatically accepts file edits and common filesystem commands" — [Claude Code permissions](https://code.claude.com/docs/en/permissions.md)
- Cline README: "In VS Code and JetBrains, every edit shows up as a diff you can review, modify, or revert"; in Act mode "Every file edit and terminal command requires your approval" unless auto-approve is on — [cline/cline README](https://github.com/cline/cline)
- Cline Auto Approve "is evaluated per tool call"; commands carry a model-set `requires_approval` flag, "not a fixed allowlist"; YOLO auto-approves everything — [Cline Auto Approve & YOLO Mode](https://docs.cline.bot/features/auto-approve.md)
- Cline's docs argue undo replaces confirmation: "Checkpoints make auto-approve practical" (vendor opinion) — existing notes, `docs/research/agent-ui/notes/agent-product-undo-patterns.md:64`
- VS Code working set: edits are "already saved to disk"; Keep "doesn't stage or commit them" — existing notes, `agent-product-undo-patterns.md:35–36`
- Cursor: checkpoints before significant changes; restore reverts files only — existing notes, `agent-product-undo-patterns.md:45–46`. `cursor.com/docs/agent/review.md` returns "Page not found"; `cursor.com/llms.txt` lists `agent-review.md` (post-hoc AI review) but no Keep/Undo diff page — fetched 2026-11-18. Cursor's Keep/Undo per-hunk UI remains undocumented in primary sources found.
- Zed: Review Changes multibuffer; "accept or reject each individual change hunk, or the whole set" — existing notes, `agent-product-undo-patterns.md:57`
- VS Code checkpoints "doesn't reverse completed terminal commands, network requests, deployments" — existing notes, `agent-product-undo-patterns.md:41`

### Inferences
- Classification by surface (as of November 2026):

| Surface | File edits | Shell commands | Task-level unit |
|---|---|---|---|
| Copilot CLI (manual mode) | Confirm-then-apply per tool call (diff implied by runtime payload) | Confirm by command text | `/diff`, `/rewind` per turn |
| Copilot CLI (`--allow-tool=write`, `/yolo`, session approval) | Apply-then-review | Apply (if allowed) | `/rewind` |
| Copilot SDK / runtime 1.0.109 | Host decides; request carries `diff`, `fileEdits` before/after | `fullCommandText` only | `history.rewind` (experimental, opt-in) |
| Copilot in VS Code (working set) | Apply-then-review (on disk, Keep/Undo) | Confirm | Checkpoints |
| Copilot in Visual Studio agent mode | Apply-then-review (Keep/Undo per chunk/file/all) | Confirm | Checkpoint Restore |
| Copilot in JetBrains agent mode | Apply-then-review (streamed, undo) | Confirm | Not documented |
| VS Copilot Edits / JetBrains edit mode | Proposal diff, accept/reject per chunk/file | n/a | Reset changes |
| Copilot cloud agent | Review-then-merge (draft PR) | Runs in sandbox; workflows wait for approval | Pull request |
| Claude Code VS Code (Manual) | Confirm-then-apply with side-by-side diff | Confirm | `/rewind` checkpoints |
| Cline (Act, no auto-approve) | Diff, approve per edit | Approve unless model flags safe and auto-approve on | Shadow-Git checkpoints |
| Cursor, Zed | Apply-then-review | Per settings | Cursor checkpoints; Zed Review Changes |

- Where the owner's hypothesis holds: the runtime behind Copilot CLI and the SDK does build the proposed edit (before/after text and a unified diff) before writing and waits for approval, so "has a copy … lets the user confirm or reject the diff" is accurate per tool call in manual mode. The cloud agent's draft PR is the one true "held copy of the whole task, committed in one step".
- Where it breaks:
  1. **Granularity**: the copy is one tool call on one file, not the whole task; multi-file changes are approved and applied piecemeal, and approving one call does not wait for the others.
  2. **Defaults drift**: session approvals, `--allow-all-tools`, `/yolo` and assisted permissions skip the confirm step; the IDEs apply first by design.
  3. **Shell commands**: the prompt shows a command, not its effect; edits made by `sed`, builds or scripts never pass through a diff preview (VS Code's working set and Claude Code checkpoints don't track them; Copilot CLI `/rewind` does track shell-command file changes per its reference).
  4. **External effects**: network calls, MCP tools, deployments, pushed commits are outside every rewind; plan mode explicitly lets MCP calls and indeterminate shell commands through.
  5. **Conflicts with user edits**: rewind skips files "you have since edited yourself" (`user-modified`) rather than merging, and no doc says the write checks that the file still matches the previewed `before`.
  6. **Atomicity**: rewind is "Not crash-atomic" with "no recovery journal"; restore failure can end in `rollback-incomplete`. Only a Git merge of the cloud agent's PR is atomic.

### Gaps
- Cline's docs site pages fetched do not describe the pre-write diff in detail; the claim rests on the README (primary, but marketing-adjacent).
- Zed: whether any pre-write confirmation exists for edits (vs only post-hoc review) was not re-checked.
- No vendor documents a multi-file "commit all held edits at once" for local agents.
