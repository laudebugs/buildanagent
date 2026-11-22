# @buildanagent/harness

The harness wraps the SDK's loop with what a coding agent needs around it: a session log, a context policy, tools, permissions, a sandbox and credentials. No loop runs from it yet.

As of November 2026 the package is private and not on npm. Each removable component gets its own subpath, so a caller imports only what it uses and an ablation can drop the rest. Today only `session` holds anything, the entry types it re-exports from the protocol package, and every other subpath is an empty stub that holds the component's place. The [harness plan](https://github.com/laudebugs/buildanagent/blob/main/docs/plans/build-harness.md) says what each package will hold and in which order.

## The session log holds eighteen entry types

`@buildanagent/harness/session` re-exports the entry union from `@buildanagent/protocol`, where the [stable fields and the JSON Schema](../protocol/README.md#a-session-file-is-a-list-of-entries-one-per-line) are documented. Every entry carries `id`, `parentId`, `seq`, `timestamp`, `type` and `origin`. The types, in the order of the union:

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
- `shadow_call`: a call that shadow mode recorded and did not run.
- `product_record`: a record the product owns, under a namespaced name.
