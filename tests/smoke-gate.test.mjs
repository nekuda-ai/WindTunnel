import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

// The gate once flagged a PREDICATE failure whose expected JSON contained
// `"price":400` as an "unsupported-parameter / 400 request error" and blocked
// the flight. Only harness failures may trip that check.
const row = (failure_category) => ({
  arm: "cu-openai", model: "gpt-6-astra", model_snapshot: "gpt-6-astra", task_id: "id-6",
  input_tokens: 10, output_tokens: 5, truncated: false, refusal: false, failure_category, pass: false,
});
const gate = (rows) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wt-gate-"));
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ rows }));
  const r = spawnSync(process.execPath, ["scripts/smoke-gate.mjs", dir, "--model", "gpt-6-astra"], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
};

test("smoke gate: a scoring failure mentioning 400 is not a request error", () => {
  const { code, out } = gate([row('predicate failed: {"contains":{"items":{"price":400}}}')]);
  assert.equal(code, 0, out);
});

test("smoke gate: a harness 400 from the provider still blocks", () => {
  const { code, out } = gate([row("harness-agent: OpenAI 400: Unsupported parameter: temperature")]);
  assert.equal(code, 1, out);
  assert.match(out, /unsupported-parameter/);
});
