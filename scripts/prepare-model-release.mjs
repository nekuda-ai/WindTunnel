#!/usr/bin/env node
// Build a LOCAL release candidate. Never upload or overwrite v1.2 canonical.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { refresh } from "../harness/openrouter.mjs";
import { CSV_COLUMNS, csv, verdictFor } from "../harness/lib.mjs";
import { loadTasksBySite, renderExplorerHTML } from "../harness/build_explorer.mjs";
import { resolveTask } from "../harness/tasks.mjs";
import { root, validateRun } from "./model-refresh.mjs";

export function publicCleaner() {
  const tasks = Object.values(loadTasksBySite()).flat().map((task) => resolveTask(task, refresh.seed));
  const credentials = [...new Set(tasks.flatMap((task) => [...task.prompt.matchAll(/password(?:\s*[:=]\s*|\s+(?:is\s+)?)[`"']?([^\s,`"']+)/gi)].map((match) => match[1].replace(/[.;]$/, ""))))];
  const clean = (value) => {
    if (typeof value === "string") return credentials.reduce((text, password) => text.replaceAll(password, "[redacted]"), value)
      .replace(/\b(?:sk-ant-api\d\d-|sk-(?:proj|svcacct|or-v1)-|gh[po]_)[A-Za-z0-9_-]{10,}/g, "[redacted]")
      .replace(/\b(?:AIzaSy[A-Za-z0-9_-]{33}|xox[baprs]-[A-Za-z0-9-]{10,})/g, "[redacted]")
      .replace(/\/(?:Users|private\/tmp|tmp)\/[^\s"'<>]*/g, "[local-path]");
    if (Array.isArray(value)) return value.map(clean);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /password|authorization|api[_-]?key/i.test(key) ? "[redacted]" : clean(item)]));
    return value;
  };
  return clean;
}

export function buildRelease(dirs, out) {
  out = path.resolve(out);
  const canonical = path.join(root, "results/canonical");
  if (out === canonical || out.startsWith(canonical + path.sep)) throw new Error("Choose a separate local release directory; canonical is immutable.");
  if (fs.existsSync(out)) throw new Error("Output directory already exists; choose a fresh release candidate directory.");

  const frozen = execFileSync("git", ["show", `${refresh.base_revision}:results/canonical/run.json`], { cwd: root, maxBuffer: 100 * 1024 * 1024, encoding: "utf8" });
  const canonicalText = frozen;
  const base = JSON.parse(canonicalText), clean = publicCleaner();
  const allowed = new Set([...CSV_COLUMNS, "method", "pass", "model_snapshot", "ms", "tokens", "final_text", "evaluation_s"]);
  const publicRow = (row) => clean(Object.fromEntries(Object.entries(row).filter(([key]) => allowed.has(key))));
  const completed = new Map();
  for (const dir of dirs) {
    const run = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8"));
    const first = run.rows?.[0];
    const config = refresh.configurations.find((item) => item.arm === first?.arm && item.model === first?.model);
    if (!config) throw new Error(`${dir}: unexpected configuration`);
    if (completed.has(config.id)) throw new Error(`${config.id}: duplicate source configuration`);
    const rows = validateRun(run, config).map((row) => ({ ...publicRow(row), source: path.basename(dir) }));
    completed.set(config.id, rows);
  }
  const missing = refresh.configurations.filter((config) => !completed.has(config.id));
  if (missing.length) throw new Error(`Missing complete configurations: ${missing.map((config) => config.id).join(", ")}`);
  const publicTasks = JSON.parse(fs.readFileSync(path.join(canonical, "tasks.json"), "utf8"));
  const currentNew = refresh.configurations.filter((config) => config.role === "current").flatMap((config) => completed.get(config.id));
  const retained = base.rows.filter((row) => refresh.retain_models.includes(row.model));
  const current = [...retained, ...currentNew], history = [...base.rows, ...currentNew];
  const allIds = history.map((row) => row.run_id);
  if (new Set(allIds).size !== allIds.length) throw new Error("Duplicate attempt IDs across historical and new configurations.");
  const verdictsFor = (rows) => {
    const cells = new Map();
    for (const row of rows) { const key = `${row.site}|${row.arm}|${row.model}|${row.task_id}`; cells.set(key, [...(cells.get(key) ?? []), row]); }
    return [...cells.values()].map((rows) => ({ site: rows[0].site, taskId: rows[0].task_id, method: rows[0].arm, model: rows[0].model, tier: publicTasks[rows[0].site].find((task) => task.id === rows[0].task_id).tier, ...verdictFor(rows), source: rows[0].source }));
  };
  // All gates above run before the first write.
  fs.mkdirSync(out, { recursive: true });
  for (const [name, rows] of [["current", current], ["history", history]]) {
    const dir = path.join(out, name); fs.mkdirSync(dir);
    const options = { release: refresh.release, label: `WindTunnel ${refresh.release} ${name}`, base_revision: refresh.base_revision, seed: refresh.seed, n: refresh.attempts, privacy: "Metrics and redacted final answers only; raw transcripts omitted.", historical_prices: "Historical estimated costs preserved; current-price projections are separate." };
    fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ options, rows, verdicts: verdictsFor(rows) }, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "results.csv"), csv(rows));
    fs.writeFileSync(path.join(dir, "tasks.json"), JSON.stringify(publicTasks, null, 2) + "\n");
    fs.writeFileSync(path.join(dir, "explorer.html"), renderExplorerHTML({ rows, tasksBySite: publicTasks, canonical: true, runCount: dirs.length + 1, meta: { date: new Date().toISOString().slice(0, 10), label: options.label, preset: "full", sites: "full", n: 3, notes: [options.privacy, options.historical_prices, "OpenRouter and direct transport are recorded per row. Cross-transport timing includes the gateway hop."] } }));
  }
  const controls = refresh.configurations.filter((config) => config.role === "control").flatMap((config) => completed.get(config.id));
  fs.writeFileSync(path.join(out, "controls.json"), JSON.stringify({ rows: controls, verdicts: verdictsFor(controls) }, null, 2) + "\n");
  fs.writeFileSync(path.join(out, "PROVENANCE.md"), `# Local ${refresh.release} release candidate\n\nBase: ${refresh.base_revision} (v1.2).\n\nCurrent: 22 configurations, ${current.length} attempts. History: 38 configurations, ${history.length} attempts. Controls: ${controls.length} attempts, outside the leaderboard.\n\nSources:\n${dirs.map((dir) => `- ${path.basename(dir)}`).join("\n")}\n\nAll new configurations use the same seed/tasks/goldens and complete three-attempt cells. Raw transcripts are omitted; fixture credentials are redacted. The prior cost figures are preserved. This directory has not been uploaded or published.\n`);
  return { current: current.length, history: history.length, controls: controls.length, out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  try {
    const [out, ...dirs] = process.argv.slice(2);
    if (!out || !dirs.length) throw new Error("Usage: prepare-model-release.mjs <fresh-output-dir> <completed-config-dir> [...]");
    console.log(buildRelease(dirs.map((dir) => path.resolve(dir)), out));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
