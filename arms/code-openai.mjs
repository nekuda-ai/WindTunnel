import vm from "node:vm";
import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { BASE_SYSTEM, samplingFor } from "./prompts.mjs";
import { respond } from "./cu-openai.mjs";

// OpenAI's recommended computer-use path for GPT-6 Astra: the model writes
// JavaScript, the harness runs it with Playwright's page in scope and returns
// stdout plus any display()-ed screenshot. Reported as its own interface class
// (it can both query selectors and screenshot), never under "screenshots".
export const TOOL_VERSION = "exec_js";
const MODEL = "gpt-6-astra";
// Fallback only; task YAML `max_steps.cu` is authoritative (same rule as
// cu-openai). OpenAI's own loop stops at 20; we keep the CU budget so the two
// OpenAI screen arms are measured under the same turn rules.
const MAX_TURNS = 25;
const VIEWPORT = { width: 1280, height: 800 };
const ATTEMPT_MS = Number(process.env.WT_CODE_OPENAI_ATTEMPT_MS ?? 600_000);
if (!Number.isInteger(ATTEMPT_MS) || ATTEMPT_MS <= 0) throw new Error("WT_CODE_OPENAI_ATTEMPT_MS must be a positive integer");
const SCREENSHOT_WINDOW = 3;
const STDOUT_CAP = 8_000;
const execMs = () => Number(process.env.WT_CODE_EXEC_MS ?? 60_000); // per exec_js call; read per call so tests can vary it
const STALE = { type: "input_text", text: "[stale screenshot removed]" };
const SYSTEM = `${BASE_SYSTEM} You operate a web browser by writing JavaScript that runs with Playwright's page, context and browser objects in scope. console.log(value) returns text to you; display(base64Png) returns a screenshot to you. Top-level await is supported. Inspect the screen with display((await page.screenshot()).toString("base64")) before acting and after a short group of actions.`;
const TOOL = {
  type: "function", name: "exec_js", strict: true,
  description: "Run JavaScript in a persistent browser. Available: Playwright's browser, context, and page objects; console.log(value); display(base64Image); top-level await.",
  parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"], additionalProperties: false },
};

// ponytail: node:vm context with only page/context/browser/console/display in
// scope — blocks casual process/fetch/require access from model code. Not a
// boundary against a hostile author (host-object prototype escape); threat model
// is a vendor model on pinned local capsules. Upgrade path: Worker/subprocess.
// Timeout coverage: the vm `timeout` covers the synchronous part of the snippet
// up to its first `await` (so `while (true) {}` is killed); the Promise.race
// timer covers awaited work. A sync loop AFTER an await is the known gap.
// Returns { output, timedOut } — a timed-out snippet may still be running and
// the attempt must end (the caller breaks), never hand the page back to the model.
async function execute(page, code) {
  const logs = [], images = [];
  const log = (...xs) => logs.push(xs.map((x) => typeof x === "string" ? x : JSON.stringify(x)).join(" "));
  const display = (b64) => images.push(String(b64).replace(/^data:image\/png;base64,/, ""));
  const context = page.context();
  const sandbox = { page, context, browser: context.browser(), console: { log, error: log, warn: log, info: log }, display };
  let timer, timedOut = false;
  try {
    // Invoke INSIDE the vm so the sync prelude runs under `timeout`; the script has no access to this module's scope.
    const pending = vm.runInNewContext(`(async () => {\n${code}\n})()`, vm.createContext(sandbox), { timeout: execMs() });
    await Promise.race([
      pending,
      new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error(`exec_js timed out after ${execMs()} ms`)); }, execMs()); }),
    ]);
  } catch (error) {
    if (/Script execution timed out/.test(error.message)) timedOut = true;
    log(`Error: ${error.message}`);
  } finally { clearTimeout(timer); }
  const text = logs.join("\n").slice(0, STDOUT_CAP) || "(no output)";
  return { timedOut, output: [{ type: "input_text", text }, ...images.map((b64) => ({ type: "input_image", image_url: `data:image/png;base64,${b64}`, detail: "original" }))] };
}

const finalTextOf = (output) => output
  .filter(({ type }) => type === "message")
  .flatMap(({ content }) => content ?? [])
  .filter(({ type }) => type === "output_text")
  .map(({ text }) => text)
  .join("\n");

export async function run({ task, capsule, page, model = MODEL }) {
  const started = performance.now();
  await page.setViewportSize(VIEWPORT);
  await page.goto(startUrl(task, capsule), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  const limit = stepBudget(task, "cu", MAX_TURNS);
  let finalText = "";
  let failure = "";
  let model_snapshot = "";
  let turns = 0;
  let retries = 0, retry_wait_ms = 0, temperature = "default";
  let effort = "", truncated = false;
  // Same context policy as the screenshot arms: only the SCREENSHOT_WINDOW most
  // recent tool outputs keep their images; older ones are replaced by a text stub.
  const history = [{ role: "user", content: task.prompt }];
  const windowed = () => {
    const outs = history.filter((item) => item.type === "function_call_output");
    const stale = new Set(outs.slice(0, Math.max(0, outs.length - SCREENSHOT_WINDOW)));
    return history.map((item) => stale.has(item)
      ? { ...item, output: item.output.map((part) => part.type === "input_image" ? STALE : part) }
      : item);
  };
  const setupMs = performance.now() - started;
  const deadline = performance.now() + ATTEMPT_MS;

  while (turns < limit) {
    if (performance.now() >= deadline) {
      failure = `attempt timeout: ${ATTEMPT_MS / 1000}s agent budget`;
      break;
    }
    turns++;
    const sampling = samplingFor(model);
    const outcome = await respond({
      model,
      instructions: withToday(SYSTEM),
      tools: [TOOL],
      input: windowed(),
      parallel_tool_calls: false,
      ...sampling.request,
    });
    const response = outcome.response;
    model_snapshot = response.model ?? model_snapshot;
    temperature = sampling.temperature;
    effort = response.reasoning?.effort ?? effort;
    if (response.status === "incomplete") truncated = true;
    retries += outcome.retries;
    retry_wait_ms += outcome.retry_wait_ms;
    history.push(...response.output);
    const details = response.usage?.input_tokens_details ?? {};
    const cached = details.cached_tokens ?? 0, written = details.cache_write_tokens ?? 0;
    usage.input_tokens += (response.usage?.input_tokens ?? 0) - cached - written;
    usage.cached_input_tokens += cached;
    usage.cache_creation_tokens += written;
    usage.output_tokens += response.usage?.output_tokens ?? 0;
    transcript.push({ turn: turns, role: "assistant", content: response.output, usage: response.usage });
    finalText = finalTextOf(response.output) || finalText;

    const calls = response.output.filter(({ type, name }) => type === "function_call" && name === "exec_js");
    if (!calls.length) break;
    let ended = false;
    for (const call of calls) {
      let code = "";
      try { ({ code = "" } = JSON.parse(call.arguments || "{}")); } catch { /* malformed args: run nothing, report below */ }
      const { output, timedOut } = await execute(page, code);
      transcript.push({ turn: turns, code, output: output[0].text, screenshots: output.length - 1 });
      history.push({ type: "function_call_output", call_id: call.call_id, output });
      if (timedOut) { failure = `exec_js timeout: ${execMs()} ms — snippet may still be running, attempt ended`; ended = true; break; }
    }
    if (ended) break;
  }

  return { finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, model_snapshot, retries, retry_wait_ms, failure, budget_exhausted: turns === limit, temperature, effort, truncated, caching: "provider-managed" };
}
