#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { run as runScripted } from "../arms/scripted.mjs";
import { run as runBrowserUse, TOOL_VERSION as BROWSERUSE_VERSION } from "../arms/browseruse.mjs";
import { run as runCUClaude, TOOL_VERSION as CU_CLAUDE_VERSION } from "../arms/cu-claude.mjs";
import { run as runStagehand, TOOL_VERSION as STAGEHAND_VERSION } from "../arms/stagehand.mjs";
import { run as runWMClaude } from "../arms/wm-claude.mjs";
import { run as runWMGPT } from "../arms/wm-gpt.mjs";
import { run as runCUOpenAI, TOOL_VERSION as CU_OPENAI_VERSION } from "../arms/cu-openai.mjs";
import { run as runWMStagehand, TOOL_VERSION as WM_STAGEHAND_VERSION } from "../arms/wm-stagehand.mjs";
import { bootCapsule } from "./capsule.mjs";
import { runBatch } from "./run.mjs";
import { resolveProfile, loadSites } from "./sites.mjs";
import { loadTaskFile, loadTasks, resolveTask, taskFile } from "./tasks.mjs";
import { writeReport } from "../scoring/report.mjs";

const PRESETS = { smoke: { n: 1 }, lite: { n: 3 }, full: { n: 3 } };
const ARMS = {
  scripted: { id: "scripted", run: runScripted, model: "none", paid: false },
  "cu-claude": { id: "cu-claude", run: runCUClaude, model: "claude-sonnet-4-6", version: CU_CLAUDE_VERSION, key: "ANTHROPIC_API_KEY", paid: true },
  "cu-openai": { id: "cu-openai", run: runCUOpenAI, model: "gpt-5.5", version: CU_OPENAI_VERSION, key: "OPENAI_API_KEY", paid: true },
  "dom-browseruse": { id: "dom-browseruse", run: runBrowserUse, model: "claude-sonnet-4-6", version: BROWSERUSE_VERSION, key: "ANTHROPIC_API_KEY", paid: true },
  "a11y-stagehand": { id: "a11y-stagehand", run: runStagehand, model: "claude-sonnet-4-6", version: STAGEHAND_VERSION, key: "ANTHROPIC_API_KEY", paid: true },
  "wm-claude": { id: "wm-claude", run: runWMClaude, model: "claude-sonnet-4-6", version: "@anthropic-ai/sdk", key: "ANTHROPIC_API_KEY", paid: true, webmcp: true },
  "wm-gpt": { id: "wm-gpt", run: runWMGPT, model: "gpt-5.5", version: "responses-api", key: "OPENAI_API_KEY", paid: true, webmcp: true },
  "wm-stagehand": { id: "wm-stagehand", run: runWMStagehand, model: "claude-sonnet-4-6", version: WM_STAGEHAND_VERSION, key: "ANTHROPIC_API_KEY", paid: true, webmcp: true },
};

export const USAGE = `Usage: node harness/cli.mjs [options]

  --preset <smoke|lite|full>  Task preset (default: smoke)
  --sites <profile|a,b>       Site profile or comma-separated ids (default: lite)
  --tasks <file>              Load tasks from a specific YAML file
  --arms <a,b>                Methods to run (default: scripted)
  --n <odd number>            Repeats per task
  --seed <number>             Fixture seed (default: 1)
  --budget <usd>              Hard spending cap
  --perturbed                 Enable perturbations
  --label <name>              Label this run
  --model <arm=model>         Override a method model
  --help                      Show this usage`;

export function parseArgs(argv) {
  const options = { preset: "smoke", sites: "lite", arms: ["scripted"], seed: 1, budget: Infinity, perturbed: false, models: {} };
  let explicitN = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--help") options.help = true;
    else if (flag === "--perturbed") options.perturbed = true;
    else {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${flag}`);
      if (flag === "--preset") options.preset = value;
      else if (flag === "--sites") options.sites = value;
      else if (flag === "--tasks") options.tasks = value;
      else if (flag === "--arms") options.arms = value.split(",").filter(Boolean);
      else if (flag === "--n") { options.n = Number(value); explicitN = true; }
      else if (flag === "--seed") options.seed = Number(value);
      else if (flag === "--budget") options.budget = Number(value);
      else if (flag === "--label") options.label = value;
      else if (flag === "--model") {
        const [arm, ...model] = value.split("=");
        if (!arm || !model.length) throw new Error("--model must be arm=model");
        options.models[arm] = model.join("=");
      } else throw new Error(`unknown option: ${flag}`);
    }
  }
  if (!PRESETS[options.preset]) throw new Error(`unknown preset: ${options.preset}`);
  if (!explicitN) options.n = PRESETS[options.preset].n;
  if (!Number.isInteger(options.n) || options.n < 1 || options.n % 2 === 0) throw new Error("--n must be a positive odd integer");
  if (!Number.isFinite(options.seed) || !Number.isFinite(options.budget) && options.budget !== Infinity || options.budget < 0) throw new Error("seed and budget must be non-negative numbers");
  if (options.perturbed) throw new Error("perturbations are not implemented");
  return options;
}

function selectedSites(value) {
  if (value.includes(",")) {
    const ids = value.split(",").filter(Boolean);
    const known = new Set(loadSites().map(({ id }) => id));
    for (const id of ids) if (!known.has(id)) throw new Error(`unknown site: ${id}`);
    return ids;
  }
  if (loadSites().some(({ id }) => id === value)) return [value];
  return resolveProfile(value);
}

export function planRuns(options, env = process.env, methods = ARMS) {
  const sites = selectedSites(options.sites);
  const notices = [];
  const runs = [];
  for (const armId of options.arms) {
    const method = methods[armId];
    if (!method) throw new Error(`unknown arm: ${armId}`);
    if (method.key && !env[method.key]) { notices.push(`Skipping ${armId}: ${method.key} is not set.`); continue; }
    if (method.paid && options.budget <= 0) { notices.push(`Skipping ${armId}: budget hard stop reached.`); continue; }
    for (const siteId of sites) runs.push({ siteId, method: { ...method, model: options.models[armId] ?? method.model } });
  }
  return { runs, notices };
}

function fakePage() {
  const locator = () => ({ async fill() {}, async click() {}, async press() {}, async innerText() { return "fake page content"; } });
  return { async goto() {}, async title() { return "fake page"; }, locator };
}

async function openPage(env) {
  if (env.WT_FAKE_LIFECYCLE === "1") return { newContext: async () => ({ newPage: async () => fakePage(), close: async () => {} }), close: async () => {} };
  const browser = await chromium.launch({ headless: true, ...(env.WT_CHROME ? { executablePath: env.WT_CHROME } : {}) });
  return browser;
}

export async function runBenchmark(argv, {
  env = process.env,
  outputRoot,
  log = console.log,
  methods = ARMS,
  boot = bootCapsule,
} = {}) {
  const options = parseArgs(argv);
  if (options.help) { log(USAGE); return { options }; }
  const plan = planRuns(options, env, methods);
  plan.notices.forEach(log);
  // Fail before anything boots (or spends money), not mid-run with rows lost.
  if (!options.tasks) {
    const missing = [...new Set(plan.runs.map(({ siteId }) => siteId))].filter((id) => !fs.existsSync(taskFile(id)));
    if (missing.length) throw new Error(`no task file for site(s): ${missing.join(", ")} — add tasks/<site>.yaml or pass --tasks <file>`);
  }
  const rows = [], verdicts = [], capsules = [];
  let cost = 0;
  let budgetExceeded = false;
  // Live journal: every finished attempt is appended immediately (transcript
  // and final_text stripped — run.json carries those at the end), so a
  // 20-hour run has a mid-flight scoreboard instead of an all-or-nothing
  // write at the finish line. Truncated at run start; git-ignored.
  const liveRoot = outputRoot ?? path.resolve(import.meta.dirname, "../results");
  fs.mkdirSync(liveRoot, { recursive: true });
  const livePath = path.join(liveRoot, "live.jsonl");
  fs.writeFileSync(livePath, "");
  const streamRow = (row) => {
    const { transcript, final_text, ...lean } = row;
    try { fs.appendFileSync(livePath, JSON.stringify(lean) + "\n"); } catch { /* journal is best-effort */ }
  };
  for (let index = 0; index < plan.runs.length; index++) {
    const { siteId, method } = plan.runs[index];
    if (method.paid && budgetExceeded) {
      log(`Skipping ${method.id}: budget hard stop reached ($${cost.toFixed(4)} > $${options.budget.toFixed(2)}).`);
      continue;
    }
    if (!method.run) { log(`Skipping ${method.id}: not yet implemented.`); continue; }
    const browser = await openPage(env);
    const { WT_WEBMCP: _ignored, ...armEnv } = env;
    if (method.webmcp) armEnv.WT_WEBMCP = "1";
    try {
      const tasks = (options.tasks ? loadTaskFile(options.tasks) : loadTasks(siteId))
        .map((task) => resolveTask(task, options.seed));
      const result = await runBatch({
        siteId, method, tasks, n: options.n, seed: options.seed, port: 3215 + index,
        model: method.model, perturbed: options.perturbed, browser,
        boot: (id, bootOptions) => boot(id, { ...bootOptions, env: armEnv }),
        onResult: (row) => {
          streamRow(row);
          if (!method.paid) return;
          cost += Number(row.est_cost_usd || 0);
          if (cost > options.budget) {
            budgetExceeded = true;
            log(`Budget hard stop reached after ${row.task_id} ($${cost.toFixed(4)} > $${options.budget.toFixed(2)}).`);
            return false;
          }
        },
      });
      rows.push(...result.rows);
      verdicts.push(...result.verdicts);
      capsules.push(result.capsule);
    } catch (error) {
      // A capsule that won't boot must cost one batch, not the whole run —
      // a 20-hour flight once died at batch 31/56 (a broken seed on a cold
      // prepare) with every earlier row still unwritten. Rows from completed
      // batches are already safe (pushed above + streamed to live.jsonl);
      // record the loss and move on. Attempt-level errors never reach here —
      // runBatch scores those as failed attempts.
      log(`Batch failed, skipping ${method.id} × ${siteId}: ${error.message}`);
      fs.appendFileSync(path.join(liveRoot, "live.jsonl"), JSON.stringify({ batch_failed: `${method.id} × ${siteId}`, error: error.message.slice(0, 300) }) + "\n");
    } finally {
      await browser.close();
    }
  }
  const outputDir = writeReport({ rows, verdicts, capsules, options: { ...options, fake: env.WT_FAKE_LIFECYCLE === "1", label: options.label ?? `${options.sites}-${options.preset}`, model: [...new Set(plan.runs.map(({ method }) => method.model))].join(","), armModels: Object.fromEntries(plan.runs.map(({ method }) => [method.id, method.model])) }, outputRoot });
  log(`Report: ${path.join(outputDir, "report.md")}`);
  return { rows, verdicts, outputDir, options };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  runBenchmark(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
