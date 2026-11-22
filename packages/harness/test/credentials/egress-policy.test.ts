import assert from "node:assert/strict";
import {
  type CompiledEgressPolicy,
  compileEgressPolicy,
  type EgressPolicy,
  GIT_MAX_COMMAND_BYTES,
  type GitRouteFilter,
  isValidRefName,
  pushVerdict,
} from "@buildanagent/harness/credentials";
import { test } from "vitest";

// The policy compiler and the git route's pure checks. The proxy that runs a compiled policy is tested against a real
// HTTPS server in git-route.test.ts.
const SECRET = "ghs_realsecret0123456789abcdefABCDEF";
const secret = async (name: string) => (name === "GITHUB_TOKEN" ? SECRET : "");
const policy: EgressPolicy = {
  allow: ["registry.npmjs.org", "api.example.com:8443"],
  routes: [
    {
      kind: "header",
      route: "api",
      host: "api.github.com",
      methods: ["GET"],
      header: "authorization",
      credential: "GITHUB_TOKEN",
    },
    {
      kind: "git",
      route: "git",
      host: "github.com",
      repositories: ["owner/repo"],
      pushRefs: ["refs/heads/agent/*"],
      credential: "GITHUB_TOKEN",
    },
  ],
};
const codeOf = (action: () => unknown): { code?: string; message?: string } => {
  try {
    action();
  } catch (error) {
    return error as { code?: string; message?: string };
  }
  return {};
};

test("a policy compiles to the proxy's allowlist and routes, which read the named credential at each request", async () => {
  const compiled: CompiledEgressPolicy = compileEgressPolicy(policy, { secret });
  assert.deepEqual(compiled.allow, policy.allow);
  const [header, git] = compiled.routes;
  assert.deepEqual(
    { route: header?.route, host: header?.host, methods: header?.methods, header: header?.header, git: header?.git },
    { route: "api", host: "api.github.com", methods: ["GET"], header: "authorization", git: undefined },
  );
  assert.deepEqual(git?.git, {
    repositories: ["owner/repo"],
    pushRefs: ["refs/heads/agent/*"],
    fetch: false,
    username: "x-access-token",
  });
  assert.deepEqual(git?.methods, ["GET", "POST"]);
  assert.equal(await header?.secret(), SECRET);
  assert.equal(JSON.stringify(policy).includes(SECRET), false, "the policy itself holds no credential");
});

test("a route that would put a credential's value in the policy is refused, and the message doesn't echo it", () => {
  const route = policy.routes[0];
  const attempts: unknown[] = [
    { ...policy, routes: [{ ...route, credential: SECRET }] },
    { ...policy, routes: [{ ...route, credential: "sk-ant-api03-abcdef" }] },
    { ...policy, routes: [{ ...route, secret: SECRET }] },
    { ...policy, routes: [{ ...route, token: "plain-looking-value" }] },
    { ...policy, routes: [{ ...route, credential: "lowercase_name" }] },
    { ...policy, allow: [...policy.allow, "AKIAIOSFODNN7EXAMPLE"] },
    { ...policy, secret: SECRET },
  ];
  for (const attempt of attempts) {
    const error = codeOf(() => compileEgressPolicy(attempt as EgressPolicy, { secret }));
    assert.equal(error.code, "invalid_egress_options", JSON.stringify(attempt).slice(0, 80));
    assert.doesNotMatch(error.message ?? "", /realsecret|sk-ant|plain-looking|AKIA|lowercase_name/);
  }
});

test("a wildcard, an address literal and a malformed host are refused in allow and in a route's host", () => {
  const bad = [
    "*.example.com",
    "*",
    "10.0.0.5",
    "[::1]",
    "::1",
    "169.254.169.254:80",
    "exa mple.com",
    "",
    "a.test:99999",
  ];
  for (const entry of bad) {
    const inAllow = codeOf(() => compileEgressPolicy({ allow: [entry], routes: [] }, { secret }));
    assert.equal(inAllow.code, "invalid_egress_options", `allow ${entry}`);
    assert.equal(inAllow.message?.includes(entry) && entry !== "", false, "the message names the place, not the entry");
    const route = { ...policy.routes[0], host: entry };
    const inRoute = codeOf(() =>
      compileEgressPolicy({ allow: [], routes: [route] as EgressPolicy["routes"] }, { secret }),
    );
    assert.equal(inRoute.code, "invalid_egress_options", `route host ${entry}`);
  }
});

test("a git route is refused when its host is tunnelled to, it names no repository, or a ref is outside refs/heads", () => {
  const git = policy.routes[1] as Extract<EgressPolicy["routes"][number], { kind: "git" }>;
  const variants: [string, unknown][] = [
    ["host in allow", { allow: ["github.com"], routes: [git] }],
    ["host in allow with a port", { allow: ["GitHub.com:443"], routes: [git] }],
    ["no repository", { allow: [], routes: [{ ...git, repositories: [] }] }],
    ["a repository path", { allow: [], routes: [{ ...git, repositories: ["owner/repo/extra"] }] }],
    ["a dot repository", { allow: [], routes: [{ ...git, repositories: ["owner/.."] }] }],
    ["a tag pattern", { allow: [], routes: [{ ...git, pushRefs: ["refs/tags/*"] }] }],
    ["every ref", { allow: [], routes: [{ ...git, pushRefs: ["refs/*"] }] }],
    ["a mid glob", { allow: [], routes: [{ ...git, pushRefs: ["refs/heads/*/x"] }] }],
    ["neither push nor fetch", { allow: [], routes: [{ ...git, pushRefs: [] }] }],
    ["a bad username", { allow: [], routes: [{ ...git, username: "a:b" }] }],
    ["a header route's field", { allow: [], routes: [{ ...git, header: "authorization" }] }],
    ["two routes with one name", { allow: [], routes: [git, { ...git, host: "gitlab.com" }] }],
    ["an unknown kind", { allow: [], routes: [{ ...git, kind: "tcp" }] }],
  ];
  for (const [label, attempt] of variants) {
    assert.equal(
      codeOf(() => compileEgressPolicy(attempt as EgressPolicy, { secret })).code,
      "invalid_egress_options",
      label,
    );
  }
  assert.equal(codeOf(() => compileEgressPolicy(policy, {} as never)).code, "invalid_egress_options");
  assert.ok(compileEgressPolicy({ allow: [], routes: [{ ...git, pushRefs: [], fetch: true }] }, { secret }));
});

const filter: GitRouteFilter = {
  repositories: ["owner/repo"],
  pushRefs: ["refs/heads/agent/*", "refs/heads/exact"],
  fetch: false,
  username: "x-access-token",
};
const encoder = new TextEncoder();
const OLD = "0".repeat(40);
const NEW = "a".repeat(40);
const pkt = (text: string) => `${(text.length + 4).toString(16).padStart(4, "0")}${text}`;
const push = (...lines: string[]) =>
  encoder.encode(
    `${lines.map((line, index) => pkt(index === 0 ? `${line}\0report-status side-band-64k\n` : `${line}\n`)).join("")}0000PACK`,
  );

test("a push to a listed branch is allowed, and a deletion, a tag or any other ref is refused", () => {
  assert.equal(pushVerdict(push(`${OLD} ${NEW} refs/heads/agent/task-1`), filter, false), "allowed");
  assert.equal(
    pushVerdict(
      push(`${OLD} ${NEW} refs/heads/exact`, `${NEW} ${OLD.replace(/0/g, "b")} refs/heads/agent/x`),
      filter,
      true,
    ),
    "allowed",
  );
  const refused: [string, string[]][] = [
    ["git_ref_refused", [`${OLD} ${NEW} refs/heads/main`]],
    ["git_ref_refused", [`${OLD} ${NEW} refs/tags/v1`]],
    ["git_ref_refused", [`${OLD} ${NEW} refs/heads/agent/`]],
    ["git_ref_refused", [`${OLD} ${NEW} refs/heads/agent-evil`]],
    ["git_ref_refused", [`${OLD} ${NEW} refs/heads/agent`]],
    ["git_ref_refused", [`${OLD} ${NEW} refs/heads/agent/../main`]],
    ["git_ref_refused", [`${OLD} ${NEW} refs/heads/exact2`]],
    ["git_ref_refused", [`${OLD} ${NEW} refs/heads/agent/ok`, `${OLD} ${NEW} refs/heads/main`]],
    ["git_delete_refused", [`${NEW} ${OLD} refs/heads/agent/task-1`]],
    ["git_bad_pkt_line", [`${OLD} ${NEW.slice(1)} refs/heads/agent/x`]],
    ["git_push_cert", ["push-cert"]],
  ];
  for (const [reason, lines] of refused) {
    assert.deepEqual(pushVerdict(push(...lines), filter, true), { refused: reason }, lines.join(" | "));
  }
});

test("a push the route can't parse, or one past its size limit, is refused and never waits for more", () => {
  const whole = push(`${OLD} ${NEW} refs/heads/agent/task-1`);
  assert.equal(pushVerdict(whole.subarray(0, 20), filter, false), "incomplete");
  assert.deepEqual(pushVerdict(whole.subarray(0, 20), filter, true), { refused: "git_bad_pkt_line" });
  for (const body of ["zzzz", "0003", "0004", "0000", "ffff", `${pkt("x")}0000`]) {
    assert.deepEqual(pushVerdict(encoder.encode(body), filter, true), { refused: "git_bad_pkt_line" }, body);
  }
  const invalidUtf8 = new Uint8Array([...encoder.encode("0009"), 0xff, 0xfe, 0xfd, 0xfc, 0x0a]);
  assert.deepEqual(pushVerdict(invalidUtf8, filter, true), { refused: "git_bad_pkt_line" });
  const many = Array.from({ length: 65 }, (_, index) => `${OLD} ${NEW} refs/heads/agent/t${index}`);
  assert.deepEqual(pushVerdict(push(...many), filter, true), { refused: "git_too_many_commands" });
  const endless = encoder.encode(
    `${pkt(`${OLD} ${NEW} refs/heads/agent/${"x".repeat(59_000)}\n`)}ffef${"y".repeat(7000)}`,
  );
  assert.ok(endless.length > GIT_MAX_COMMAND_BYTES);
  assert.deepEqual(pushVerdict(endless, filter, false), { refused: "git_too_large" });
  const shallow = encoder.encode(`${pkt(`shallow ${NEW}\n`)}${pkt(`${OLD} ${NEW} refs/heads/agent/s\0caps\n`)}0000`);
  assert.equal(pushVerdict(shallow, filter, true), "allowed", "a shallow line may come before the commands");
});

test("ref names follow git's own rules", () => {
  for (const good of ["refs/heads/agent/task-1", "refs/heads/a.b", "refs/heads/x/y_z"])
    assert.ok(isValidRefName(good), good);
  for (const bad of [
    "heads/main",
    "refs/heads/a..b",
    "refs/heads/a b",
    "refs/heads/a~1",
    "refs/heads/a^",
    "refs/heads/a:b",
    "refs/heads/a?",
    "refs/heads/a*",
    "refs/heads/a[",
    "refs/heads/a\\b",
    "refs/heads/.hidden",
    "refs/heads/x.lock",
    "refs/heads/x/",
    "refs/heads/x.",
    "refs/heads//x",
    "refs/heads/a@{1}",
    "refs/heads/\u0001",
  ]) {
    assert.equal(isValidRefName(bad), false, bad);
  }
});
