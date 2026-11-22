import assert from "node:assert/strict";
import { isAddressLiteral, isPublicAddress } from "@buildanagent/harness/credentials";
import { test } from "vitest";

const refused = [
  "127.0.0.1",
  "127.255.255.254",
  "169.254.169.254",
  "169.254.0.1",
  "10.0.0.1",
  "172.16.0.1",
  "172.31.255.255",
  "192.168.1.1",
  "0.0.0.0",
  "100.64.0.1",
  "100.127.255.255",
  "224.0.0.1",
  "255.255.255.255",
  "198.18.0.1",
  "::1",
  "::",
  "fe80::1",
  "fc00::1",
  "fd12:3456::1",
  "ff02::1",
  "::ffff:127.0.0.1",
  "::ffff:7f00:1",
  "::ffff:169.254.169.254",
  "::127.0.0.1",
  "64:ff9b::7f00:1",
  "2002:7f00:1::1",
  "2001:db8::1",
  "[::1]",
  "not-an-ip",
  "1.2.3",
  "999.1.1.1",
  "01.2.3.4",
  "",
];
const allowed = [
  "93.184.216.34",
  "8.8.8.8",
  "172.15.255.255",
  "172.32.0.1",
  "100.63.255.255",
  "100.128.0.1",
  "1.1.1.1",
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  "::ffff:8.8.8.8",
];

test("every loopback, link-local, metadata, private, shared, multicast and reserved address is refused", () => {
  assert.deepEqual(refused.filter(isPublicAddress), []);
});

test("public addresses next to the refused ranges are allowed", () => {
  assert.deepEqual(
    allowed.filter((address) => !isPublicAddress(address)),
    [],
  );
});

test("an address literal is told apart from a host name", () => {
  for (const literal of ["127.0.0.1", "::1", "[::1]", "2606:4700:4700::1111", "10.1.2.3"]) {
    assert.equal(isAddressLiteral(literal), true, literal);
  }
  for (const name of ["example.com", "localhost", "1.2.3", "a.b.c.d", "999.1.1.1"]) {
    assert.equal(isAddressLiteral(name), false, name);
  }
});
