import assert from "node:assert/strict";
import test from "node:test";

import { majority, runBatch } from "../harness/run.mjs";
import { classifyFailure, verdictFor } from "../harness/lib.mjs";

test("dispatcher repeats, scores, and tears down", async () => {
  let reset = 0, down = 0, observations = 0;
  const capsule = {
    baseUrl: "http://fake",
    meta: { siteId: "demo", seed: 1, versions: {} },
    async reset() { reset++; },
    async observe() { observations++; return { ok: observations < 3 }; },
    async down() { down++; },
  };
  const result = await runBatch({
    siteId: "demo", method: { id: "scripted", run: async () => ({ finalText: "done", transcript: [] }) },
    tasks: [{ id: "t", tier: "answer", predicate: { probe: "api", query: "x", assert: { contains: { ok: true } } } }],
    n: 3, seed: 1, boot: async () => capsule, page: {},
  });
  assert.equal(result.rows.length, 3);
  assert.equal(result.verdicts[0].solved, true);
  assert.equal(reset, 3);
  assert.equal(down, 1);
  assert.equal(result.rows[0].reset_s, "0.000");
  assert.equal(result.rows[0].setup_s, "0.000");
});

test("a throwing repeat is recorded as a failed attempt, not a crashed run", async () => {
  let down = 0;
  const capsule = { reset: async () => {}, down: async () => { down++; }, meta: {}, baseUrl: "http://fake" };
  const result = await runBatch({
    siteId: "demo", method: { id: "bad", run: async () => { throw new Error("boom"); } },
    tasks: [{ id: "t", predicate: {} }], n: 1, seed: 1, boot: async () => capsule, page: {},
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].pass, false);
  assert.match(result.rows[0].failure_category, /harness-agent: boom/);
  assert.equal(result.verdicts[0].solved, false);
  assert.equal(down, 1);
});

test("failure taxonomy and verdicts exclude infrastructure rows", () => {
  assert.equal(classifyFailure("429 overloaded"), "infra");
  assert.equal(classifyFailure("probe-error: offline"), "infra");
  assert.equal(classifyFailure("attempt timeout: 300s agent budget"), "agent");
  assert.equal(classifyFailure("browser-use returned no result"), "agent");
  assert.deepEqual(verdictFor([{ pass: true, failure_category: "" }, { pass: false, failure_category: "harness-infra: quota" }]), { solved: true, passes: 1, attempts: 1 });
  assert.deepEqual(verdictFor([{ pass: false, failure_category: "harness-infra: quota" }]), { solved: false, passes: 0, attempts: 0 });
});

test("majority requires more than half", () => {
  assert.equal(majority([true, true, false]), true);
  assert.equal(majority([true, false, false]), false);
});
