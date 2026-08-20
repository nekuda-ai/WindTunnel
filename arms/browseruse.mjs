import { spawn } from "node:child_process";
import path from "node:path";
import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { BASE_SYSTEM, MECHANICS, samplingFor } from "./prompts.mjs";

export const TOOL_VERSION = "browser-use@0.12.7";
// The browser-use virtualenv is gitignored and per-checkout. WT_BROWSERUSE_PYTHON
// lets a worktree share an existing one instead of duplicating a large venv;
// without it the arm fails at spawn with ENOENT and records zero usage.
const PYTHON = process.env.WT_BROWSERUSE_PYTHON || path.resolve(import.meta.dirname, "../.venv-browseruse/bin/python");
const RUNNER = path.join(import.meta.dirname, "browseruse_runner.py");
const DEFAULT_MODEL = "claude-sonnet-4-6";
const TIMEOUT_MS = 330_000;

function invoke(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [RUNNER, ...args], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code) return reject(new Error((stderr || stdout || `browser-use exited ${signal ?? code}`).trim().slice(-1000)));
      resolve(stdout);
    });
    child.stdin.end(input);
  });
}

export async function selfCheck() {
  const line = (await invoke(["--selfcheck"])).split("\n").find((item) => item.startsWith("BU_SELFCHECK "));
  if (!line) throw new Error("browser-use self-check returned no result");
  return JSON.parse(line.slice(13));
}

export async function run({ task, capsule, model = DEFAULT_MODEL }) {
  const maxSteps = stepBudget(task, "structured", 20);
  const line = (await invoke([startUrl(task, capsule), String(maxSteps), model, withToday(`${BASE_SYSTEM} ${MECHANICS.structured}`)], withToday(task.prompt)))
    .split("\n").find((item) => item.startsWith("BU_RESULT "));
  if (!line) throw new Error("browser-use returned no result");
  const result = JSON.parse(line.slice(10));
  if (!result.ok) throw new Error(result.error || "browser-use failed");
  const usage = {
    input_tokens: result.input_tokens ?? 0,
    output_tokens: result.output_tokens ?? 0,
  };
  return {
    finalText: result.final_text ?? "",
    usage,
    transcript: [{ framework: "browser-use", steps: result.steps ?? 0 }],
    cost: costFor(model, usage),
    turns: result.steps ?? 0,
    setupMs: (result.setup_s ?? 0) * 1000,
    budget_exhausted: (result.steps ?? 0) === maxSteps,
    model_snapshot: "",
    // browser-use surfaces only the model its adapter was constructed with, not
    // the snapshot the provider served. Declared so the gate can tell "cannot
    // report" apart from "failed to report"; resolution is proven out-of-band
    // by scripts/verify-model.mjs.
    snapshot_source: "unavailable:browser-use@0.12.7",
    temperature: samplingFor(model).temperature,
    effort: "provider-default",
    caching: "unsupported",
  };
}
