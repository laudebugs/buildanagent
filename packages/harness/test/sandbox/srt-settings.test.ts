import assert from "node:assert/strict";
import type { SandboxPolicy } from "@buildanagent/harness/sandbox";
import { type SrtPolicyNames, srtPolicyFromSettings, srtSettings } from "@buildanagent/harness/sandbox/srt";
import { test } from "vitest";

const policy: SandboxPolicy = {
  readRoots: ["/work/read"],
  writeRoots: ["/work/write"],
  network: { allow: ["api.example.com"], deny: ["bad.example.com"] },
};

test("the settings deny every read and then allow the roots, the system and the helpers back", () => {
  const settings = srtSettings({
    policy,
    systemReadRoots: ["/usr", "/etc"],
    helperReadRoots: ["/srt/vendor", "/tmp/private"],
    denyWrite: [],
  });
  assert.deepEqual(settings.filesystem.denyRead, [{ path: "/", literal: true }]);
  assert.deepEqual(
    settings.filesystem.allowRead.map((entry) => entry.path),
    ["/work/read", "/work/write", "/usr", "/etc", "/srt/vendor", "/tmp/private"],
  );
});

test("writes are allowed only under the write roots, and a denied folder takes precedence", () => {
  const settings = srtSettings({ policy, systemReadRoots: [], helperReadRoots: [], denyWrite: ["/work/write/log"] });
  assert.deepEqual(settings.filesystem.allowWrite, [{ path: "/work/write", literal: true }]);
  assert.deepEqual(settings.filesystem.denyWrite, [{ path: "/work/write/log", literal: true }]);
});

test("every path is literal, so a folder named like a pattern is not read as one", () => {
  const settings = srtSettings({
    policy: { ...policy, readRoots: ["/work/*"], writeRoots: ["/work/{a,b}"] },
    systemReadRoots: [],
    helperReadRoots: [],
    denyWrite: ["/work/**"],
  });
  const entries = [
    ...settings.filesystem.denyRead,
    ...settings.filesystem.allowRead,
    ...settings.filesystem.allowWrite,
    ...settings.filesystem.denyWrite,
  ];
  assert.ok(entries.length >= 5);
  assert.ok(entries.every((entry) => entry.literal === true));
});

test("the network allows only the policy's hosts and denies the listed ones", () => {
  const settings = srtSettings({ policy, systemReadRoots: [], helperReadRoots: [], denyWrite: [] });
  assert.deepEqual(settings.network, { allowedDomains: ["api.example.com"], deniedDomains: ["bad.example.com"] });
});

test("an upstream proxy is passed on, and left out when there is none", () => {
  const parentProxy = { http: "http://proxy.internal:3128" };
  const withProxy = srtSettings({ policy, systemReadRoots: [], helperReadRoots: [], denyWrite: [], parentProxy });
  assert.deepEqual(withProxy.network.parentProxy, parentProxy);
  const without = srtSettings({ policy, systemReadRoots: [], helperReadRoots: [], denyWrite: [] });
  assert.equal("parentProxy" in without.network, false);
});

test("a root listed twice appears once", () => {
  const settings = srtSettings({
    policy: { ...policy, readRoots: ["/work/write"], writeRoots: ["/work/write"] },
    systemReadRoots: ["/work/write"],
    helperReadRoots: [],
    denyWrite: [],
  });
  assert.deepEqual(
    settings.filesystem.allowRead.map((entry) => entry.path),
    ["/work/write"],
  );
});

const names: SrtPolicyNames = {
  read: new Map([["/real/read", ["/work/read"]]]),
  write: new Map([["/real/write", ["/work/write"]]]),
  implicitReads: ["/usr", "/srt/vendor"],
};
const written = () =>
  srtSettings({
    policy: { ...policy, readRoots: ["/real/read"], writeRoots: ["/real/write"] },
    systemReadRoots: ["/usr"],
    helperReadRoots: ["/srt/vendor"],
    denyWrite: [],
  });

test("the read-back maps the settings back to the request's spelling, leaving out the folders the backend adds", () => {
  assert.deepEqual(srtPolicyFromSettings(written(), names), policy);
});

test("a folder, a host or a pattern the request didn't ask for shows up in the read-back", () => {
  const settings = structuredClone(written()) as unknown as {
    network: { allowedDomains: string[] };
    filesystem: { allowRead: { path: string; literal: boolean }[]; denyRead: { path: string; literal: boolean }[] };
  };
  settings.network.allowedDomains.push("evil.test");
  settings.filesystem.allowRead.push({ path: "/home", literal: true });
  const read = srtPolicyFromSettings(settings, names);
  assert.deepEqual(read.network.allow, ["api.example.com", "evil.test"]);
  assert.deepEqual(read.readRoots, ["/work/read", "/home"]);
  settings.filesystem.denyRead = [];
  assert.deepEqual(srtPolicyFromSettings(settings, names).readRoots, ["/"], "no deny-all means every read is open");
  settings.filesystem.allowRead.push({ path: "/home/*", literal: false });
  assert.throws(() => srtPolicyFromSettings(settings, names), { code: "sandbox_policy_mismatch" });
  assert.throws(() => srtPolicyFromSettings({ network: {} }, names), { code: "sandbox_policy_mismatch" });
});
