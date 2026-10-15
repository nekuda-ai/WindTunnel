#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { refresh } from "../harness/openrouter.mjs";
import { parseArgs, planRuns, runBenchmark } from "../harness/cli.mjs";
import { hashes } from "../scoring/report.mjs";
import { isInfraRow, isProviderSetupFailure } from "../harness/lib.mjs";
import { versionFor } from "../arms/cu-claude.mjs";

export const root = path.resolve(import.meta.dirname, "..");
export const configHash = () => {
  const files = ["package-lock.json", "scripts/model-refresh.mjs", "scripts/native-flight.mjs", ...["arms", "harness", "scoring"].flatMap((dir) => fs.readdirSync(path.join(root, dir)).filter((name) => name.endsWith(".mjs")).sort().map((name) => `${dir}/${name}`))];
  return crypto.createHash("sha256").update(JSON.stringify(refresh)).update(files.map((name) => `${name}\n${fs.readFileSync(path.join(root, name), "utf8")}`).join("\n")).digest("hex");
};
export const recordedSpend = (journaled, rows) => Math.max(journaled, rows.reduce((sum, row) => sum + Number(row.est_cost_usd || 0), 0));
export const argsFor = (config, budget, label, smoke) => [
  "--preset", smoke ? "smoke" : "full", "--sites", smoke ? refresh.smoke.site : "full", "--arms", config.arm,
  "--model", `${config.arm}=${config.model}`, "--transport", config.transport,
  "--seed", String(refresh.seed), "--n", smoke ? "1" : String(refresh.attempts), "--budget", String(budget), "--label", label,
  ...(smoke ? ["--task-ids", refresh.smoke.task_ids.join(",")] : []),
  ...(config.tool_version ? ["--tool-version", `${config.arm}=${config.tool_version}`] : []),
];

export function validateRun(run, config, smoke = false) {
  if (run.options?.fake || run.options?.aborted) throw new Error(`${config.id}: fake or aborted run`);
  const expected = hashes();
  if (run.options?.seed !== refresh.seed || run.options?.task_set_hash !== expected.taskSet || run.options?.goldens_hash !== expected.goldens) throw new Error(`${config.id}: incompatible seed/tasks/goldens`);
  if (run.options?.refresh_hash !== configHash()) throw new Error(`${config.id}: run does not match frozen refresh configuration`);
  const rows = run.rows ?? [];
  if (!rows.length) throw new Error(`${config.id}: empty run`);
  const taskDefinitions = JSON.parse(fs.readFileSync(path.join(root, "results/canonical/tasks.json"), "utf8"));
  const expectedTasks = Object.entries(taskDefinitions).flatMap(([site, tasks]) => tasks.filter((task) => !task.excluded && (!smoke || site === refresh.smoke.site && refresh.smoke.task_ids.includes(task.id))).map((task) => `${site}|${task.id}`));
  const repeats = smoke ? 1 : refresh.attempts;
  const spec = refresh.models.find((item) => item.id === config.model);
  const snapshots = [config.model, spec?.openrouter_id].filter(Boolean);
  const cells = new Map(), ids = new Set();
  for (const row of rows) {
    if (row.arm !== config.arm || row.model !== config.model || row.transport !== config.transport || isInfraRow(row) || isProviderSetupFailure(row.failure_category)) throw new Error(`${config.id}: mismatched configuration or infrastructure row`);
    if (!snapshots.some((id) => row.model_snapshot === id || row.model_snapshot?.startsWith(id + "-")) || ![row.input_tokens, row.output_tokens, row.cached_tokens ?? 0, row.cache_write_tokens ?? 0, row.est_cost_usd].every((n) => n !== "" && n != null && Number.isFinite(Number(n)) && Number(n) >= 0) || Number(row.input_tokens) + Number(row.output_tokens) + Number(row.cached_tokens ?? 0) + Number(row.cache_write_tokens ?? 0) <= 0) throw new Error(`${config.id}: missing or incompatible snapshot/usage/cost`);
    if (smoke && (!row.pass || row.truncated || row.refusal || /^harness-/.test(row.failure_category ?? ""))) throw new Error(`${config.id}: smoke has refusal/truncation/request failure`);
    if (config.transport === "openrouter" && (row.cost_estimated !== false || !row.provider || row.provider_pin !== spec.provider || typeof row.billed_cost_usd !== "number" || row.billed_cost_usd < 0 || !Number.isFinite(row.billed_cost_usd) || Math.abs(Number(row.est_cost_usd) - row.billed_cost_usd) > 1e-9 || !JSON.parse(row.generation_ids || "[]").length)) throw new Error(`${config.id}: missing router accounting`);
    const toolVersion = config.tool_version ?? (config.arm === "cu-claude" ? versionFor(config.model) : null);
    if (toolVersion && row.tool_version !== toolVersion) throw new Error(`${config.id}: wrong tool version`);
    if (ids.has(row.run_id)) throw new Error(`${config.id}: duplicate run id`);
    ids.add(row.run_id);
    const cell = `${row.site}|${row.task_id}`;
    cells.set(cell, (cells.get(cell) ?? 0) + 1);
  }
  if (cells.size !== expectedTasks.length || expectedTasks.some((cell) => cells.get(cell) !== repeats) || rows.length !== expectedTasks.length * repeats) throw new Error(`${config.id}: incomplete task coverage; expected ${expectedTasks.length * repeats}, found ${rows.length}`);
  return rows;
}

async function main() {
  const [mode = "plan", ...argv] = process.argv.slice(2);
  if (!["plan", "preflight", "smoke", "full", "calibration"].includes(mode)) throw new Error("Usage: model-refresh.mjs plan|preflight|smoke|full|calibration [--id <config>] [--budget <total USD>]");
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--id", "--budget"].includes(argv[i]) || !argv[i + 1]) throw new Error(`Invalid option ${argv[i]}`);
    options[argv[i].slice(2)] = argv[i + 1];
  }
  const selected = mode === "calibration" ? [refresh.calibration] : [...refresh.configurations, ...(options.id === refresh.calibration.id ? [refresh.calibration] : [])].filter((config) => !options.id || config.id === options.id);
  if (!selected.length) throw new Error(`Unknown configuration: ${options.id}`);
  if (mode === "plan") {
    console.table(selected.map((c) => ({ id: c.id, model: c.model, arm: c.arm, transport: c.transport, role: c.role, attempts: 147 })));
    console.log(`${selected.length} configurations; ${selected.length * 147} full-run attempts. No inference performed.`);
    return;
  }
  const missing = new Set();
  for (const config of selected) {
    const plan = planRuns(parseArgs(argsFor(config, 1, "preflight", false)));
    for (const notice of plan.notices) missing.add(notice);
    if (plan.runs.length !== 8 && !plan.notices.length) throw new Error(`${config.id}: expected eight sites`);
  }
  console.log(`Manifest ${configHash()}; tasks/goldens ${JSON.stringify(hashes())}`);
  if (missing.size) throw new Error([...missing].join("\n"));
  execFileSync("docker", ["info", "--format", "{{.ServerVersion}}"], { stdio: "pipe" });
  const gitStatus = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();
  if (gitStatus && mode !== "preflight") throw new Error("Commit prepared harness before paid runs so provenance is reproducible.");
  if (process.env.WT_FAKE_LIFECYCLE === "1") throw new Error("Unset WT_FAKE_LIFECYCLE before live runs.");
  if (mode === "preflight") { console.log("Keys present and Docker available. No inference performed. Run smokes to validate model access."); return; }
  const budget = Number(options.budget);
  if (!Number.isFinite(budget) || budget <= 0) throw new Error("Paid modes require --budget <positive total USD>.");
  const stateRoot = path.join(root, "results/model-refresh-private");
  fs.mkdirSync(stateRoot, { recursive: true });
  // ponytail: one refresh flight per host; other harness entry points still require operator coordination.
  const lock = path.join(os.tmpdir(), "windtunnel-model-refresh.lock"), ledgerPath = path.join(stateRoot, "ledger.json");
  const handle = fs.openSync(lock, "wx");
  fs.writeSync(handle, String(process.pid));
  try {
    const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : [];
    let spent = ledger.reduce((sum, entry) => sum + entry.cost, 0);
    if (mode === "full" && selected.some((config) => config.transport === "openrouter")) {
      const calibration = ledger.findLast((entry) => entry.id === refresh.calibration.id && entry.mode === "calibration" && entry.complete && entry.hash === configHash());
      if (!calibration) throw new Error("Complete OpenRouter calibration before full router runs.");
      validateRun(JSON.parse(fs.readFileSync(path.join(calibration.dir, "run.json"), "utf8")), refresh.calibration);
    }
    for (const config of selected) {
      const previous = ledger.findLast((entry) => entry.id === config.id && entry.mode === mode && entry.complete && entry.hash === configHash());
      if (previous) { validateRun(JSON.parse(fs.readFileSync(path.join(previous.dir, "run.json"), "utf8")), config, mode === "smoke"); console.log(`Already complete: ${config.id} ${mode}`); continue; }
      if (mode !== "smoke") {
        const smoke = ledger.findLast((entry) => entry.id === config.id && entry.mode === "smoke" && entry.complete && entry.hash === configHash());
        if (!smoke) throw new Error(`Run and validate smoke for ${config.id} first.`);
        validateRun(JSON.parse(fs.readFileSync(path.join(smoke.dir, "run.json"), "utf8")), config, true);
      }
      if (spent >= budget) throw new Error(`Campaign budget reached ($${spent.toFixed(4)} / $${budget}).`);
      const label = `${config.id}-${mode}-${Date.now()}`;
      const entry = { id: config.id, mode, hash: configHash(), cost: 0, complete: false };
      ledger.push(entry);
      const saveLedger = () => { const temporary = ledgerPath + ".tmp"; fs.writeFileSync(temporary, JSON.stringify(ledger, null, 2) + "\n"); fs.renameSync(temporary, ledgerPath); };
      saveLedger();
      const result = await runBenchmark(argsFor(config, budget - spent, label, mode === "smoke"), { outputRoot: stateRoot, onAttempt(row) { entry.cost += Number(row.est_cost_usd || 0); saveLedger(); } });
      const file = path.join(result.outputDir, "run.json"), run = JSON.parse(fs.readFileSync(file, "utf8"));
      run.options.refresh_hash = configHash();
      fs.writeFileSync(file, JSON.stringify(run, null, 2) + "\n");
      const cost = recordedSpend(entry.cost, result.rows);
      let error; try { validateRun(run, config, mode === "smoke"); } catch (e) { error = e; }
      Object.assign(entry, { dir: result.outputDir, cost, complete: !error });
      saveLedger();
      spent += cost;
      if (error) throw error;
    }
    console.log(`Campaign recorded spend: $${spent.toFixed(4)}. A budget stops between attempts and can overshoot by the final attempt.`);
  } finally { fs.closeSync(handle); fs.unlinkSync(lock); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
