// The docs checks for the harness's README (../../scripts/package-docs.mjs): every TypeScript block in README.md type-checks,
// every block of more than five lines comes from a file in examples/, every export name it documents is in the
// declaration files, unstable names carry `experimental_`, and llms.txt is current.
//
//   node packages/harness/scripts/docs-check.mjs           fails on any problem, a stale llms.txt included
//   node packages/harness/scripts/docs-check.mjs --write   rewrites llms.txt first
//
// test/docs-check.test.ts runs the same checks under `pnpm test`.
import { fileURLToPath } from "node:url";
import { main } from "../../../scripts/package-docs.mjs";

export const PACKAGE_DIR = fileURLToPath(new URL("../", import.meta.url));

export const CONFIG = {
  globals: "scripts/readme-globals.ts",
  alsoNames: ["../protocol", "../sdk", "../gateway", "../agent-safety"],
  blocksFromExamples: true,
  // Prose names that look like exports but are not this package's: members, fields, variables and other packages' names.
  notExports: {
    InternalError: "an error code the protocol package exports",
    InvalidParams: "an error code the protocol package exports",
    QueueFull: "an error code the protocol package exports",
    Readable: "a Node stream class",
    Writable: "a Node stream class",
    connect: "a Dispatcher method",
    invokeTool: "a Harness method",
    delete: "a SessionStore method",
    read: "the secret reader callback `secretKeyStore()` takes",
    request: "an InProcessClient method",
    respond: "an InProcessClient method",
    ANTHROPIC_API_KEY: "an environment variable",
    AUTH: "part of a credential-like variable name",
    CONNECT: "an HTTP method",
    DATABASE_URL: "an environment variable",
    DOCKER_HOST: "an environment variable",
    FIXME: "a placeholder the diff flags",
    GIT_AUTHOR_NAME: "an environment variable",
    HOME: "an environment variable",
    HTTPS_PROXY: "an environment variable",
    KEY: "part of a credential-like variable name",
    LANG: "an environment variable",
    LD_PRELOAD: "an environment variable",
    Makefile: "a file name",
    NODE_OPTIONS: "an environment variable",
    NotOptedIn: "an ErrorCodes code of the protocol",
    PASSWORD: "part of a credential-like variable name",
    PAT: "part of a credential-like variable name",
    PATH: "an environment variable",
    SECRET: "part of a credential-like variable name",
    SIGKILL: "a signal",
    SIGTERM: "a signal",
    TMPDIR: "an environment variable",
    TODO: "a placeholder the diff flags",
    TOKEN: "part of a credential-like variable name",
    acquire: "a SessionLock method",
    checkout: "a Session method",
    decide: "a PermissionPipeline method",
    definitions: "a ToolRegistry method",
    dispose: "a Sandbox method",
    followUp: "a Run method",
    get: "a ToolRegistry method",
    head: "a Session method",
    list: "a SessionStore method",
    load: "a SessionStore and KeyStore method",
    loadRaw: "a store method",
    onMessage: "an InProcessClient method",
    path: "a Session method",
    provision: "a SandboxClient method",
    prune: "a key store method",
    register: "a ToolRegistry method",
    release: "a LockHandle method",
    resolve: "an approvals method",
    rotate: "a key store method",
    secrets: "an option of createApprovals()",
    setExposure: "a ToolRegistry method",
    steer: "a Run method",
    toContext: "a Session method",
  },
};

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(PACKAGE_DIR, CONFIG));
