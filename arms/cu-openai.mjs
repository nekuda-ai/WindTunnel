import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { BASE_SYSTEM, MECHANICS } from "./prompts.mjs";

export const TOOL_VERSION = "computer";
const MODEL = "gpt-5.5";
const MAX_TURNS = 25;
const VIEWPORT = { width: 1280, height: 800 };
const ATTEMPT_MS = 300_000;
const SCREENSHOT_WINDOW = 3;
const BLANK_SHOT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.cu}`;
const KEY_MAP = {
  ENTER: "Enter", RETURN: "Enter", TAB: "Tab", ESC: "Escape", ESCAPE: "Escape",
  BACKSPACE: "Backspace", DELETE: "Delete", DEL: "Delete", SPACE: "Space", CTRL: "Control",
  CONTROL: "Control", ALT: "Alt", SHIFT: "Shift", META: "Meta", CMD: "Meta", SUPER: "Meta",
  OPTION: "Alt", COMMAND: "Meta",
  UP: "ArrowUp", DOWN: "ArrowDown", LEFT: "ArrowLeft", RIGHT: "ArrowRight",
  ARROWUP: "ArrowUp", ARROWDOWN: "ArrowDown", ARROWLEFT: "ArrowLeft", ARROWRIGHT: "ArrowRight",
  PAGEUP: "PageUp", PAGEDOWN: "PageDown", HOME: "Home", END: "End",
};
const BUTTON_MAP = { left: "left", right: "right", wheel: "middle" };

const toPlaywrightKey = (key) => KEY_MAP[String(key).toUpperCase()]
  ?? (key.length === 1 ? key : key[0].toUpperCase() + key.slice(1).toLowerCase());

async function withModifiers(page, keys, callback) {
  const pressed = (keys ?? []).map(toPlaywrightKey);
  try {
    for (const key of pressed) await page.keyboard.down(key);
    await callback();
  } finally {
    for (const key of pressed.reverse()) await page.keyboard.up(key);
  }
}

// ponytail: raw fetch to the Responses API — the loop needs one endpoint, not the openai SDK.
async function respond(body) {
  let retryWaitMs = 0;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (res.ok) return { response: await res.json(), retries: attempt, retry_wait_ms: retryWaitMs };
    const text = (await res.text()).slice(0, 300);
    // Rate limits (429) and transient 5xx are retried with exponential backoff
    // (honoring Retry-After); anything else fails fast. 56% of cu-openai runs
    // were lost to un-retried 429s in the first full flight.
    if (!/insufficient_quota/i.test(text) && (res.status === 429 || res.status >= 500) && attempt < 6) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : Math.min(60_000, 2_000 * 2 ** attempt);
      retryWaitMs += waitMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    throw new Error(`OpenAI ${res.status}: ${text}`);
  }
}

async function respondAtZero(body) {
  try { return { ...(await respond({ ...body, temperature: 0 })), temperature: "0" }; }
  catch (error) {
    if (!/^OpenAI 400:/.test(error.message)) throw error;
    return { ...(await respond(body)), temperature: "default" };
  }
}

async function executeAction(page, action) {
  const { x, y } = action;
  switch (action.type) {
    case "screenshot": break;
    case "click": {
      const button = BUTTON_MAP[action.button ?? "left"];
      if (!button) throw new Error(`Unsupported mouse button: ${action.button}`);
      await withModifiers(page, action.keys, () => page.mouse.click(x, y, { button }));
      break;
    }
    case "double_click": await withModifiers(page, action.keys, () => page.mouse.dblclick(x, y)); break;
    case "move": await withModifiers(page, action.keys, () => page.mouse.move(x, y)); break;
    case "scroll":
      await withModifiers(page, action.keys, async () => {
        await page.mouse.move(x, y);
        await page.mouse.wheel(action.scroll_x, action.scroll_y);
      });
      break;
    case "type": await page.keyboard.type(action.text ?? "", { delay: 10 }); break;
    case "keypress":
      for (const key of action.keys ?? []) await page.keyboard.press(toPlaywrightKey(key));
      break;
    case "drag": {
      const path = action.path ?? [];
      if (path.length) {
        await withModifiers(page, action.keys, async () => {
          await page.mouse.move(path[0].x, path[0].y);
          await page.mouse.down();
          for (const point of path.slice(1)) await page.mouse.move(point.x, point.y, { steps: 5 });
          await page.mouse.up();
        });
      }
      break;
    }
    case "wait": await page.waitForTimeout(1000); break;
    default: throw new Error(`Unsupported action: ${action.type}`);
  }
  await page.waitForTimeout(300);
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

  const tools = [{ type: "computer" }];
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  // The task YAML's per-interface budget is authoritative; MAX_TURNS is only
  // the fallback when the task doesn't set one. Same rule in every arm.
  const limit = stepBudget(task, "cu", MAX_TURNS);
  let finalText = "";
  let turns = 0;
  let retries = 0, retry_wait_ms = 0, temperature = "0";
  // Both screenshot arms share one context policy: the model sees only the
  // SCREENSHOT_WINDOW most recent screenshots (matches cu-claude's prune).
  // History is replayed explicitly (the OpenAI Responses docs' supported
  // alternative to previous_response_id) with stale screenshots blanked to a
  // 1x1 image — the computer_call_output contract requires a screenshot, so a
  // text placeholder is not an option here.
  const history = [{ role: "user", content: task.prompt }];
  const windowed = () => {
    const shots = history.filter((item) => item.type === "computer_call_output");
    const stale = new Set(shots.slice(0, Math.max(0, shots.length - SCREENSHOT_WINDOW)));
    return history.map((item) => stale.has(item) ? { ...item, output: { ...item.output, image_url: BLANK_SHOT } } : item);
  };
  const setupMs = performance.now() - started;
  const deadline = performance.now() + ATTEMPT_MS;

  while (turns < limit) {
    if (performance.now() >= deadline) throw new Error("attempt timeout: 300s agent budget");
    turns++;
    const outcome = await respondAtZero({
      model,
      instructions: withToday(SYSTEM),
      tools,
      input: windowed(),
    });
    const response = outcome.response;
    temperature = outcome.temperature;
    retries += outcome.retries;
    retry_wait_ms += outcome.retry_wait_ms;
    history.push(...response.output);
    usage.input_tokens += (response.usage?.input_tokens ?? 0) - (response.usage?.input_tokens_details?.cached_tokens ?? 0);
    usage.output_tokens += response.usage?.output_tokens ?? 0;
    usage.cached_input_tokens += response.usage?.input_tokens_details?.cached_tokens ?? 0;
    transcript.push({ turn: turns, role: "assistant", content: response.output, usage: response.usage });
    finalText = finalTextOf(response.output) || finalText;

    const calls = response.output.filter(({ type }) => type === "computer_call");
    if (!calls.length) break;
    for (const call of calls) {
      for (const action of call.actions ?? []) {
        try { await executeAction(page, action); }
        catch (error) { transcript.push({ turn: turns, action, error: error.message }); }
        transcript.push({ turn: turns, action });
      }
      history.push({
        type: "computer_call_output",
        call_id: call.call_id,
        // Sites are pinned local containers; safety checks are auto-acknowledged.
        ...(call.pending_safety_checks?.length ? { acknowledged_safety_checks: call.pending_safety_checks } : {}),
        output: {
          type: "computer_screenshot",
          image_url: `data:image/png;base64,${(await page.screenshot()).toString("base64")}`,
          detail: "original",
        },
      });
    }
  }

  return { finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, retries, retry_wait_ms, budget_exhausted: turns === limit, temperature, caching: "provider-managed" };
}
