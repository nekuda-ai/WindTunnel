import assert from "node:assert/strict";
import test from "node:test";

import { score } from "../scoring/predicates.mjs";

test("score uses observe and checks a nested contains assertion", async () => {
  const calls = [];
  const capsule = { observe: async (...args) => { calls.push(args); return { items: [{ sku: "A", qty: 2 }] }; } };
  const result = await score({ probe: "api", query: "cart", args: { user: 1 }, assert: { contains: { sku: "A", qty: 2 } } }, capsule);
  assert.equal(result.pass, true);
  assert.deepEqual(calls, [["api", { query: "cart", user: 1 }]]);
});

test("score returns a failure instead of throwing", async () => {
  const failed = await score({ probe: "db", query: "x", assert: { equals: 1 } }, { observe: async () => 2 });
  assert.equal(failed.pass, false);
  const errored = await score({ probe: "db", query: "x", assert: { truthy: true } }, { observe: async () => { throw new Error("offline"); } });
  assert.deepEqual(errored, { pass: false, detail: "probe-error: offline" });
});

test("answer predicates strip URLs, collapse hyphens, match regexes, and reject negations", async () => {
  const capsule = {};
  assert.equal((await score({ type: "answer", contains: ["4"] }, capsule, "See http://example.test:3246")).pass, false);
  assert.equal((await score({ type: "answer", contains: ["no questions asked"] }, capsule, "no-questions-asked")).pass, true);
  assert.equal((await score({ type: "answer", matches: "\\babsent\\b", not_contains: ["not absent"] }, capsule, "It is absent.")).pass, true);
  const failed = await score({ type: "answer", contains: ["absent"], not_contains: ["not absent"] }, capsule, "not absent");
  assert.match(failed.detail, /negation/);
});

test("answer predicates match case-insensitive all and any text", async () => {
  const capsule = { observe: async () => { throw new Error("must not observe"); } };
  assert.equal((await score({ type: "answer", contains: ["FIGMA", "design"] }, capsule, "Figma is in Design.")).pass, true);
  assert.equal((await score({ type: "answer", contains: ["figma", "missing"] }, capsule, "Figma is in Design.")).pass, false);
  assert.equal((await score({ type: "answer", contains_any: ["nope", "SUCCESS"] }, capsule, "Subscription success.")).pass, true);
});

test("answer predicates normalize dashes and prose ranges", async () => {
  const capsule = { observe: async () => { throw new Error("must not observe"); } };
  assert.equal((await score({ type: "answer", contains: ["3-5 business days"] }, capsule, "Delivery takes 3–5 business days.")).pass, true);
  assert.equal((await score({ type: "answer", contains: ["3-5 business days"] }, capsule, "It arrives in 3 to 5 business days.")).pass, true);
  assert.equal((await score({ type: "answer", contains: ["3-5 business days"] }, capsule, "Delivery takes 7-10 business days.")).pass, false);
});
