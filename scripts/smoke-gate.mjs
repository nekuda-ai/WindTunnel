#!/usr/bin/env node
// Pre-flight gate. No full flight may start unless the corresponding smoke
// confirms, for every attempt: the exact requested model/snapshot, valid usage
// accounting, no unsupported-parameter error, no truncation, and no
// infrastructure failure. Scoring is deliberately NOT a criterion — a smoke
// exists to prove the harness/model combination works, not that the model is
// good at the task.
//
//   node scripts/smoke-gate.mjs <resultsDir> [--model <expected>]
//
// Exits non-zero with a reason when the combination is not safe to fly.
import fs from "node:fs";
import path from "node:path";
import { isInfraRow } from "../harness/lib.mjs";

const RES = path.resolve(import.meta.dirname, "../results");
const argv = process.argv.slice(2);
const modelIdx = argv.indexOf("--model");
const expectedModel = modelIdx >= 0 ? argv.splice(modelIdx, 2)[1] : null;
const dirArg = argv[0];
if (!dirArg) { console.error("usage: smoke-gate.mjs <resultsDir> [--model <expected>]"); process.exit(2); }
// Accept an absolute path, a path relative to cwd, or a bare results dirname.
const candidates = [path.resolve(dirArg), path.join(RES, dirArg)];
const dir = candidates.find((c) => fs.existsSync(path.join(c, "run.json"))) ?? candidates[0];
const file = path.join(dir, "run.json");
if (!fs.existsSync(file)) { console.error(`no run.json in ${dir}`); process.exit(2); }

const { rows = [] } = JSON.parse(fs.readFileSync(file, "utf8"));
if (!rows.length) { console.error("smoke produced no attempts at all"); process.exit(1); }

const problems = [], disclosures = [];
const UNSUPPORTED = /unsupported|unexpected keyword|invalid_request_error|not supported|unrecognized|400/i;

for (const row of rows) {
  const where = `${row.arm} × ${row.model} × ${row.task_id}`;
  if (expectedModel && row.model !== expectedModel) problems.push(`${where}: ran model "${row.model}", expected "${expectedModel}"`);
  // The snapshot the provider actually served. Empty means the arm never
  // recorded what answered — usage accounting cannot be trusted either.
  if (!row.model_snapshot && !String(row.snapshot_source ?? "").startsWith("unavailable:"))
    problems.push(`${where}: no model_snapshot recorded and the arm did not declare why`);
  else if (!row.model_snapshot) disclosures.push(`${where}: served snapshot unreportable (${row.snapshot_source}) — verified out-of-band via scripts/verify-model.mjs`);
  else if (expectedModel && !String(row.model_snapshot).startsWith(expectedModel))
    problems.push(`${where}: served snapshot "${row.model_snapshot}" does not match requested "${expectedModel}"`);
  const input = Number(row.input_tokens) || 0, output = Number(row.output_tokens) || 0;
  if (input <= 0 || output <= 0) problems.push(`${where}: usage accounting missing or zero (in=${input} out=${output})`);
  if (row.truncated === true || row.truncated === "true") problems.push(`${where}: response hit max_tokens — raise it before flying`);
  if (row.refusal === true || row.refusal === "true") problems.push(`${where}: provider refusal (stop_reason=refusal)`);
  if (isInfraRow(row)) problems.push(`${where}: infrastructure failure — ${row.failure_category}`);
  if (UNSUPPORTED.test(String(row.failure_category ?? ""))) problems.push(`${where}: unsupported-parameter/request error — ${row.failure_category}`);
}

const models = [...new Set(rows.map((r) => `${r.model} (served ${r.model_snapshot || "?"})`))];
const cost = rows.reduce((sum, r) => sum + (Number(r.est_cost_usd) || 0), 0);
const passed = rows.filter((r) => r.pass ?? r.success).length;
console.log(`${path.basename(dir)}: ${rows.length} attempt(s), ${passed} scored pass, $${cost.toFixed(4)}`);
console.log(`  models: ${models.join("; ")}`);
console.log(`  effort: ${[...new Set(rows.map((r) => r.effort || "-"))].join(", ")} · temperature: ${[...new Set(rows.map((r) => r.temperature || "-"))].join(", ")}`);
console.log(`  cache: read ${rows.reduce((s, r) => s + (Number(r.cached_tokens) || 0), 0)}, write ${rows.reduce((s, r) => s + (Number(r.cache_write_tokens) || 0), 0)} tokens`);

if (disclosures.length) console.log(`  disclosed limitations:\n    ${[...new Set(disclosures)].join("\n    ")}`);
if (problems.length) {
  console.error(`\nGATE FAILED — do not start the flight:\n  ${[...new Set(problems)].join("\n  ")}`);
  process.exit(1);
}
console.log("\nGATE PASSED — combination is safe to fly.");
