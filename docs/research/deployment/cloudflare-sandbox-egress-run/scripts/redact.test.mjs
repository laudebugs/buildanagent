// A self-check for redact.mjs, run by hand: node --test scripts/redact.test.mjs. It uses a stand-in label, never
// the account's real subdomain, and covers the cuts that the records' truncation can make.
import assert from "node:assert/strict";
import { test } from "node:test";
import { redact, subdomainOf } from "./redact.mjs";

const LABEL = "acmelabs";
const HOST = `n50-egress-test-20261128.${LABEL}.workers.dev`;
const clean = (text) => assert.doesNotMatch(redact(text, LABEL), /acme/i);

test("the label comes from the Worker's workers.dev URL", () => {
  assert.equal(subdomainOf(`https://${HOST}/echo`), LABEL);
});

test("the full host keeps its .workers.dev suffix", () => {
  assert.equal(redact(`https://${HOST}/echo`, LABEL), "https://n50-egress-test-20261128.<subdomain>.workers.dev/echo");
});

test("a cut followed by an escaped newline", () => {
  clean(String.raw`{"stdout":"url https://n50-egress-test-20261128.acmel\n"}`);
});

test("a cut of three or fewer characters after the Worker's name", () => {
  for (const cut of ["a", "ac", "acm"]) {
    for (const tail of ["", '"', String.raw`\n`]) {
      const out = redact(`"https://n50-egress-test-20261128.${cut}${tail}`, LABEL);
      assert.equal(out, `"https://n50-egress-test-20261128.<subdomain>${tail}`);
    }
  }
});

test("a cut followed by any other marker", () => {
  for (const tail of [" ", ")", "…", "\t", ",", "/", "<"]) clean(`n50-egress-test-20261128.acmela${tail}rest`);
});

test("the cf-worker header with escaped quotes, whole or cut short", () => {
  assert.match(redact(String.raw`\"cf-worker\":\"acmelabs.workers.dev\"`, LABEL), /<subdomain>/);
  clean(String.raw`\"cf-worker\":\"acmel`);
});

test("the label or a long cut of it elsewhere, at the end of a string", () => {
  clean(`"user": "${LABEL}"`);
  clean(String.raw`"x":"acmela\"`);
  clean("acmelab");
});

test("a redacted record is unchanged by a second pass", () => {
  const once = redact(`https://${HOST}/echo \\"cf-worker\\":\\"acme`, LABEL);
  assert.equal(redact(once, LABEL), once);
});
