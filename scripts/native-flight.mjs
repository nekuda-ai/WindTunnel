#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { refresh } from "../harness/openrouter.mjs";
import { runBenchmark } from "../harness/cli.mjs";
import { isInfraRow } from "../harness/lib.mjs";
import { argsFor, configHash, validateRun, root } from "./model-refresh.mjs";
import { hashes } from "../scoring/report.mjs";
import { setRequestBudget } from "../harness/native-request.mjs";

let directory = path.join(root, "results/model-refresh-private/native-flight");
let statePath = path.join(directory, "status.json"), stopPath = path.join(directory, "STOP");
const lockPath = path.join(os.tmpdir(), "windtunnel-model-refresh.lock");
const cellKey = row => JSON.stringify([row.site, row.arm, row.model, row.task_id, row.attempt_index]);

export function readCheckpoint(file, fingerprint, { strictBilling = false } = {}) {
  if (!fs.existsSync(file)) return { rows: [], spend: 0, capsules: [], inflight: null, report: null, interrupted: 0 };
  const text = fs.readFileSync(file, "utf8"), end = text.lastIndexOf("\n") + 1;
  if (end < text.length) {
    fs.writeFileSync(`${file}.partial-${Date.now()}`, text.slice(end), { mode: 0o600 });
    fs.truncateSync(file, Buffer.byteLength(text.slice(0, end)));
  }
  const events = text.slice(0, end).split("\n").filter(Boolean).map(line => JSON.parse(line));
  if (events[0]?.fingerprint !== fingerprint) throw new Error("Checkpoint fingerprint changed; refusing to mix harness versions");
  const rows = new Map(), capsules = new Map();
  let spend = 0, inflight = null, report = null, interrupted = 0;
  for (const entry of events.slice(1)) {
    if (entry.event === "start") { if (inflight) interrupted++; inflight = entry.cell; }
    if (entry.event === "attempt") {
      if (!Number.isFinite(Number(entry.row.est_cost_usd)) || Number(entry.row.est_cost_usd) < 0) throw new Error("Invalid checkpoint cost");
      spend += Number(entry.row.est_cost_usd);
      if (!isInfraRow(entry.row)) {
        const key = cellKey(entry.row);
        if (rows.has(key)) throw new Error("Duplicate scored checkpoint attempt");
        rows.set(key, entry.row);
      }
      inflight = null;
    }
    if (entry.event === "capsule") capsules.set(entry.capsule.siteId, entry.capsule);
    if (entry.event === "complete") report = entry.dir;
  }
  if (strictBilling && (inflight || interrupted)) throw new Error("Unfinished provider request: reconcile billing before resuming this campaign");
  return { rows: [...rows.values()], spend, capsules: [...capsules.values()], inflight, report, interrupted };
}

export function appendCheckpoint(file, fingerprint, entry) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const exists = fs.existsSync(file);
  const descriptor = fs.openSync(file, "a", 0o600);
  try {
    if (!exists) fs.writeSync(descriptor, JSON.stringify({ fingerprint }) + "\n");
    fs.writeSync(descriptor, JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + "\n");
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function saveStatus(state) {
  fs.mkdirSync(directory, { recursive: true });
  const temporary = statePath + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  const descriptor = fs.openSync(temporary, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, statePath);
}

function alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; } }
const secrets = Object.entries(process.env).filter(([key, value]) => /KEY|TOKEN|SECRET/.test(key) && value).map(([, value]) => value);
function safe(value) { let text = String(value); for (const secret of secrets) text = text.split(secret).join("[REDACTED]"); return text; }

async function main() {
  const [mode = "status", ...argv] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!["--hours", "--budget", "--ids", "--campaign", "--mode"].includes(argv[i]) || !argv[i + 1]) throw new Error("Invalid flight option");
    options[argv[i].slice(2)] = argv[i + 1];
  }
  if (options.campaign) {
    if (!/^[a-z0-9-]+$/.test(options.campaign)) throw new Error("Invalid campaign name");
    directory = path.join(root, `results/model-refresh-private/${options.campaign}`);
    statePath = path.join(directory, "status.json"); stopPath = path.join(directory, "STOP");
  }
  if (options.mode && !["smoke", "full"].includes(options.mode)) throw new Error("Mode must be smoke or full");
  if (mode === "status") {
    const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, "utf8")) : { status: "not started" };
    if (state.status === "running" && !alive(state.pid)) state.status = "interrupted; safe to resume completed attempts";
    console.log(JSON.stringify(state)); return;
  }
  if (mode === "stop") { fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(stopPath, "pause after current attempt\n"); console.log("Stop requested. Completed attempts are retained; the current attempt finishes before stopping."); return; }
  if (mode !== "start") throw new Error("Usage: native-flight.mjs start --hours <hours> --budget <USD> [--ids <config,config>] | status | stop");
  const holdPath = path.join(directory, "ACCOUNTING_HOLD");
  if (fs.existsSync(holdPath)) throw new Error("Reconcile the uncertain provider request before resuming; see ACCOUNTING_HOLD");
  const hours = Number(options.hours), budget = Number(options.budget);
  if (!Number.isFinite(hours) || hours <= 0 || !Number.isFinite(budget) || budget <= 0) throw new Error("Provide positive --hours and --budget");
  if (process.env.WT_FAKE_LIFECYCLE || process.env.WT_MANUAL_BASEURL) throw new Error("Live flight rejects fake/manual environments");
  if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) throw new Error("Commit the harness before live flight");
  execFileSync("docker", ["info"], { stdio: "ignore" });
  const native = refresh.configurations.filter(config => /^(claude-|gpt-|gemini-|muse-)/.test(config.model)).map(config => ({ ...config, transport: config.model.startsWith("muse-") ? config.transport : "direct" }));
  const ids = options.ids?.split(",") ?? ["gpt-6-luna-wm-gpt", "gpt-6-luna-cu-openai", "claude-haiku-5-5-wm-claude", "claude-haiku-5-5-cu-claude"];
  const selected = ids.map(id => { const config = native.find(config => config.id === id); if (!config) throw new Error(`Unknown native config ${id}`); return config; });
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate config IDs");
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, "utf8").trim());
    if (!Number.isInteger(pid) || pid <= 0 || alive(pid)) throw new Error("Another flight owns the lock; do not start a second runner");
    fs.unlinkSync(lockPath);
  }
  const lock = fs.openSync(lockPath, "wx"); fs.writeSync(lock, String(process.pid));
  if (fs.existsSync(stopPath)) fs.unlinkSync(stopPath);
  const deadline = Date.now() + hours * 3600000;
  const hash = configHash();
  const fingerprint = config => crypto.createHash("sha256").update(hash).update(JSON.stringify(hashes())).update(JSON.stringify(config)).digest("hex");
  let signalled = false;
  process.on("SIGINT", () => { signalled = true; }); process.on("SIGTERM", () => { signalled = true; });
  const stopped = () => signalled || fs.existsSync(stopPath) || Date.now() >= deadline || fs.existsSync(holdPath);
  const checkpoints = new Map();
  for (const config of native) for (const runMode of ["smoke", "full"]) {
    const file = path.join(directory, `${config.id}-${runMode}.jsonl`);
    try { checkpoints.set(`${config.id}-${runMode}`, { file, saved: readCheckpoint(file, fingerprint(config), { strictBilling: !!options.campaign }) }); }
    catch (error) { fs.closeSync(lock); fs.unlinkSync(lockPath); throw error; }
  }
  let spend = [...checkpoints.values()].reduce((sum, item) => sum + item.saved.spend, 0);
  const state = { status: "running", pid: process.pid, started: new Date().toISOString(), deadline: new Date(deadline).toISOString(), budget_usd: budget, spend_usd: spend, campaign: options.campaign ?? "native-flight", mode: options.mode ?? "full", selected: ids, completed_configs: [], current: null };
  const update = () => { state.spend_usd = spend; state.updated = new Date().toISOString(); saveStatus(state); };
  try {
    update();
    for (const config of selected) for (const runMode of options.mode === "smoke" ? ["smoke"] : ["smoke", "full"]) {
      const key = `${config.id}-${runMode}`, checkpoint = checkpoints.get(key), saved = checkpoint.saved;
      if (saved.report) {
        validateRun(JSON.parse(fs.readFileSync(path.join(saved.report, "run.json"), "utf8")), config, runMode === "smoke");
        if (runMode === "full") state.completed_configs.push(config.id);
        update(); continue;
      }
      if (stopped() || spend >= budget) { state.status = "paused"; state.reason = spend >= budget ? "spending cap reached" : "operator/time limit"; update(); return; }
      state.current = { id: config.id, mode: runMode, completed_attempts: saved.rows.length, total_attempts: runMode === "smoke" ? 2 : 147 };
      if (saved.inflight) state.warning = "An interrupted provider request may have been billed without a receipt; reconcile vendor usage. Only that unfinished attempt is restarted.";
      update();
      setRequestBudget(budget - spend);
      const result = await runBenchmark(argsFor(config, budget - spend, `native-${config.id}-${runMode}-${Date.now()}`, runMode === "smoke"), {
        outputRoot: directory, resumeRows: saved.rows, resumeCapsules: saved.capsules, shouldStop: stopped,
        log: line => console.log(safe(line)),
        onStart(cell) { appendCheckpoint(checkpoint.file, fingerprint(config), { event: "start", cell }); state.current.attempt = cell; update(); },
        onAttempt(row) {
          appendCheckpoint(checkpoint.file, fingerprint(config), { event: "attempt", row });
          spend += Number(row.est_cost_usd || 0);
          if (/provider-accounting: uncertain request/.test(row.failure_category ?? "")) {
            fs.writeFileSync(holdPath, "Provider billing is uncertain. Reconcile usage before removing this hold.\n", { mode: 0o600 });
            state.warning = "Uncertain provider billing; resume is blocked until reconciliation.";
          }
          if (!isInfraRow(row)) state.current.completed_attempts++;
          state.current.last_pass = row.pass; state.current.last_failure = safe(row.failure_category ?? "").slice(0, 250);
          delete state.current.attempt; update();
        },
        onBatch(result) { appendCheckpoint(checkpoint.file, fingerprint(config), { event: "capsule", capsule: result.capsule }); },
      });
      const runPath = path.join(result.outputDir, "run.json"), run = JSON.parse(fs.readFileSync(runPath, "utf8"));
      run.options.refresh_hash = hash; fs.writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n");
      if (stopped() || result.options.aborted || run.options.aborted) { state.status = "paused"; state.reason = safe(run.options.aborted ?? "operator/time limit"); update(); return; }
      validateRun(run, config, runMode === "smoke");
      appendCheckpoint(checkpoint.file, fingerprint(config), { event: "complete", dir: result.outputDir });
      if (runMode === "full") state.completed_configs.push(config.id);
      console.log(`Complete: ${config.id} ${runMode}; total recorded $${spend.toFixed(4)}`); update();
    }
    state.status = "complete"; state.current = null; update();
  } catch(error) { state.status = "paused"; state.reason = safe(error.message); update(); throw error; }
  finally { fs.closeSync(lock); fs.unlinkSync(lockPath); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) main().catch(error => { console.error(safe(error.message)); process.exitCode = 1; });
