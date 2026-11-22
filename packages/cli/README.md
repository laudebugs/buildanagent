# @buildanagent/cli

The CLI will run the buildanagent harness in a terminal as the `buildanagent` command: a one-shot mode that prints a run's events as JSON lines for scripts, and a line-mode chat that asks you before a call that needs approval.

As of November 2026 the package is private and not on npm, and its one export is its own name:

```ts
import { PACKAGE_NAME } from "@buildanagent/cli";

console.log(PACKAGE_NAME); // "@buildanagent/cli"
```

## The `buildanagent` command comes next

The command will also list, search and replay stored sessions, and it sends nothing off the machine unless you give it an OpenTelemetry endpoint. Until then, run the harness from code: the [harness README](https://github.com/laudebugs/buildanagent/blob/main/packages/harness/README.md) shows how.
