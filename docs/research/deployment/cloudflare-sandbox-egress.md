# Cloudflare Sandbox 1.0 sends no HTTPS without a Worker in the middle, so N46b must intercept TLS or route each client

**Plain allowlisted HTTPS fails on Cloudflare without interception, so the default needs a ruling too: N46b should intercept TLS for each allowed host with a handler that checks the host, at the cost of one trust step per container and one environment variable per Node process.** A reverse-proxy route over plain HTTP is the fallback that needs no CA.

N46b, the Cloudflare sandbox backend, waits on one question: how does an allowlisted HTTPS request leave a Cloudflare sandbox, and where can a credential be added outside it? Its first design compiled `EgressPolicy` to `enableInternet = false`, `allowedHosts` and `outboundByHost`, and `@cloudflare/sandbox` 1.0 removed all three ([Move outbound rules][migrate]). On SDK 0.x, every HTTPS request failed with internet off and no interception ([browser-use fact-check][bu-fc], rows 112, 114 and 117). [ADR 0060](../../decisions/0060-sandboxes-hold-no-credentials-by-default.md) narrowed the owner's ruling to TLS interception for the opt-in credential route, unless plain allowlisted HTTPS also needs it. This note records todo [N50](../../todos/done/N50-cloudflare-sandbox-egress.md)'s live run on 2026-11-28, which answers that question on a real sandbox.

## The run used one workers.dev Worker, the smallest instance and a dummy credential

The run used the one Cloudflare account that the owner approved for it on 2026-11-28, and created only resources named `n50-egress-test-20261128…`. The same day it deleted the Worker, the container application and the image, and checked each by listing; it could not list the Durable Object namespace, because wrangler has no command for it. The [scratch project](cloudflare-sandbox-egress-run/) holds the harness and every record. It sits outside the pnpm workspace, so the weekly SDK updates never treat it as a `verify/*` harness.

- **Versions, as of November 2026.** `@cloudflare/sandbox` 1.0.3 (published 2026-10-22), wrangler 4.160.1 (2026-11-11, the repo's pin), `@cloudflare/workers-types` 5.20261116.1 and TypeScript 7.0.2, all over a week old on 2026-11-28 ([package.json](cloudflare-sandbox-egress-run/package.json)). The Worker used compatibility date `2026-11-01` with `nodejs_compat`.
- **Container.** The `durable_object` scheduling policy, with one Durable Object name, so at most one container ran at a time. Each case started a fresh `lite` instance (1/16 vCPU, 256 MiB) and destroyed it at the end ([Containers limits][limits]). That policy rejects `max_instances`, so the harness kept the count at one itself ([Replace the Sandbox class][replace]).
- **Image.** `node:24.20.0-trixie-slim` pinned by digest, the source of Cloudflare's managed `cloudflare/debian-trixie` image ([image management][images]), plus `ca-certificates`, curl 8.14.1 and Git 2.47.3, and the `sandbox-shim` from `cloudflare/sandbox:1.0.3` that `Files` needs ([Dockerfile](cloudflare-sandbox-egress-run/container/Dockerfile)). Node was 24.20.0 and npm 11.19.0.
- **Environment.** `scripts/wrangler.mjs` spawned wrangler with an allowlisted environment, but it passed the real `HOME`, an exception to AGENTS.md's temp-`HOME` rule. Wrangler's OAuth login and Docker's configuration both live under `HOME`, and the owner approved using that login. A rerun should give wrangler a temp `HOME`, point `DOCKER_CONFIG` at a copy that holds only what the build needs, and pass a `CLOUDFLARE_API_TOKEN` scoped to Workers and Containers on this account instead of the login.
- **Credential.** A dummy token, `n50-dummy-token-not-a-secret`. The Worker's own `/echo` route reports whether a request carried it. No real credential entered the sandbox, the repo or a log.

Each case is one JSON record under [`results/`](cloudflare-sandbox-egress-run/results/), with every command, its exit code, stdout and stderr verbatim and the code version that ran it. The records replace the account id and the workers.dev subdomain with placeholders.

## Five results answer N50's five cases

| Case | Result | Evidence |
| --- | --- | --- |
| (a) HTTPS to an allowlisted host, internet off, no interception | **Fails**, as expected | [a-http-only-intercepts](cloudflare-sandbox-egress-run/results/a-http-only-intercepts.json), [a-no-intercepts](cloudflare-sandbox-egress-run/results/a-no-intercepts.json) |
| (b) Per-host `interceptOutboundHttps()` with the CA trusted, credential added outside | **Passes** for curl, Git, Node `fetch` and `npm install`, each with its own trust step | [b-per-host-https](cloudflare-sandbox-egress-run/results/b-per-host-https.json) |
| (c) A denied host fails closed | **Passes**: no answer, a timeout or a reset, never a response | [cd-per-host-denied-and-internal](cloudflare-sandbox-egress-run/results/cd-per-host-denied-and-internal.json), [c-star-intercept](cloudflare-sandbox-egress-run/results/c-star-intercept.json) |
| (d) Loopback and cloud metadata addresses | **Passes**: metadata resets, and loopback reaches only the container itself | [cd-per-host-denied-and-internal](cloudflare-sandbox-egress-run/results/cd-per-host-denied-and-internal.json), [d-internet-on](cloudflare-sandbox-egress-run/results/d-internet-on.json) |
| (e) The 128-entry limit, and one wildcard for many hosts | **Passes, with one difference from the docs**: the 65th hostname fails as documented, but the 130th IP target fails, not the 129th; a glob covers every subdomain | [e-limit-hostnames](cloudflare-sandbox-egress-run/results/e-limit-hostnames.json), [e-limit-ips](cloudflare-sandbox-egress-run/results/e-limit-ips.json), [e-wildcard](cloudflare-sandbox-egress-run/results/e-wildcard.json) |

The run added a sixth case, [a-reverse-proxy-routes](cloudflare-sandbox-egress-run/results/a-reverse-proxy-routes.json), because case (a)'s failure raised a question: can the default reach HTTPS hosts without a CA? It can, through plain-HTTP routes to the Worker, but only for clients that are configured to use them.

### (a) Without an HTTPS intercept, an allowed name resolves but its port 443 leads nowhere

The first case rebuilt SDK 0.x's `allowedHosts` without `interceptHttps`: `interceptOutboundHttp()` for `registry.npmjs.org` and `github.com`, and internet off. DNS answered with placeholder addresses, `fd00::119:1` and `11.9.0.1`, and plain HTTP reached the handler, which got the registry's `301`. HTTPS to the same name went nowhere, because no intercept handles port 443:

```txt
curl: (28) Connection timed out after 20002 milliseconds
error fetch failed UND_ERR_CONNECT_TIMEOUT Connect Timeout Error (attempted addresses: fd00::119:1:443, 11.9.0.1:443, timeout: 10000ms)
```

`npm view` and `git ls-remote` over HTTPS ran until their 60- and 30-second `timeout` wrappers killed them (exit 124), and no CA file existed. With no intercept at all, the name didn't resolve: `getent` timed out after 15 seconds, and curl reported `Resolving timed out after 20001 milliseconds`. An IP address failed too, with a connect timeout. So no HTTPS request leaves a sandbox that starts with internet off unless the Worker terminates its TLS. Fact-check row 112's finding, made on 0.x, holds on 1.0 ([browser-use fact-check][bu-fc], row 112).

### (a) A plain-HTTP route to the Worker reaches HTTPS hosts with no CA

The extra case registered `interceptOutboundHttp()` for three made-up names, such as `registry.n50.internal`. Each name's handler sent the request on over HTTPS to one real origin, and only `echo.n50.internal` added the dummy token. This route has the same shape as HD15's local reverse-proxy route ([harness plan, HD15][hd15]). Every client worked without a CA, once it was told to use the route:

| Client | Configuration | Result |
| --- | --- | --- |
| curl | the route's URL | `200`, the registry's JSON |
| Node `fetch` | the route's URL | `status 200` |
| npm | `--registry=http://registry.n50.internal/` | `is-number@7.0.0` installed |
| Git | `url.http://github.n50.internal/.insteadOf https://github.com/` | cloned `octocat/Hello-World` at `7fd1a60` |
| credential route | `http://echo.n50.internal/echo` | `"tokenOk":true` |

The sandbox held no CA file (`No such file or directory`). npm's lock file still recorded `https://registry.npmjs.org/is-number/-/is-number-7.0.0.tgz`. HTTPS to the registry had no intercept, so npm must have rewritten that tarball URL to the route. An HTTPS request to a route name timed out, and a request to a route name that sent another `Host` header was reset. A route therefore covers only the clients that can be pointed at it. Code that opens `https://api.example.com` itself still fails.

### (b) Per-host HTTPS interception works once each client trusts the per-container CA

Case (b) registered `interceptOutboundHttps()` for `registry.npmjs.org` and `github.com` with an `Allow` handler, and for the echo host with an `Inject` handler. It registered them before `start()`, as the Containers page requires ([Handle outbound traffic][outbound]). The CA appeared at `/etc/cloudflare/certs/cloudflare-containers-ca.crt`, a 648-byte certificate named `CN=Cloudflare TLS proxy-everything Intercept CA`. It was valid from an hour before the container started until 30 days after. Before the trust step, curl failed with `curl: (60) SSL certificate problem: self-signed certificate in certificate chain` and Node with `SELF_SIGNED_CERT_IN_CHAIN`.

The trust step is the `TRUST` command from the migration page: copy the system bundle once, wait for the CA, then rewrite the bundle with the CA appended ([Move outbound rules][migrate]). It took 17 to 396 ms. Each client then needed a different amount of setup:

| Client | After the trust step alone | What it also needs |
| --- | --- | --- |
| curl 8.14.1 | `http_code=200` | nothing |
| Git 2.47.3 | `git clone --depth 1` succeeded | nothing |
| Node 24.20.0 `fetch` | `SELF_SIGNED_CERT_IN_CHAIN` | `NODE_EXTRA_CA_CERTS=<CA path>` or `--use-system-ca`; both gave `status 200` |
| npm 11.19.0 | `npm error code SELF_SIGNED_CERT_IN_CHAIN` | `NODE_EXTRA_CA_CERTS=<CA path>`, which gave `added 1 package` |

The credential route worked as ADR 0060's opt-in expects. The `Inject` handler checked the protocol and host, set `authorization: Bearer n50-dummy-token-not-a-secret` and fetched the echo server. It reached the server through the Worker's own workers.dev URL and through a loopback `ctx.exports` binding, and both answers had `"tokenOk":true`. The sandbox's environment held no copy (`env | grep -c` printed `0`). The token did reach the sandbox one way, though: the echo server returned the request's headers, and curl wrote that body to `/tmp/body`, where `grep -rl` found the token. That is ADR 0060's fourth cost, a host that echoes request headers hands the credential back, observed on Cloudflare. A plain-HTTP request to the credential host was reset, because only its HTTPS was intercepted.

### (c) Denied hosts fail closed, and a handler must check the `Host` header

With per-host intercepts, a host outside the list never resolved. `getent ahosts example.com` timed out (exit 124), and curl over HTTPS and HTTP stopped at `Resolving timed out after 20001 milliseconds`. Node failed with `UND_ERR_CONNECT_TIMEOUT`. IP literals were reset over HTTPS and HTTP, and a raw TCP connection to `1.1.1.1:53` timed out. A UDP send returned 0, which shows only that the kernel accepted the datagram, not that it left. With `interceptAllOutboundHttp()` and `interceptOutboundHttps("*")`, every name resolved and the handler refused each denied one with its own `403`. HTTPS to an IP literal failed with `tlsv1 alert internal error`, as the docs say it will ([Durable Object Container API][do-api]).

The `Host` header is the hole the Containers page warns about. An HTTPS intercept matches the TLS server name, but the handler's `request.url` comes from the `Host` header, which the sandbox controls ([Handle outbound traffic][outbound]). A request to an allowed name with `Host: example.com` reached the checking `Allow` handler, which answered `403`. A `Naive` handler that forwarded without checking fetched `example.com` and returned its page. Plain HTTP behaved differently: a wrong `Host` on an HTTP route was reset before any handler ran, so the HTTP intercept appears to match by the `Host` header itself. Every handler N46b compiles must therefore check `new URL(request.url).hostname` against the policy before it forwards.

### (d) Metadata addresses reset, and loopback stays inside the container

With internet off, `169.254.169.254` was reset at once for the AWS and GCP paths, and so was the IPv6 address `fd00:ec2::254`. `metadata.google.internal` never resolved. Loopback reached only the container's own processes: `127.0.0.1:8080` refused the connection until a server inside the container listened there, and then answered `local ok`. With internet on and no intercept, public HTTPS worked, metadata was reset after about 19 seconds and `10.0.0.1` refused at once. The resolver listed `1.1.1.1`, `9.9.9.9` and `2606:4700:4700::1111`.

Two paths still lead to internal addresses through our own code. Under a `*` intercept, an HTTP request to `169.254.169.254` reaches the handler, which our `Allow` handler refused with `403`. And a handler that forwards on the `Host` header would send its fetch to whatever host the sandbox names. The run did not test what a Worker's own `fetch()` to `169.254.169.254` returns, so N46b's handler must refuse IP literals and internal names itself rather than rely on the runtime.

### (e) The limit holds at 64 hostnames, one IP target past the docs, and a glob covers subdomains

The harness registered `interceptOutboundHttps()` for `h1.n50.invalid` to `h66.n50.invalid` on a running container. The first 64 succeeded, and the 65th threw:

```txt
Error: You can't configure more than 128 egress interceptors, consider using a CIDR or filtering ports in the WorkerEntrypoint
```

Registering `h1` again succeeded, adding HTTP for `h1` failed with the same error, and `h1` and `h64` still answered while `h65` was reset. IP targets for `interceptOutboundHttp()` behaved one entry differently: 129 registered, and the 130th threw the same error. The API page says a container "can hold up to 64 hostname targets, or up to 128 IP address and CIDR targets" ([Durable Object Container API][do-api]). The hostname count matches, while the IP count was one higher on 2026-11-28. One glob entry, `*.wild.n50.invalid`, served `a.wild.n50.invalid` and the two-label `b.c.wild.n50.invalid`, but not the bare `wild.n50.invalid` or any other name, which never resolved. A policy with more than 64 HTTPS hosts therefore needs `*` or globs with the host check inside the handler. The API page counts a hostname on both HTTP and HTTPS as four entries, so we infer, without having measured it, that 32 such hosts fit.

### Three platform behaviours surprised the harness: late deploys, a rejected `monitor()` and a lost container

Three operational findings matter for N46b's live run, though none changes the egress results:

- **A deploy reached the Durable Object minutes late.** After three of the five deploys, the Durable Object kept answering with the previous code while the front Worker already ran the new one. After the last deploy it reported `codeVersion` 4 against a deployed 5 for about two minutes. N46b's live run should check the code version before it records anything.
- **`monitor()` rejected after `destroy()`.** Both containers that a case destroyed normally reported `Container exited with unexpected exit code: 137`. The migration guide says `monitor()` resolves when `destroy()` stops the container without a reason ([Replace the Sandbox class][replace], step 8).
- **One container vanished mid-case.** In an earlier attempt at the combined (b) to (d) case, an `exec()` failed with `Network connection lost`, and every later call failed with `exec() cannot be called on a container that is not running`. The cause is unknown, and it didn't recur when the case ran again as two shorter ones ([record](cloudflare-sandbox-egress-run/results/bcd-per-host-https-container-lost.json)).

## The two Cloudflare pages match what the run observed, except the IP-target count

Both cited pages held against the run, as of their dates (2026-11-09 for the Containers page and 2026-09-30 for the migration page). The [Containers page][outbound] says that with internet off "only traffic that an intercept handles can leave the container" and that intercepts decide which names resolve, and cases (a) and (c) showed both. It names the CA path, which case (b) found, and warns that the URL comes from the `Host` header, which case (c) confirmed. The [migration page][migrate]'s `TRUST` command made curl and Git work, and its `NODE_EXTRA_CA_CERTS` setting made Node and npm work. Its statement that HTTPS to an IP address fails under `*` matched case (c). The [API page][do-api]'s limit text matched for hostnames and was one target low for IP addresses, as case (e) showed. The docs omit two things the run found: an HTTP intercept matches by `Host`, and an echoing host returns the credential to the sandbox.

The three browser-use rows still hold, with one change. Row 112's finding, that HTTPS fails while internet is off and nothing intercepts it, holds on 1.0 by case (a), and row 117's conclusion, that no allowlisted HTTPS host loads, follows from it. Row 114 describes N46b as written then. N46b has since been retargeted to the Container API's intercepts ([N46b](../../todos/ready/N46b-cloudflare-sandbox-backend.md)), so the row's quote no longer matches N46b's text. Its point, that the first design had no HTTPS path, stands ([browser-use fact-check][bu-fc], rows 112, 114 and 117).

## N46b should compile `EgressPolicy` to per-host HTTPS intercepts with checking handlers

N46b should compile each `EgressPolicy` to the following, on the `durable_object` scheduling policy. Each step rests on a case above:

1. **Start with internet off.** Pass `enableInternet: false` to `start()`, which is also the API's default ([Durable Object Container API][do-api]). Only intercepted HTTP and HTTPS leave (cases a and c).
2. **Register before `start()`, specific names first.** For each host in `allow`, register `interceptOutboundHttps(host, Allow)` and, only if the policy allows plain HTTP, `interceptOutboundHttp(host, Allow)`. Register credential-route hosts first, with their own handler, because a later broad rule would take their requests ([Handle outbound traffic][outbound]). Up to 64 HTTPS names fit, as case (e) measured, and by our inference from the API page's entry counts, 32 names on both protocols. Past either limit, compile to `interceptOutboundHttps("*")` and `interceptAllOutboundHttp()` with the list in the handler's props (case e).
3. **Check every request in the handler.** The `Allow` handler forwards only when the protocol and `new URL(request.url).hostname` match the policy, refuses IP literals and internal names, and passes `redirect: "manual"`. The `Inject` handler, for a credential route, also checks the method and path where the route names them, sets the header, and fetches with `redirect: "manual"` (cases b to d).
4. **Run the trust step, then fail closed.** After `start()`, run `TRUST`. If it exits non-zero, `destroy()` the container and fail provisioning, as the migration page's `startContainer()` does (case b).
5. **Give every `exec()` the CA variables.** An `exec()` inherits only `PATH` from `start()` ([Durable Object Container API][do-api]), so each call's `env` must carry `NODE_EXTRA_CA_CERTS=/etc/cloudflare/certs/cloudflare-containers-ca.crt`, plus `REQUESTS_CA_BUNDLE` for Python, which the run didn't test (case b).
6. **Read the policy back.** The sandbox's `readBack()` can compare the registered targets with the policy, and N45's egress cases can reuse cases (c) and (d)'s commands.

Per client, the trust store costs this much:

| Client | One-time cost per container | Cost per process |
| --- | --- | --- |
| curl, Git and other OpenSSL or GnuTLS clients that read the system bundle | the `TRUST` step, 17–396 ms in this run | none |
| Node, including npm | the `TRUST` step | `NODE_EXTRA_CA_CERTS` in the `exec()` environment, or `--use-system-ca` on the command |
| Python `requests` (from the migration page, untested) | the `TRUST` step | `REQUESTS_CA_BUNDLE` |
| A runtime with its own store, such as Java's | the `TRUST` step plus its own import, unmeasured | depends on the runtime |

The CA changes with every container, so the step runs at every start and resume, and a snapshot carries the previous container's CA. `TRUST` handles that by rebuilding the bundle from a saved copy ([Move outbound rules][migrate]).

If the owner rejects interception for the default, the fallback is case (a)'s reverse-proxy route. N46b would compile each allowed host to `interceptOutboundHttp("<host>.egress.internal", Route)`, and the harness would configure each client: npm's `registry`, Git's `insteadOf` and an environment variable or config file for each other tool. That route needs no CA and matches HD15, but any code that opens an `https://` URL itself fails, so a coding agent's arbitrary build steps would break.

## Proposed ADR: on the Cloudflare backend, our own Worker terminates allowed TLS behind host checks

The text below is proposed for the owner to accept or reject, and it carries no number. It changes nothing on `srt`, Docker, E2B or Vercel. Accepting it adopts option 1; rejecting option 1 makes the Decision's last paragraph apply.

> **NNNN. On the Cloudflare backend, our Worker intercepts TLS for each allowed host behind a host check, and adds an opt-in credential only on a checked route**
>
> - **Status:** Proposed — owner to confirm
> - **Date:** 2026-11-28
> - **Plan:** [build-harness.md, HD15](../../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls), as extended by [ADR 0060](../../decisions/0060-sandboxes-hold-no-credentials-by-default.md); the backend is todo [N46b](../../todos/ready/N46b-cloudflare-sandbox-backend.md)
>
> **Context.** ADR 0020 and HD15 rule out TLS interception, and ADR 0060 keeps that rule locally while allowing the providers' interception on E2B and Vercel for an opt-in credential route. It left Cloudflare to N50. N50's live run on `@cloudflare/sandbox` 1.0.3 found that no HTTPS leaves a container with internet off unless a Worker handler terminates its TLS, so the default itself needs interception or a workaround ([N50 findings](#five-results-answer-n50s-five-cases)). On Cloudflare, the party that decrypts is our own `WorkerEntrypoint` handler, running in our account beside the container ([Handle outbound traffic](https://developers.cloudflare.com/containers/configuration/outbound-traffic/)), not a provider's proxy. Three options were measured:
>
> 1. **Intercept TLS per allowed host.** Every client works once it trusts a per-container CA: curl and Git through the system bundle, and Node and npm with `NODE_EXTRA_CA_CERTS` as well (case b).
> 2. **Route each client over plain HTTP to the Worker.** No CA is needed, but only clients configured to use a route reach a host, so code that opens an `https://` URL itself fails (case a, reverse-proxy routes).
> 3. **Allow no HTTPS on Cloudflare.** Nothing that needs a registry or a Git host works (case a).
>
> **Decision.** On the Cloudflare backend only, option 1, under four rules.
>
> - **Rule 1, per-host targets.** N46b compiles the policy's hosts to per-host `interceptOutboundHttps()` targets, or to `*` past 64 names, each served by our own handler. The handler forwards only when the request's protocol and URL host match the policy, refuses IP literals and internal names, and never follows redirects.
> - **Rule 2, a trusted CA.** The container trusts the per-container CA through the migration page's trust step at every start and resume. Every `exec()` carries `NODE_EXTRA_CA_CERTS`, and provisioning fails if the trust step fails.
> - **Rule 3, no credential by default.** With no credential route, the handlers forward requests unchanged, so the default still puts no credential anywhere.
> - **Rule 4, a checked credential route.** A credential route is ADR 0060's narrow opt-in, and the credential-route limits of ADR 0060 apply unchanged. Its host gets its own handler, registered before any broad rule. That handler also checks the method and the path the route names, adds the credential read from a Worker secret, and fetches with `redirect: "manual"`.
>
> Authenticated actions stay host-side tools by default either way.
>
> If the owner declines option 1, the backend uses option 2 for the default and keeps the opt-in on option 2 as well. A credential route then becomes a checked plain-HTTP route in our Worker. It checks the host, method and path, adds the credential and sends the request on over HTTPS, as N50's route did (`"tokenOk":true`). That follows ADR 0060, which says reversing the opt-in means running our own routes.
>
> **Consequences.**
> - Each Cloudflare sandbox's trust store carries a CA that changes with each container. Our Worker, and the Cloudflare runtime that runs it, sees every allowed request in plaintext, credential or not.
> - Any handler that forwards on the `Host` header is a server-side request forgery, so the handler's host check is the boundary, and N46b's tests must cover it with a wrong `Host` header.
> - A host that echoes request headers hands the credential back into the sandbox, as ADR 0060 warns. The run saw it happen.
> - Our local backends keep ADR 0020's rule. HD15 gains a note that its "no TLS interception" covers our own proxy and the local backends, and that on Cloudflare interception happens inside our own Worker.
> - The harness README's Cloudflare section must state the default, the opt-in, the trust step's per-client cost and the five costs ADR 0060 lists, as it does for E2B and Vercel.

## The run deleted its Worker, container application and image on 2026-11-28, and checked each by listing

The run created four resources, all on workers.dev with no route, custom domain, zone binding, KV, D1 or R2: the Worker `n50-egress-test-20261128`, its Durable Object class `N50EgressTest20261128Sandbox`, the container application `n50-egress-test-20261128-sandbox` and the image `n50-egress-test-20261128-n50egresstest20261128sandbox-sandbox:wrangler-mx0mydjm`. Before the first deploy, `wrangler deployments list --name n50-egress-test-20261128` returned `This Worker does not exist on your account. [code: 10007]` and `wrangler containers list` returned `No containers found.` (both outputs open the [deploy record](cloudflare-sandbox-egress-run/results/deploy.log), which then holds all five deploys). The [teardown record](cloudflare-sandbox-egress-run/results/teardown.log) shows the deletions:

| Command (17:21–17:22 UTC) | Output |
| --- | --- |
| `wrangler delete n50-egress-test-20261128` | `Successfully deleted n50-egress-test-20261128`, with a warning that the container application keeps running |
| `wrangler containers delete cbf5bdebac744233a102b1ff0b3e096f` | `Your container has been deleted` |
| `wrangler containers images delete n50-egress-test-20261128-n50egresstest20261128sandbox-sandbox:wrangler-mx0mydjm` | `Deleted … (sha256:36ca3e08…)` |
| `wrangler deployments list --name n50-egress-test-20261128` | `This Worker does not exist on your account. [code: 10007]` |
| `wrangler containers list`, then `wrangler containers images list` | `No containers found.`, then an empty table |
| `curl https://n50-egress-test-20261128.<subdomain>.workers.dev/echo` | `http_code=404` |

The run did not separately check the Durable Object namespace, because wrangler 4.160.1 has no command that lists namespaces; deleting the Worker removed the only code that could reach it. The containers ran for under an hour in all, counting the earlier attempts, on `lite`. At the overage rates of the Workers Paid plan that would cost under $0.01 ([Containers pricing][pricing]). The run probably stayed within the plan's included usage, but this session could not see the bill.

## The owner's ruling now covers the default as well as the opt-in

Case (a) settled the question ADR 0060 left open: on Cloudflare, plain allowlisted HTTPS needs interception, so the owner's ruling covers the default as well as the opt-in. The run showed that per-host interception works for curl, Git, Node and npm. Its costs are one trust step per container, `NODE_EXTRA_CA_CERTS` in every Node process and a host check in every handler. A plain-HTTP route avoids the CA but breaks any client not configured for it. The owner's answer to the proposed ADR above decides N46b's route: accept it, and N46b compiles `EgressPolicy` as the six steps say; reject option 1, and N46b takes the plain-HTTP route. N46b waits for that answer.

[outbound]: https://developers.cloudflare.com/containers/configuration/outbound-traffic/
[migrate]: https://developers.cloudflare.com/sandbox/sdk/migrate/outbound-traffic/
[replace]: https://developers.cloudflare.com/sandbox/sdk/migrate/replace-the-sandbox-class/
[do-api]: https://developers.cloudflare.com/containers/api/durable-object-container/
[limits]: https://developers.cloudflare.com/containers/platform/limits/
[images]: https://developers.cloudflare.com/containers/guides/image-management/
[pricing]: https://developers.cloudflare.com/containers/platform/pricing/
[bu-fc]: ../browser-use/fact-check-browser-use.md
[hd15]: ../../plans/build-harness.md#hd15-the-credential-proxy-injects-on-reverse-proxy-routes-not-by-intercepting-tls
