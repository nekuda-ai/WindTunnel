import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { runBenchmark } from "../harness/cli.mjs";
import { verdictFor } from "../harness/lib.mjs";
import { loadTasks } from "../harness/tasks.mjs";
import { writeReport } from "../scoring/report.mjs";

const root = path.resolve(import.meta.dirname, "..");
const baselinePath = path.join(root, "results/2026-08-17-sol-full/run.json");
const budget = 20;
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const timeoutRows = baseline.rows.filter(({ failure_category }) =>
  String(failure_category).includes("attempt timeout: 300s agent budget"));

if (process.env.WT_CU_OPENAI_ATTEMPT_MS !== "600000") throw new Error("set WT_CU_OPENAI_ATTEMPT_MS=600000");
if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
if (timeoutRows.length !== 26) throw new Error(`expected 26 censored attempts, found ${timeoutRows.length}`);

const plan = new Map();
for (const row of timeoutRows) {
  const ids = plan.get(row.site) ?? [];
  ids.push(row.task_id);
  plan.set(row.site, ids);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "windtunnel-sol-600-"));
const rows = [];
const capsules = [];
let spent = 0;
console.log(`Scratch results: ${scratch}`);

for (const [site, ids] of plan) {
  const remaining = budget - spent;
  if (remaining <= 0) break;
  console.log(`Starting ${site}: ${ids.length} replacement attempts; $${remaining.toFixed(4)} remaining`);
  const result = await runBenchmark([
    "--preset", "smoke",
    "--sites", site,
    "--arms", "cu-openai",
    "--model", "cu-openai=gpt-5.6-sol",
    "--task-ids", ids.join(","),
    "--n", "1",
    "--budget", String(remaining),
    "--label", `sol-600-${site}`,
  ], { outputRoot: path.join(scratch, site) });
  for (const row of result.rows) row.source = "2026-08-17-sol-full 300s timeout replacement";
  rows.push(...result.rows);
  capsules.push(...(result.capsules ?? []));
  spent = rows.reduce((sum, row) => sum + Number(row.est_cost_usd || 0), 0);
  console.log(`Finished ${site}: ${result.rows.length}/${ids.length}; cumulative $${spent.toFixed(4)}`);
}

const taskKeys = [...new Set(timeoutRows.map(({ site, task_id }) => `${site}\0${task_id}`))];
const verdicts = taskKeys.map((key) => {
  const [site, taskId] = key.split("\0");
  const task = loadTasks(site).find(({ id }) => id === taskId);
  return { site, taskId, tier: task?.tier, method: "cu-openai", ...verdictFor(rows.filter((row) => row.site === site && row.task_id === taskId)) };
});
const outputDir = writeReport({
  rows,
  verdicts,
  capsules,
  options: {
    preset: "targeted",
    sites: "300s-timeouts-only",
    arms: ["cu-openai"],
    seed: 1,
    budget,
    perturbed: false,
    n: 1,
    label: "sol-600-timeouts",
    model: "gpt-5.6-sol",
    armModels: { "cu-openai": "gpt-5.6-sol" },
    reasoning_effort: "medium",
    timeout_s: 600,
    source_run: "results/2026-08-17-sol-full/run.json",
    planned_attempts: timeoutRows.length,
  },
});

const expected = new Map();
for (const row of timeoutRows) expected.set(`${row.site}\0${row.task_id}`, (expected.get(`${row.site}\0${row.task_id}`) ?? 0) + 1);
const actual = new Map();
for (const row of rows) actual.set(`${row.site}\0${row.task_id}`, (actual.get(`${row.site}\0${row.task_id}`) ?? 0) + 1);
const complete = rows.length === timeoutRows.length && [...expected].every(([key, count]) => actual.get(key) === count);
fs.writeFileSync(path.join(outputDir, "targeted-rerun.json"), JSON.stringify({
  source: path.relative(root, baselinePath),
  timeoutSeconds: 600,
  reasoningEffort: "medium",
  plannedAttempts: timeoutRows.length,
  completedAttempts: rows.length,
  trackedCostUsd: spent,
  complete,
  scratch,
}, null, 2) + "\n");

console.log(`Combined report: ${outputDir}`);
if (!complete) throw new Error(`targeted rerun incomplete: ${rows.length}/${timeoutRows.length} attempts`);
