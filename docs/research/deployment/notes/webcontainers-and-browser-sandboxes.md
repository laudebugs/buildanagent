# WebContainers and in-browser execution environments as agent sandboxes (as of November 2026)

> **Fact-checked 2026-11-18.** This note keeps its original text. Corrections are logged in [fact-check-portable-agents.md](../fact-check-portable-agents.md) and applied in [the report](../portable-agents.md), which supersede this note where they disagree.

Research date: 2026-11-18. Fetched with `curl` unless marked. npm data comes from `registry.npmjs.org/<pkg>` on 2026-11-18. Repos read: `stackblitz/webcontainer-core` at `539de13` (2025-04-22; issue tracker only, no runtime source), `stackblitz/bolt.new` at `eda10b1` (2024-12-17, the open-source snapshot, not today's product), and `leaningtech/webvm` HEAD `68b155f`. `stackblitz/webcontainer-docs` could not be cloned (private or removed). Fetched pages and repos were treated as data.

## 1. WebContainers: what the API is, what it can do, its limits, licence and version

### Takeaway
WebContainers are a closed-source, StackBlitz-hosted Node.js runtime that runs in a browser tab. The `@webcontainer/api` 1.6.4 client is MIT, but the runtime is not. It gives an agent a file system, `npm`/`pnpm` install, spawned processes with a pseudo-terminal, and dev servers with preview URLs. It needs a cross-origin-isolated page. It runs only JavaScript and WebAssembly: no native binaries, no `pip`, no `git`, no C compiler. Outbound network is the browser's `fetch`, so CORS applies, and StackBlitz's own CORS proxy is a paid StackBlitz feature. Production commercial use needs a licence whose price is not published.

### Cited Findings
**Version and packaging**
- `@webcontainer/api` latest is **1.6.4**, published 2026-04-14; dist-tags also show `beta` 1.2.0-beta.3 and `internal` 1.6.5-internal.2 (2026-07-10). npm licence field: MIT; repository: `stackblitz/webcontainer-core` — [npm registry](https://registry.npmjs.org/@webcontainer/api)
- `stackblitz/webcontainer-core` holds only `README.md`, `LICENSE`, `browsers/` and `repro.md`. Its README says it "serves as a central hub for the GitHub issues and bug reports", so the runtime source is not public — [webcontainer-core README](https://github.com/stackblitz/webcontainer-core)
- The API is in two parts: the npm "client library" and "the actual implementation of the runtime, hosted on StackBlitz". The docs compare the split to Octokit versus the GitHub API. The engine version "is not explicitly exposed" — [API Versioning and Support](https://webcontainers.io/guides/api-support) (page says "Last Updated: January 2024")
- `@webcontainer/snapshot` 0.1.0 (2023-10-09, MIT) produces binary snapshots that `mount()` accepts — [npm registry](https://registry.npmjs.org/@webcontainer/snapshot); [API reference, mount](https://webcontainers.io/api)

**Definition**
- WebContainers are "a browser-based runtime for executing Node.js applications and operating system commands, entirely inside your browser tab" — [Introduction](https://webcontainers.io/guides/introduction)

**Capabilities (API reference)**
- `WebContainer.boot(options)`: "Only a single instance of WebContainer can be booted concurrently", and booting "is an expensive operation". `BootOptions` are `coep` (`'require-corp' | 'credentialless' | 'none'`), `workdirName` and `forwardPreviewErrors` — [API reference](https://webcontainers.io/api)
- `mount(tree | Uint8Array | ArrayBuffer, { mountPoint })` loads a file tree or a binary snapshot. `export(path, { format })` (added in 1.4.0) returns JSON or a zip — [API reference](https://webcontainers.io/api); [Changelog](https://webcontainers.io/changelog)
- `fs` offers readFile, writeFile, mkdir, readdir, rm, rename (1.1.6) and `watch` with `recursive` (1.1.8) — [API reference](https://webcontainers.io/api); [Changelog](https://webcontainers.io/changelog)
- `spawn(command, args, { cwd, env, output, terminal: { cols, rows } })` returns a `WebContainerProcess` with `exit: Promise<number>`, `input: WritableStream<string>` (the pseudo-terminal) and `output: ReadableStream<string>`, which merges stdout and stderr — [API reference](https://webcontainers.io/api)
- Events: `port` (port, open/close, url), `server-ready` (port, url), `error` and `preview-message` (forwarded uncaught exceptions, unhandled rejections and console.error from preview iframes) — [API reference](https://webcontainers.io/api)
- `setPreviewScript` (1.5.0) injects a script into every preview's HTML; `reloadPreview` (1.2.2) reloads a preview iframe — [API reference](https://webcontainers.io/api)
- `configureAPIKey(key)` (1.3.0) is for "commercial usage" and throws if called after `boot` — [API reference](https://webcontainers.io/api)
- `auth.init({ clientId, scope })` signs users in through StackBlitz so they can install their organisation's private npm packages — [API reference](https://webcontainers.io/api)
- The npm client is "Turbo". Without a `package-lock.json`, Turbo "first generates a fresh lockfile", which slows boot — [Troubleshooting](https://webcontainers.io/guides/troubleshooting)
- StackBlitz publishes "Runtime Test Cases for AI Agents" covering Node built-ins, child processes, npm/Yarn/pnpm, the CLI and frameworks such as Vite, and encourages running them on any runtime. This is vendor marketing — [AI agents test cases](https://webcontainers.io/guides/ai-agents)

**Shell and tools (as of the bolt.new snapshot, Dec 2024)**
- bolt.new's system prompt tells the model the shell "emulates zsh"; `python3` is "LIMITED TO THE PYTHON STANDARD LIBRARY ONLY" with "NO `pip` support"; "Git is NOT available"; there is no `g++`. Available commands include cat, cp, curl, jq, node, python3, wasm, xdg-open and others — [bolt.new prompts.ts](https://github.com/stackblitz/bolt.new/blob/main/app/lib/.server/llm/prompts.ts)

**Limits**
- Pages must send `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`, because WebContainer needs SharedArrayBuffer. A `credentialless` COEP mode is an alternative where browsers support it — [Configuring Headers](https://webcontainers.io/guides/configuring-headers)
- `coep: 'none'` "will only work on Chromium-based browsers as long as an Origin Trial is supported" — [API reference](https://webcontainers.io/api)
- Browser support ("Last update: October 2026"): supported "on desktop Chromium-based browsers out of the box"; Safari 16.4 TP and Firefox are in beta (the Firefox section says "alpha"). Firefox lacks the cross-origin isolation mode needed to embed arbitrary resources, so previews may need a separate window — [Browser Support](https://webcontainers.io/guides/browser-support)
- Each running project "has its own domain and needs to install a Service Worker for that domain". Third-party cookie or storage blocking (Chrome settings, Brave Shields) breaks this; the fix is exceptions for `*.stackblitz.io` and `*.webcontainer.io`. Edge's "Strict" security mode disables WebAssembly — [Browser Configuration](https://webcontainers.io/guides/browser-config)
- "WebContainers can only execute languages that are natively supported on the Web, including JavaScript and WebAssembly". Native addons are disabled via `--no-addons` — [Troubleshooting](https://webcontainers.io/guides/troubleshooting)
- Memory: several open projects can fail with `RangeError: WebAssembly.instantiate(): Out of memory: wasm memory` — [Troubleshooting](https://webcontainers.io/guides/troubleshooting). No documented numeric memory or storage limit was found.
- `boot()` must be called only once, even with HMR, or "Proxy has been released" errors follow — [Troubleshooting](https://webcontainers.io/guides/troubleshooting)

**Networking**
- In-browser dev environments "can only connect to hosts on your local network and are isolated from the rest of the web" unless an external site allows CORS, so "things as trivial as curl google.com fail" — [StackBlitz blog, CORS proxy (May 2024)](https://blog.stackblitz.com/posts/cors-proxy)
- StackBlitz's workaround: "if we detect a request is being made to an external host, we instead redirect this to a proxy". The proxy swaps the hostname and adds `X-StackBlitz-Host`, `X-StackBlitz-Origin` and `X-StackBlitz-User-Agent` headers. It needs a Personal+ or Teams subscription and `{ "corsProxy": true }` in `.stackblitzrc`. It is a StackBlitz-editor feature, and the post does not say whether it applies to API embedders — [StackBlitz blog, CORS proxy](https://blog.stackblitz.com/posts/cors-proxy)
- Preview URLs: a Service Worker on the project's domain intercepts requests and routes them to the server inside the WebContainer. This is a **secondary** explainer; the vendor docs confirm only the per-project domain and Service Worker — [Leapcell blog (secondary)](https://leapcell.io/blog/webcontainers-unleashed-running-node-js-natively-in-your-browser); [Browser Configuration](https://webcontainers.io/guides/browser-config)
- A **third-party** write-up says Node code in a WebContainer goes through the browser's fetch path, so CORS applies even to a Vite proxy — [omkarchebale blog (secondary)](https://omkarchebale.vercel.app/blogs/why-your-vite-proxy-fails-inside-webcontainer-and-how-to-actually-fix-it)

**Vendor claims (marketing, not verified)**
- "Unmatched security: everything is contained in a browser tab"; "Fast: spinning up the entire dev environment in milliseconds"; "Always free for Open Source"; "No risk of bad actors" — [Introduction](https://webcontainers.io/guides/introduction)
- The AI page pitches a "Secure agent runtime": "Give them a browser sandbox to install packages, write files, and execute code, with no VMs to manage" — [webcontainers.io/ai](https://webcontainers.io/ai)

**Licensing and pricing**
- "Licensing is required for production usage of the API in a commercial, for-profit setting. (Prototypes or POCs do not require a commercial license.)" It applies when serving "customers, prospective customers, and/or employees" — [Commercial Usage](https://webcontainers.io/enterprise)
- Enterprise adds self-hosted, on-premises and VPC installs, private npm registries, SAML2 SSO and priority support. No price is published: "Contact us ... to learn more about our pricing" — [Commercial Usage](https://webcontainers.io/enterprise)
- `webcontainers.io/pricing` returned 404 on 2026-11-18. Aggregators list the commercial licence as "Custom/contact" (**secondary**) — [aicoolies (secondary)](https://aicoolies.com/pricing/webcontainers)

### Inferences
- "MIT" on npm covers only the thin client. The runtime is proprietary, loaded from StackBlitz's origins, and runs under StackBlitz's Terms of Service. A harness backend would therefore depend on a third-party CDN and on licence terms that change by contract.
- The single-instance rule means one sandbox per tab. Parallel sub-agent sandboxes in one tab need several tabs or iframes, if that works at all (unverified).
- No `git` and no `pip` rule out our repo's own workflow (`pnpm`, git, Biome's native binary) unless Wasm builds replace them. Biome ships as a native binary; whether a Wasm build runs in WebContainers is unverified.

### Gaps
- No primary source gives memory or storage limits, quotas, or persistence of the file system across reloads.
- No primary source documents raw TCP from WebContainers (for example a Postgres client). The CORS post implies no.
- No published commercial price; `webcontainers.io/pricing` is 404. The current Terms of Service text was not fetched.
- No independent benchmark of boot time or install speed was found.
- Whether StackBlitz's CORS proxy is available to third-party API users (not the editor) is not documented.

## 2. How agent products use WebContainers: bolt.new and others

### Takeaway
In bolt.new, the model call and the API key stay on the server (a Remix app on Cloudflare). The server streams text with `<boltArtifact>`/`<boltAction>` tags, and the browser parses them and applies `file` and `shell` actions to the WebContainer. The agent "loop" is therefore a one-shot stream; it is not a tool-calling loop. The tab executes; the server thinks.

### Cited Findings
- bolt.new (open-source snapshot, MIT, © 2024 StackBlitz) says it gives "AI models complete control over the entire environment including the filesystem, node server, package manager, terminal, and browser console" — [bolt.new README](https://github.com/stackblitz/bolt.new)
- The API key is read on the server: `getAPIKey` returns `env.ANTHROPIC_API_KEY || cloudflareEnv.ANTHROPIC_API_KEY` in `app/lib/.server/llm/api-key.ts` — [api-key.ts](https://github.com/stackblitz/bolt.new/blob/main/app/lib/.server/llm/api-key.ts)
- The chat route is a Remix action on `@remix-run/cloudflare` that calls `streamText` with `toolChoice: 'none'`, and continues the stream up to `MAX_RESPONSE_SEGMENTS` when it hits the token limit — [api.chat.ts](https://github.com/stackblitz/bolt.new/blob/main/app/routes/api.chat.ts)
- Actions are typed `'file' | 'shell'`. The client runs shell actions with `webcontainer.spawn('jsh', ['-c', action.content])` and file actions with `webcontainer.fs.mkdir` and `fs.writeFile` — [types/actions.ts](https://github.com/stackblitz/bolt.new/blob/main/app/types/actions.ts); [action-runner.ts](https://github.com/stackblitz/bolt.new/blob/main/app/lib/runtime/action-runner.ts)
- The snapshot pins `@webcontainer/api` `1.3.0-internal.10` and boots with `WebContainer.boot({ workdirName: WORK_DIR_NAME })` — [package.json](https://github.com/stackblitz/bolt.new/blob/main/package.json); [webcontainer/index.ts](https://github.com/stackblitz/bolt.new/blob/main/app/lib/webcontainer/index.ts)
- The prompt steers the model away from native code: "prefer libsql, sqlite, or other solutions that don't involve native code" — [prompts.ts](https://github.com/stackblitz/bolt.new/blob/main/app/lib/.server/llm/prompts.ts)
- 2026 product changes come only from **secondary** sources: "Standard" and "Max" agents replaced model choice in May 2026; the v1 agent was retired on 3 August 2026; "Bolt Cloud" adds databases, auth and hosting — [search summary of Sacra, Morph and review sites (secondary)](https://www.morphllm.com/bolt-vibe-coding). Not confirmed from a primary source.
- webcontainers.io's community list includes Otto Engineer, re:tune, the SvelteKit and Angular tutorials, StackBlitz Codeflow and the builder.io playground. AI use cases named: data annotation, AI evaluation and debugging, generative UI and a secure agent runtime — [Introduction sidebar](https://webcontainers.io/guides/introduction); [webcontainers.io/ai](https://webcontainers.io/ai)
- WebVM (CheerpX-based) has a built-in "Claude AI Integration" in which the user pastes their own Anthropic key, "only stored locally in your browser". That is the opposite pattern: key and loop both in the page — [WebVM README](https://github.com/leaningtech/webvm)
- BrowserPod markets running "AI coding CLIs in-browser without modification (e.g., Claude Code, Codex)" — [BrowserPod README (npm 4.1.0)](https://unpkg.com/browserpod@4.1.0/README.md)

### Inferences
- bolt.new's split (server-side model plus server-held key, browser-side execution, results visible to the user) is the reference shape. Because the snapshot uses `toolChoice: 'none'`, command output does not flow back to the model inside a turn; the next user message carries the context. A tool-calling agent needs a return channel from the tab to the server. Today's closed product may differ.
- Two key patterns exist: the server holds the key (bolt.new), or the user brings their own key and stores it in the browser (WebVM). Only the first suits a multi-user product.

### Gaps
- No primary source on today's bolt.new architecture (post-2024 closed source): whether tool results return to the model, and what Bolt Cloud runs server-side.
- No list of other AI coding products on WebContainers beyond the vendor's community page.

## 3. Alternatives in the browser (one line each: capability and licence)

### Takeaway
The field splits three ways. JS and Node runtimes: WebContainers, Nodebox, BrowserPod. Language interpreters in Wasm: Pyodide, JupyterLite, QuickJS. Full x86 Linux emulation: CheerpX/WebVM, v86. Most capable runtimes carry restrictive or attribution licences; the permissive ones (Pyodide, QuickJS, v86, JupyterLite) do less. BrowserPod changed in November 2026 to a free-for-any-use licence with attribution.

### Cited Findings
- **CodeSandbox Nodebox** `@codesandbox/nodebox` 0.1.9 (last published 2023-11-29): a Node.js-compatible runtime (not emulation) for Chrome, Firefox and Safari (iOS beta). Limits: no N-API modules, no `net` sockets to external IPs, no synchronous exec/spawn. Licence: **Sustainable Use License 1.0**, use "only for your own internal business purposes or for non-commercial or personal use" — [Nodebox README and LICENSE (npm)](https://unpkg.com/@codesandbox/nodebox@0.1.9/README.md); [npm registry](https://registry.npmjs.org/@codesandbox/nodebox)
- **Sandpack** `@codesandbox/sandpack-client` 2.19.8 (2024-09-12) and `sandpack-react` 2.20.0 (2025-02-14), Apache-2.0: an in-browser bundler and preview component that uses Nodebox for server-side templates — [npm registry](https://registry.npmjs.org/@codesandbox/sandpack-react). The Sandpack Nodebox docs page returned "Page not found" on 2026-11-18. The npm dates suggest slow maintenance (inference).
- **BrowserPod** (Leaning Technologies) `@leaningtech/browserpod` 4.1.0 (2026-11-17): "a Linux-like kernel in WebAssembly" with Node.js 22, Rust tools, git, bash, npm and pnpm; Python is a preview and Go is "coming soon". The file system persists in IndexedDB or OPFS. Network goes through the page's `fetch()` (CORS applies); the paid-tier **Edge** service adds Portals (public preview URLs), TCP and CORS-free egress "under an allowlist". Needs COOP/COEP. Licence: **BrowserPod Community Licence 1.0, effective 13 November 2026**, "free for any use — personal, commercial and production — as long as you credit it". The runtime must be loaded from their CDN; self-hosting needs an Enterprise Licence — [BrowserPod README, AGENTS.md, LICENSE.txt (npm 4.1.0)](https://unpkg.com/browserpod@4.1.0/LICENSE.txt); [docs index](https://browserpod.io/docs/llms.txt). (Earlier terms were non-commercial plus Enterprise — [BrowserPod announcement](https://labs.leaningtech.com/blog/browserpod-annoucement), from a search summary.)
- **CheerpX** `@leaningtech/cheerpx` 1.4.0 (2026-10-07): "Run X86 binary applications and libraries in the browser" through an x86-to-Wasm JIT. Proprietary licence: individuals may use it for any purpose, and businesses "strictly for the purpose of technical evaluation and testing" without a Commercial Licence — [CheerpX LICENSE.txt](https://unpkg.com/@leaningtech/cheerpx@1.4.0/LICENSE.txt)
- **WebVM**: runs "an unmodified Debian distribution including many native development toolchains" on CheerpX. Networking goes through Tailscale (exit node for the internet); no ICMP. The repo is Apache-2.0, but the public CheerpX build is free only for individuals, and "Any other use by organizations ... requires a license" — [WebVM README](https://github.com/leaningtech/webvm)
- **v86** 0.5.473 (2026-10-30), BSD-2-Clause: "x86 PC emulator and x86-to-wasm JIT, running in the browser" — [npm registry](https://registry.npmjs.org/v86)
- **Pyodide** 314.0.8 (2026-11-13), MPL-2.0: CPython in Wasm. `multiprocessing`, `threading` and `sockets` "can be imported, but are not functional". The `ssl` module is a stub; network calls "are done via the browser", so CORS applies — [npm registry](https://registry.npmjs.org/pyodide); [Pyodide Python compatibility](https://pyodide.org/en/stable/usage/wasm-constraints.html). Subprocess and `os.system` do not work — [pyodide-build migration guide (via search summary)](https://pyodide-build.readthedocs.io/en/latest/how-to/migrate.html)
- **JupyterLite** `@jupyterlite/server` 0.8.7 (2026-10-30), BSD-3-Clause; the npm description now says "DEPRECATED: Use @jupyterlite/apputils instead". A Jupyter front end with Pyodide-based kernels in the browser — [npm registry](https://registry.npmjs.org/@jupyterlite/server)
- **QuickJS in Wasm** `quickjs-emscripten` 0.32.0 (2026-02-16), MIT. hashbrown 0.8.3 runs model-written JS in a fresh QuickJS context per call, with no `window`, `document` or `fetch`, and a deadline that "does not roll back a host side effect or impose a memory limit" — [npm registry](https://registry.npmjs.org/quickjs-emscripten); [our hashbrown report](../../../research/agent-ui/hashbrown.md)
- **Wasmer** `@wasmer/sdk` 0.19.1 (2026-10-07): "A portable, package-first sandbox SDK powered by Wasmer" (WASI/WASIX packages, in the browser and elsewhere). Licence: "Modified MIT License", which requires a visible "Wasmer" credit above 1 million MAU or $1M monthly revenue — [npm registry](https://registry.npmjs.org/@wasmer/sdk); [LICENSE](https://unpkg.com/@wasmer/sdk@0.19.1/LICENSE)
- `@bjorn3/browser_wasi_shim` 0.4.2 (MIT OR Apache-2.0) is a minimal WASI shim for running WASI binaries in the browser — [npm registry](https://registry.npmjs.org/@bjorn3/browser_wasi_shim)

### Inferences
- For a coding agent on this repo's stack (Node 22, pnpm, git), BrowserPod is the only in-browser option that ships Node 22 together with git and pnpm. WebContainers lacks git; Nodebox lacks spawn and install fidelity. This rests on vendor claims only; nothing here was tested.
- x86 emulation (CheerpX, v86) gives the widest compatibility, but with JIT overhead (unmeasured here) and, for CheerpX, a business licence.

### Gaps
- Wasmer's browser capabilities (threads, networking, which packages run) were not read from its docs, only the package description.
- No benchmarks comparing boot time, install time or memory across these runtimes.
- CodeSandbox's ownership and Nodebox's maintenance status were not confirmed; the npm dates are the only evidence.

## 4. Security model: the browser as the isolation boundary

### Takeaway
The isolation boundary is the browser's process sandbox plus the same-origin policy. Code in the tab cannot reach the user's disk, shell or other origins' cookies. It can still reach anything the page's origin can reach with `fetch` under CORS, and anything that page holds. So no secret may sit in the page. Exfiltration by injected code is limited by CORS and COEP, not removed: any CORS-permissive endpoint, or a vendor egress proxy, is an open channel unless an allowlist gates it.

### Cited Findings
- WebContainers' only egress is browser fetch under CORS; StackBlitz's CORS proxy opens arbitrary hosts — [StackBlitz CORS proxy blog](https://blog.stackblitz.com/posts/cors-proxy)
- BrowserPod states the boundary plainly: "BrowserPod runs directly in the browser, inheriting its security boundary". Its Edge egress is "under an allowlist", and custom allowlists need Edge Pro. It warns that Edge "Keys are visible to visitors of a public page: restrict the key's allowed origins" — [BrowserPod README and AGENTS.md (npm 4.1.0)](https://unpkg.com/browserpod@4.1.0/AGENTS.md)
- COEP `require-corp` blocks cross-origin resources without CORP/CORS headers on the page — [BrowserPod AGENTS.md](https://unpkg.com/browserpod@4.1.0/AGENTS.md); [Configuring Headers](https://webcontainers.io/guides/configuring-headers)
- WebContainer previews run on a separate per-project origin with their own Service Worker — [Browser Configuration](https://webcontainers.io/guides/browser-config)
- `setPreviewScript` lets the host page inject a script into every preview's HTML. That gives the embedder (and anything that controls it) code execution in preview origins — [API reference](https://webcontainers.io/api)
- bolt.new keeps `ANTHROPIC_API_KEY` server-side — [api-key.ts](https://github.com/stackblitz/bolt.new/blob/main/app/lib/.server/llm/api-key.ts). WebVM instead stores the user's own key in browser storage — [WebVM README](https://github.com/leaningtech/webvm)
- Our harness guide rates "WASM alone (Pyodide interpreters)" as **weak: host functions are the attack surface** (based on an un-refetched Cyera citation) — [harness guide §6](../../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both)
- hashbrown's realistic risk is "an over-broad host function, whose handler runs outside the sandbox and unvalidated, rather than a WASM escape" — [our hashbrown report](../../../research/agent-ui/hashbrown.md)
- `auth.init` gives a WebContainer the signed-in user's private npm access — [API reference](https://webcontainers.io/api)

### Inferences
- What injected code in the tab can reach: the in-tab file system (the user's project), any CORS-permissive internet endpoint, the vendor's proxy if enabled, private registry tokens if `auth` is used, and whatever JS APIs the embedding page exposes to the runtime. It cannot reach the host disk, local processes, or `localhost` services unless the user enables a localhost bridge (StackBlitz has one; not researched here).
- Exfiltration paths after a prompt injection: (a) `fetch` to any CORS-open endpoint (many APIs and paste services allow `*`); (b) preview iframes loading attacker URLs, which COEP limits; (c) the vendor CORS or Edge proxy, which is effectively open egress; (d) the agent's next model call. Rendering markdown images in the chat UI is a classic channel, and it sits outside the sandbox.
- "No credentials inside the sandbox" maps cleanly: the model key, approval-signing keys and the session log stay server-side. Any per-user API token a tool needs must go through a server-side proxy route, the HD15 sentinel pattern, never into the tab.
- The browser boundary is strong against a hostile *process* escaping to the host, since browser sandboxes are heavily hardened (general knowledge, not cited here). It is weak against *exfiltration*, because egress is not default-deny. In our `stops` vocabulary: `hostile_process` yes for the host machine (inference), `exfiltration` only with an allowlisting egress proxy, `mistakes` yes for the host but not for the in-tab project.

### Gaps
- No primary source on WebContainers' own threat model, security audit, or whether the runtime can restrict `fetch` targets per instance (no such boot option is documented).
- No published prompt-injection incident involving bolt.new or WebContainers was found.

## 5. Fit with this repo's harness plan (`SandboxClient`, N15–N19, credential boundary)

### Takeaway
A browser backend can implement the shape of `Sandbox` (`exec`, `readFile`, `writeFile`, `dispose`), but not `SandboxClient`'s assumption that the host launches and owns the sandbox. The sandbox lives in a user's tab, which the server cannot provision, keep alive, or trust to report results honestly. It fits only as a **relayed** backend: the agent loop stays on the server, and tool calls go to the tab over the protocol's existing server-to-client `tool/call` request. The alternative is to move the whole loop into the browser and keep only a server-side model proxy. Neither satisfies `SandboxPolicy` as written; network allowlisting and `writeRoots` cannot be enforced in WebContainers.

### Cited Findings
- Our interface: `SandboxClient { tier: "none" | "os" | "container" | "gvisor" | "microvm"; stops: ("mistakes" | "exfiltration" | "hostile_process")[]; provision(manifest, policy): Promise<Sandbox> }` throws `SandboxUnavailableError`. `Sandbox` has `exec(command: string[], { cwd, env, signal, timeoutMs })`, `readFile`, `writeFile` and `dispose`. `SandboxPolicy` is `{ readRoots, writeRoots, network: { allow, deny } }` — [build-harness.md §3.4](../../../plans/build-harness.md#34-permission-approval-and-sandbox-apis)
- The conformance suite: writes outside `writeRoots` are denied, network is denied unless allowlisted, the environment holds only `spawnEnv` names, and an unavailable backend throws rather than running unsandboxed — [build-harness.md §5 (conformance)](../../../plans/build-harness.md)
- N15 defines the interface, `none`, `fakeSandbox` and `runSandboxConformance`; N16 is `srt`; N17 is Docker; N18 is escalation ("No tool parameter or model output that can request a wider sandbox"); N19 measures cold start and per-call overhead — [N15](../../../todos/done/N15-sandbox-interface.md); [N16](../../../todos/done/N16-srt-backend.md); [N17](../../../todos/done/N17-docker-backend.md); [N18](../../../todos/done/N18-sandbox-escalation.md); [N19](../../../todos/ready/N19-sandbox-measurement.md)
- Hosted microVMs and gVisor are planned as adapters "chosen by threat model", and the interface "leaves room for them" — [build-harness.md §1](../../../plans/build-harness.md)
- The harness guide: "the host launches the sandbox outside the process the model drives"; egress is a default-deny proxy, and model gateway keys stay outside the sandbox — [harness guide §6](../../../guides/agent-harness.md#6-the-sandbox-and-the-credential-boundary-are-separate-components-and-the-host-not-the-model-owns-both)
- The protocol (HD6) already has the server send a `tool/call` request to the client, beside `approval/request` and `clarification/request` — [build-harness.md HD6](../../../plans/build-harness.md)
- WebContainers `spawn(command, args, { cwd, env, terminal })` has no timeout or abort option; processes expose `exit` and `kill()` is not shown in the fetched reference (gap). The `output` stream merges stdout and stderr — [API reference](https://webcontainers.io/api)
- bolt.new runs shell actions as `jsh -c <string>` — [action-runner.ts](https://github.com/stackblitz/bolt.new/blob/main/app/lib/runtime/action-runner.ts)

**Operation mapping (inference, grounded in the API reference above)**

| Our op | WebContainers | BrowserPod | Notes |
| --- | --- | --- | --- |
| `provision(manifest, policy)` | `WebContainer.boot()` + `mount(tree)` | `BrowserPod.boot({ network, storageKey })` + file writes | Only the tab can call it; the server can only ask. One WebContainer per tab |
| `exec(argv, {cwd, env})` | `spawn(argv[0], argv.slice(1), {cwd, env})` | `pod.run(exe, args, { terminal })` | No separate stdout/stderr in WebContainers (single `output` stream); `signal`/`timeoutMs` must be emulated client-side |
| `readFile` / `writeFile` | `fs.readFile` / `fs.writeFile` | `openFile` / `createFile` | Maps directly |
| `dispose` | `teardown()` | not checked | Maps |
| `readRoots` / `writeRoots` | none (whole in-tab FS writable) | none documented | Conformance test fails; only the tab's FS is at risk |
| `network.allow/deny` | none; browser CORS only | Edge allowlist (paid tier for custom lists) | Conformance test fails for WebContainers |
| `spawnEnv` | `env` option; no host env to inherit | n/a | Trivially satisfied: no host secrets exist in the tab |
| `tier` / `stops` | no fitting tier value | — | Needs a new tier, e.g. `"browser"`, with `stops: ["hostile_process"]` for the host, by inference |
| `SandboxUnavailableError` | unsupported browser, missing COOP/COEP, cookie blockers, no tab connected | same | Fail-closed is natural: no tab, no exec |

### Inferences
- **Architecture A, server loop with a relayed tab executor (recommended if pursued).** The harness keeps the loop, permissions, approvals, session log and keys. A `browserSandbox()` client's `provision` waits for a connected client advertising a sandbox capability. `exec` and the file ops become `tool/call`-style JSON-RPC requests to the tab, and results come back as responses. Costs: (1) the user's tab must stay open, which breaks HD4's headless and eval runs, so it is interactive-only; (2) results are **untrusted input**, because the user, or code in the tab, can forge them; that is acceptable for a user's own project but means `completion_check` (HD10) cannot be graded in the tab for evals; (3) latency per call is a network round-trip; (4) cancellation needs a `$/cancelRequest` path to the tab.
- **Architecture B, whole loop in the browser with a server-side model proxy.** The SDK loop runs in the page; a server endpoint holds the API key, meters cost, and enforces budget (HD9) and rate limits per user. This is the hashbrown and WebVM shape. It moves the permission pipeline, approval signing and session log into the client, which conflicts with HD5 (host-only key ring) and with "the host, not the model, owns" the sandbox; the user's browser becomes the host. It suits a demo or playground, not this harness's design.
- **bolt.new's actual shape is a degenerate A:** the server streams actions and the tab applies them, with no result returning inside the turn. Our A adds the return path the tool loop needs.
- A browser backend gives no protection that matters to the *user* against a confused agent deleting their in-tab project. It mainly protects *our servers and the user's machine*, and costs us no compute. Its value proposition is cost and latency, not isolation strength.
- Licensing makes WebContainers a poor default for us: a commercial product needs a quote-only licence and a closed runtime on StackBlitz's CDN. BrowserPod's November 2026 Community Licence (free with attribution, CDN-loaded) is the lower-friction candidate. Both create a third-party runtime dependency the repo's pinning rules cannot pin (the runtime is fetched from the vendor at boot; only the client is on npm).
- Conformance would need a declared exception: a browser tier cannot pass "writes outside `writeRoots` denied" or "network denied unless allowlisted" (WebContainers). So the backend must either declare narrower `stops` and be refused by policies that require them, or not be offered. That matches the guide's "honest tiers" rule.
- N19-style measurement would need a headless browser (Playwright) driving the tab, plus COOP/COEP serving; that is not in the current plan.

### Gaps
- Whether `WebContainerProcess` exposes `kill()` and `resize()` was not confirmed from the fetched reference text (truncated in my extraction).
- Whether several WebContainers can run in separate iframes of one page (parallel sandboxes) is undocumented.
- No source on running WebContainers or BrowserPod headless (Playwright or Puppeteer) for CI or evals, or on its licensing for that use.
- BrowserPod's API reference pages (`run`, `boot`, `storageKey`, any kill/timeout) were listed but not read.
