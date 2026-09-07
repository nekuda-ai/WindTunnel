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
import { run as runCodeOpenAI, TOOL_VERSION as CODE_OPENAI_VERSION } from "../arms/code-openai.mjs";
import { run as runWMStagehand, TOOL_VERSION as WM_STAGEHAND_VERSION } from "../arms/wm-stagehand.mjs";
import { run as runWMStagehandV4, TOOL_VERSION as WM_STAGEHAND_V4_VERSION } from "../arms/wm-stagehand-v4.mjs";
import { run as runWMStagehandV4Gemini, TOOL_VERSION as WM_STAGEHAND_V4_GEMINI_VERSION } from "../arms/wm-stagehand-v4-gemini.mjs";
import { run as runCUGemini, TOOL_VERSION as CU_GEMINI_VERSION } from "../arms/cu-gemini.mjs";
import { run as runWMGemini, TOOL_VERSION as WM_GEMINI_VERSION } from "../arms/wm-gemini.mjs";
import { bootCapsule } from "./capsule.mjs";
import { runBatch } from "./run.mjs";
import { resolveProfile, loadSites } from "./sites.mjs";
import { loadTaskFile, loadTasks, resolveTask, taskFile } from "./tasks.mjs";
import { writeReport } from "../scoring/report.mjs";
import { isInfraRow } from "./lib.mjs";
import { apiKeyEnvFor } from "../arms/prompts.mjs";

const PRESETS = { smoke: { n: 1 }, lite: { n: 3 }, full: { n: 3 } };
const ARMS = {
  scripted: { id: "scripted", run: runScripted, model: "none", paid: false },
  "cu-claude": { id: "cu-claude", run: runCUClaude, model: "claude-sonnet-4-6", version: CU_CLAUDE_VERSION, key: "ANTHROPIC_API_KEY", paid: true },
  "cu-openai": { id: "cu-openai", run: runCUOpenAI, model: "gpt-5.5", version: CU_OPENAI_VERSION, key: "OPENAI_API_KEY", paid: true },
  "code-openai": { id: "code-openai", run: runCodeOpenAI, model: "gpt-6-astra", version: CODE_OPENAI_VERSION, key: "OPENAI_API_KEY", paid: true },
  // The two structured arms are reused across providers via --model (Luna runs
  // through them), so their credential follows the EFFECTIVE model rather than
  // being pinned to Anthropic — otherwise a Luna run would demand an unused
  // ANTHROPIC_API_KEY and authenticate against the wrong provider.
  "dom-browseruse": { id: "dom-browseruse", run: runBrowserUse, model: "claude-sonnet-4-6", version: BROWSERUSE_VERSION, key: apiKeyEnvFor, paid: true },
  "a11y-stagehand": { id: "a11y-stagehand", run: runStagehand, model: "claude-sonnet-4-6", version: STAGEHAND_VERSION, key: apiKeyEnvFor, paid: true },
  "wm-claude": { id: "wm-claude", run: runWMClaude, model: "claude-sonnet-4-6", version: "@anthropic-ai/sdk", key: "ANTHROPIC_API_KEY", paid: true, webmcp: true },
  "wm-gpt": { id: "wm-gpt", run: runWMGPT, model: "gpt-5.5", version: "responses-api", key: "OPENAI_API_KEY", paid: true, webmcp: true },
  "wm-stagehand": { id: "wm-stagehand", run: runWMStagehand, model: "claude-sonnet-4-6", version: WM_STAGEHAND_VERSION, key: "ANTHROPIC_API_KEY", paid: true, webmcp: true },
  "wm-stagehand-v4": { id: "wm-stagehand-v4", run: runWMStagehandV4, model: "claude-sonnet-4-6", version: WM_STAGEHAND_V4_VERSION, key: "ANTHROPIC_API_KEY", paid: true, webmcp: true },
  "wm-stagehand-v4-gemini": { id: "wm-stagehand-v4-gemini", run: runWMStagehandV4Gemini, model: "gemini-3.6-flash", version: WM_STAGEHAND_V4_GEMINI_VERSION, key: "GEMINI_API_KEY", paid: true, webmcp: true },
  "cu-gemini": { id: "cu-gemini", run: runCUGemini, model: "gemini-3.6-flash", version: CU_GEMINI_VERSION, key: "GEMINI_API_KEY", paid: true },
  "wm-gemini": { id: "wm-gemini", run: runWMGemini, model: "gemini-3.6-flash", version: WM_GEMINI_VERSION, key: "GEMINI_API_KEY", paid: true, webmcp: true },
};

export const USAGE = `Usage: node harness/cli.mjs [options]

  --preset <smoke|lite|full>  Task preset (default: smoke)
  --sites <profile|a,b>       Site profile or comma-separated ids (default: lite)
  --tasks <file>              Load tasks from a specific YAML file
  --task-ids <a,b>            Run only these task ids; repeats are preserved
  --arms <a,b>                Methods to run (default: scripted)
  --n <odd number>            Repeats per task
  --seed <number>             Fixture seed (default: 1)
  --budget <usd>              Hard spending cap
  --max-consecutive-infra <n> Abort the flight after n consecutive infrastructure
                              failures (default 2; 0 disables)
  --perturbed                 Enable perturbations
  --label <name>              Label this run
  --model <arm=model>         Override a method model
  --help                      Show this usage`;

export function parseArgs(argv) {
  const options = { preset: "smoke", sites: "lite", arms: ["scripted"], seed: 1, budget: Infinity, perturbed: false, models: {}, maxConsecutiveInfra: 2 };
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
      else if (flag === "--task-ids") options.taskIds = value.split(",").filter(Boolean);
      else if (flag === "--arms") options.arms = value.split(",").filter(Boolean);
      else if (flag === "--n") { options.n = Number(value); explicitN = true; }
      else if (flag === "--seed") options.seed = Number(value);
      else if (flag === "--budget") options.budget = Number(value);
      else if (flag === "--max-consecutive-infra") options.maxConsecutiveInfra = Number(value);
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
    const model = options.models[armId] ?? method.model;
    const key = typeof method.key === "function" ? method.key(model) : method.key;
    if (key && !env[key]) { notices.push(`Skipping ${armId}: ${key} is not set.`); continue; }
    if (method.paid && options.budget <= 0) { notices.push(`Skipping ${armId}: budget hard stop reached.`); continue; }
    for (const siteId of sites) runs.push({ siteId, method: { ...method, model, key } });
  }
  return { runs, notices };
}

function fakePage() {
  const locator = () => ({ async fill() {}, async click() {}, async press() {}, async innerText() { return "fake page content"; } });
  // Enough Playwright surface for every arm's setup + action path (CU mouse /
  // keyboard, WebMCP bridge install + discovery, code-exec screenshot) so a
  // WT_FAKE_LIFECYCLE dry run reaches the model API instead of crashing in setup.
  const noop = async () => {};
  const PNG_1x1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
  const context = { addInitScript: noop, browser: () => ({}) };
  return {
    goto: noop, async title() { return "fake page"; }, locator,
    setViewportSize: noop, waitForLoadState: noop, waitForTimeout: noop, waitForFunction: noop,
    async screenshot() { return PNG_1x1; }, async evaluate() { return []; }, context: () => context,
    mouse: { click: noop, dblclick: noop, move: noop, down: noop, up: noop, wheel: noop },
    keyboard: { type: noop, press: noop, down: noop, up: noop },
  };
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
  // A provider outage produces a run of infrastructure failures. Continuing
  // through one burns the remaining attempts and fills the artifact with cells
  // that measure the outage, not the model — so stop the flight and let it be
  // restarted cleanly once the provider recovers.
  let consecutiveInfra = 0, abortedReason = "";
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
    if (abortedReason) break;
    if (method.paid && budgetExceeded) {
      log(`Skipping ${method.id}: budget hard stop reached ($${cost.toFixed(4)} > $${options.budget.toFixed(2)}).`);
      continue;
    }
    if (!method.run) { log(`Skipping ${method.id}: not yet implemented.`); continue; }
    const browser = await openPage(env);
    const { WT_WEBMCP: _ignored, ...armEnv } = env;
    if (method.webmcp) armEnv.WT_WEBMCP = "1";
    try {
      const availableTasks = options.tasks ? loadTaskFile(options.tasks) : loadTasks(siteId);
      const selectedTasks = options.taskIds
        ? options.taskIds.map((id) => {
          const task = availableTasks.find((candidate) => candidate.id === id);
          if (!task) throw new Error(`unknown task for ${siteId}: ${id}`);
          return task;
        })
        : availableTasks;
      const tasks = selectedTasks.map((task) => resolveTask(task, options.seed));
      const result = await runBatch({
        siteId, method, tasks, n: options.n, seed: options.seed, port: 3215 + index,
        model: method.model, perturbed: options.perturbed, browser,
        boot: (id, bootOptions) => boot(id, { ...bootOptions, env: armEnv }),
        onResult: (row) => {
          streamRow(row);
          if (isInfraRow(row)) {
            consecutiveInfra++;
            if (options.maxConsecutiveInfra > 0 && consecutiveInfra >= options.maxConsecutiveInfra) {
              abortedReason = `${consecutiveInfra} consecutive infrastructure failures (last: ${row.failure_category})`;
              log(`ABORTING FLIGHT: ${abortedReason}`);
              return false;
            }
          } else {
            consecutiveInfra = 0;
          }
          if (!method.paid) return;
          cost += Number(row.est_cost_usd || 0);
          if (cost > options.budget) {
            budgetExceeded = true;
            abortedReason = abortedReason || `budget hard stop after ${row.task_id} ($${cost.toFixed(4)} > $${options.budget.toFixed(2)}) — flight is incomplete`;
            log(`Budget hard stop reached after ${row.task_id} ($${cost.toFixed(4)} > $${options.budget.toFixed(2)}).`);
            return false;
          }
        },
      });
      rows.push(...result.rows);
      verdicts.push(...result.verdicts);
      // A failed teardown is an incident worth auditing after the flight — keep it
      // on the run record and in the live journal, not only on the console.
      capsules.push(result.teardown_error ? { ...result.capsule, teardown_error: result.teardown_error } : result.capsule);
      if (result.teardown_error) {
        log(`Teardown failed for ${method.id} × ${siteId}: ${result.teardown_error}`);
        fs.appendFileSync(livePath, JSON.stringify({ teardown_failed: `${method.id} × ${siteId}`, error: result.teardown_error.slice(0, 300) }) + "\n");
      }
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
  if (abortedReason) log(`Flight aborted — artifact is INCOMPLETE and must not enter the canonical set: ${abortedReason}`);
  const outputDir = writeReport({ rows, verdicts, capsules, options: { ...options, aborted: abortedReason || undefined, fake: env.WT_FAKE_LIFECYCLE === "1", label: options.label ?? `${options.sites}-${options.preset}`, model: [...new Set(plan.runs.map(({ method }) => method.model))].join(","), armModels: Object.fromEntries(plan.runs.map(({ method }) => [method.id, method.model])) }, outputRoot });
  log(`Report: ${path.join(outputDir, "report.md")}`);
  return { rows, verdicts, capsules, outputDir, options };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  runBenchmark(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
