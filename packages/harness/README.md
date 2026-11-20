# @buildanagent/harness

The harness wraps the SDK's loop with what a coding agent needs around it: a session log, a context policy, tools, permissions, a sandbox and credentials. Nothing runs from it yet.

As of November 2026 the package is private and not on npm. Each removable component gets its own subpath, so a caller imports only what it uses and an ablation can drop the rest. Today every subpath is an empty stub that holds the component's place. The [harness plan](https://github.com/laudebugs/buildanagent/blob/main/docs/plans/build-harness.md) says what each package will hold and in which order.
