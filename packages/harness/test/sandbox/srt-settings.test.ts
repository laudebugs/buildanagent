import assert from "node:assert/strict";
import type { SandboxPolicy } from "@buildanagent/harness/sandbox";
import { srtSettings } from "@buildanagent/harness/sandbox/srt";
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
