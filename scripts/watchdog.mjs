#!/usr/bin/env node
// Independent spend watchdog. Runs as its OWN process, keeps its OWN ledger,
// and kills the benchmark if the absolute cap is reached — the harness's
// `--budget` flag is a per-flight limit enforced inside the process that is
// doing the spending, which is exactly the thing you cannot rely on.
//
//   node scripts/watchdog.mjs --cap 160 [--poll 15] [--ledger <path>]
//
// The harness truncates results/live.jsonl at the start of every flight, so a
// per-flight file cannot answer "how much has this whole refresh cost". The
// watchdog therefore folds every attempt it sees into a persistent ledger keyed
// by run_id (unique per attempt), which is idempotent across restarts and
// immune to the file being truncated between flights.
//
// It also writes a status file each poll so the operator can report spend
// without asking the benchmark process anything.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const CAP = Number(arg("cap", 160));
const POLL_MS = Number(arg("poll", 15)) * 1000;
const LEDGER = path.resolve(arg("ledger", path.join(ROOT, ".watchdog-ledger.jsonl")));
const STATUS = path.join(path.dirname(LEDGER), "watchdog-status.json");
const LIVE = path.join(ROOT, "results/live.jsonl");
const killPatterns = (arg("kill-pattern", "harness/cli.mjs")).split(",").filter(Boolean);
if (!Number.isFinite(CAP) || CAP <= 0) { console.error("--cap must be a positive number"); process.exit(2); }

// run_id -> cost. Rebuilt from the ledger on start so a restart never
// double-counts and never forgets.
const seen = new Map();
if (fs.existsSync(LEDGER)) {
  for (const line of fs.readFileSync(LEDGER, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { const row = JSON.parse(line); seen.set(row.run_id, Number(row.cost) || 0); } catch { /* skip torn line */ }
  }
}
const total = () => [...seen.values()].reduce((sum, cost) => sum + cost, 0);
console.log(`watchdog: cap $${CAP.toFixed(2)}, ledger ${LEDGER}, resuming at $${total().toFixed(4)} over ${seen.size} attempts`);

function harvest() {
  if (!fs.existsSync(LIVE)) return 0;
  let added = 0;
  for (const line of fs.readFileSync(LIVE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }   // last line may be mid-write
    if (!row.run_id || seen.has(row.run_id)) continue;
    const cost = Number(row.est_cost_usd) || 0;
    seen.set(row.run_id, cost);
    fs.appendFileSync(LEDGER, JSON.stringify({ run_id: row.run_id, cost, arm: row.arm, model: row.model, task_id: row.task_id, at: new Date().toISOString() }) + "\n");
    added++;
  }
  return added;
}

// Kill anything running the benchmark. Deliberately blunt: at the absolute cap
// the correct action is to stop spending, not to negotiate with the runner.
function halt(spent) {
  const message = `WATCHDOG HALT: $${spent.toFixed(4)} reached the $${CAP.toFixed(2)} absolute cap`;
  console.error(message);
  // NOTE: pkill matches on command line only, so a flight running from another
  // checkout of this repo would also be killed. Narrow with --kill-pattern when
  // more than one checkout can run concurrently.
  for (const pattern of killPatterns) {
    try {
      const pids = execFileSync("pgrep", ["-f", pattern]).toString().trim().split("\n").filter(Boolean);
      if (pids.length) { execFileSync("pkill", ["-f", pattern]); console.error(`  killed ${pids.length} process(es) matching ${pattern}: ${pids.join(", ")}`); }
    } catch { /* nothing matched */ }
  }
  fs.writeFileSync(STATUS, JSON.stringify({ halted: true, spent, cap: CAP, attempts: seen.size, at: new Date().toISOString(), message }, null, 2));
  process.exit(1);
}

process.on("SIGINT", () => { console.log(`watchdog: stopping at $${total().toFixed(4)}`); process.exit(0); });

while (true) {
  const added = harvest();
  const spent = total();
  fs.writeFileSync(STATUS, JSON.stringify({
    halted: false, spent, cap: CAP, remaining: Math.max(0, CAP - spent),
    attempts: seen.size, at: new Date().toISOString(),
  }, null, 2));
  if (added) console.log(`watchdog: +${added} attempts, $${spent.toFixed(4)} / $${CAP.toFixed(2)} (${((spent / CAP) * 100).toFixed(1)}%)`);
  if (spent >= CAP) halt(spent);
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
