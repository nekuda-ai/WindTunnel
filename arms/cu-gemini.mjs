import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { BASE_SYSTEM, MECHANICS } from "./prompts.mjs";

export const TOOL_VERSION = "computer_use@interactions-v1beta";
const MODEL = "gemini-3.6-flash";
const MAX_TURNS = 25;
const VIEWPORT = { width: 1280, height: 800 };
const ATTEMPT_MS = 600_000;
const SCREENSHOT_WINDOW = 3;
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const BLANK_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.cu}`;
const KEY_MAP = {
  ENTER: "Enter", RETURN: "Enter", TAB: "Tab", ESC: "Escape", ESCAPE: "Escape",
  BACKSPACE: "Backspace", DELETE: "Delete", DEL: "Delete", SPACE: "Space", CTRL: "Control",
  CONTROL: "Control", ALT: "Alt", SHIFT: "Shift", META: "Meta", CMD: "Meta", SUPER: "Meta",
  OPTION: "Alt", COMMAND: "Meta", UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft",
  RIGHT: "ArrowRight", ARROWUP: "ArrowUp", ARROWDOWN: "ArrowDown", ARROWLEFT: "ArrowLeft",
  ARROWRIGHT: "ArrowRight", PAGEUP: "PageUp", PAGEDOWN: "PageDown", HOME: "Home", END: "End",
};

const keyName = (key) => KEY_MAP[String(key).toUpperCase()] ?? String(key);
const shortcut = (keys) => (Array.isArray(keys) ? keys : String(keys).split("+"))
  .map(keyName).join("+");

export function denormalize(value, size) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`invalid coordinate: ${value}`);
  return Math.floor(Math.max(0, Math.min(999, number)) / 1000 * size);
}

export function geminiUsage(raw = {}) {
  const cached = raw.total_cached_tokens ?? 0;
  return {
    input_tokens: Math.max(0, (raw.total_input_tokens ?? 0) + (raw.total_tool_use_tokens ?? 0) - cached),
    output_tokens: (raw.total_output_tokens ?? 0) + (raw.total_thought_tokens ?? 0),
    cached_input_tokens: cached,
    cache_creation_tokens: 0,
  };
}

function addUsage(total, raw) {
  const next = geminiUsage(raw);
  for (const key of Object.keys(total)) total[key] += next[key] ?? 0;
}

// ponytail: two Gemini arms need one REST endpoint, not a new SDK dependency.
export async function respond(body) {
  if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set");
  let retryWaitMs = 0;
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (attempt >= 6) throw error;
      const waitMs = Math.min(60_000, 2_000 * 2 ** attempt);
      retryWaitMs += waitMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    if (response.ok) return { response: await response.json(), retries: attempt, retry_wait_ms: retryWaitMs };
    const text = (await response.text()).slice(0, 500);
    if ((response.status === 429 || response.status >= 500) && attempt < 6) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(60_000, 2_000 * 2 ** attempt);
      retryWaitMs += waitMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    throw new Error(`Gemini ${response.status}: ${text}`);
  }
}

export function windowedHistory(history) {
  const copy = structuredClone(history);
  let seen = 0;
  for (let i = copy.length - 1; i >= 0; i--) {
    for (const field of ["content", "result"]) {
      const blocks = Array.isArray(copy[i][field]) ? copy[i][field] : [];
      for (let j = blocks.length - 1; j >= 0; j--) {
        if (blocks[j].type === "image" && ++seen > SCREENSHOT_WINDOW)
          blocks[j] = { type: "text", text: "[older screenshot removed]" };
      }
    }
  }
  return copy;
}

const point = (args, x = "x", y = "y") => ({
  x: denormalize(args[x], VIEWPORT.width),
  y: denormalize(args[y], VIEWPORT.height),
});

export async function executeAction(page, name, args = {}) {
  const at = (x = "x", y = "y") => point(args, x, y);
  switch (name) {
    case "click": await page.mouse.click(at().x, at().y); break;
    case "double_click": await page.mouse.dblclick(at().x, at().y); break;
    case "triple_click": await page.mouse.click(at().x, at().y, { clickCount: 3 }); break;
    case "middle_click": await page.mouse.click(at().x, at().y, { button: "middle" }); break;
    case "right_click": await page.mouse.click(at().x, at().y, { button: "right" }); break;
    case "mouse_down": await page.mouse.move(at().x, at().y); await page.mouse.down(); break;
    case "mouse_up": await page.mouse.move(at().x, at().y); await page.mouse.up(); break;
    case "move": await page.mouse.move(at().x, at().y); break;
    case "type":
      await page.keyboard.press("Meta+A");
      await page.keyboard.press("Backspace");
      await page.keyboard.type(String(args.text ?? ""), { delay: 10 });
      if (args.press_enter) await page.keyboard.press("Enter");
      break;
    case "drag_and_drop": {
      const start = at("start_x", "start_y"), end = at("end_x", "end_y");
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 10 });
      await page.mouse.up();
      break;
    }
    case "wait": await page.waitForTimeout(Math.max(0, Math.min(30, Number(args.seconds) || 1)) * 1000); break;
    case "press_key": await page.keyboard.press(shortcut(args.key)); break;
    case "key_down": await page.keyboard.down(keyName(args.key)); break;
    case "key_up": await page.keyboard.up(keyName(args.key)); break;
    case "hotkey": await page.keyboard.press(shortcut(args.keys ?? [])); break;
    case "take_screenshot": break;
    case "scroll": {
      const { x, y } = at();
      const amount = Math.max(0, Math.min(999, Number(args.magnitude_in_pixels) || 300));
      await page.mouse.move(x, y);
      await page.mouse.wheel(
        args.direction === "left" ? -amount : args.direction === "right" ? amount : 0,
        args.direction === "up" ? -amount : args.direction === "down" ? amount : 0,
      );
      break;
    }
    case "go_back": await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }); break;
    case "go_forward": await page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 }); break;
    case "navigate": await page.goto(String(args.url), { waitUntil: "domcontentloaded", timeout: 30_000 }); break;
    default: throw new Error(`Unsupported Gemini computer action: ${name}`);
  }
  await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

const finalTextOf = (steps = []) => steps
  .filter(({ type }) => type === "model_output")
  .flatMap(({ content }) => content ?? [])
  .filter(({ type }) => type === "text")
  .map(({ text }) => text)
  .join("\n");

export async function selfCheck(model = MODEL) {
  const { response } = await respond({
    model,
    input: [
      { type: "text", text: "Inspect the current browser screenshot and take a screenshot." },
      { type: "image", data: BLANK_PNG, mime_type: "image/png" },
    ],
    tools: [{ type: "computer_use", environment: "browser" }],
  });
  if (!response.steps?.length) throw new Error("Gemini Computer Use returned no steps");
  return { ok: true, model: response.model ?? model, version: TOOL_VERSION };
}

export async function run({ task, capsule, page, model = MODEL }) {
  const started = performance.now();
  await page.setViewportSize(VIEWPORT);
  await page.goto(startUrl(task, capsule), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  const history = [{
    type: "user_input",
    content: [
      { type: "text", text: task.prompt },
      { type: "image", data: (await page.screenshot()).toString("base64"), mime_type: "image/png" },
    ],
  }];
  const tools = [{ type: "computer_use", environment: "browser" }];
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  const limit = stepBudget(task, "cu", MAX_TURNS);
  const setupMs = performance.now() - started;
  const deadline = performance.now() + ATTEMPT_MS;
  let finalText = "", model_snapshot = "", turns = 0, retries = 0, retry_wait_ms = 0;

  while (turns < limit) {
    if (performance.now() >= deadline) throw new Error("attempt timeout: 600s agent budget");
    turns++;
    const outcome = await respond({
      model,
      store: false,
      system_instruction: withToday(SYSTEM),
      generation_config: { max_output_tokens: 4096 },
      input: windowedHistory(history),
      tools,
    });
    const interaction = outcome.response;
    model_snapshot = interaction.model ?? model_snapshot;
    retries += outcome.retries;
    retry_wait_ms += outcome.retry_wait_ms;
    addUsage(usage, interaction.usage);
    history.push(...(interaction.steps ?? []));
    transcript.push({ turn: turns, role: "assistant", content: interaction.steps, usage: interaction.usage });
    finalText = finalTextOf(interaction.steps) || finalText;

    const calls = (interaction.steps ?? []).filter(({ type }) => type === "function_call");
    if (!calls.length) break;
    const results = [];
    for (const call of calls) {
      const decision = call.arguments?.safety_decision?.decision;
      let result = {};
      try {
        if (decision === "blocked") throw new Error(call.arguments.safety_decision.explanation || "action blocked by Gemini safety policy");
        await executeAction(page, call.name, call.arguments);
        if (decision === "require_confirmation") result.safety_acknowledgement = true;
      } catch (error) {
        result.error = error.message;
      }
      transcript.push({ turn: turns, action: call.name, input: call.arguments, result });
      results.push({ name: call.name, call_id: call.id, result });
    }
    const screenshot = (await page.screenshot()).toString("base64");
    history.push(...results.map(({ name, call_id, result }) => ({
      type: "function_result",
      name,
      call_id,
      result: [
        { type: "text", text: JSON.stringify({ url: page.url(), ...result }) },
        { type: "image", data: screenshot, mime_type: "image/png" },
      ],
    })));
  }

  return {
    finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, model_snapshot,
    retries, retry_wait_ms, budget_exhausted: turns === limit, temperature: "default", caching: "provider-managed",
  };
}
