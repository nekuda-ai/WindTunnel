import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import Anthropic from "@anthropic-ai/sdk";
import { BASE_SYSTEM, MECHANICS, claudeSampling, withCacheBreakpoint } from "./prompts.mjs";

export const TOOL_VERSION = "computer_20251124";
const MODEL = "claude-sonnet-4-6";
const BETA = "computer-use-2025-11-24";
const MAX_TURNS = 25;
const VIEWPORT = { width: 1280, height: 800 };
const ATTEMPT_MS = 600_000;
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.cu}`;
const KEY_MAP = {
  Return: "Enter", KP_Enter: "Enter", BackSpace: "Backspace", Delete: "Delete",
  Tab: "Tab", Escape: "Escape", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft",
  Right: "ArrowRight", Home: "Home", End: "End", Page_Up: "PageUp", Page_Down: "PageDown",
  space: " ", ctrl: "Control", alt: "Alt", shift: "Shift", super: "Meta", cmd: "Meta",
};

const toPlaywrightKeys = (text) => text.split("+")
  .map((key) => KEY_MAP[key] ?? (key.length === 1 ? key : key[0].toUpperCase() + key.slice(1)))
  .join("+");

async function executeAction(page, input) {
  const action = input.action;
  const [x, y] = input.coordinate ?? [];
  switch (action) {
    case "screenshot":
      return { image: (await page.screenshot()).toString("base64") };
    case "left_click": await page.mouse.click(x, y); break;
    case "right_click": await page.mouse.click(x, y, { button: "right" }); break;
    case "middle_click": await page.mouse.click(x, y, { button: "middle" }); break;
    case "double_click": await page.mouse.dblclick(x, y); break;
    case "triple_click": await page.mouse.click(x, y, { clickCount: 3 }); break;
    case "mouse_move": await page.mouse.move(x, y); break;
    case "left_click_drag": {
      const [startX, startY] = input.start_coordinate ?? [x, y];
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(x, y, { steps: 10 });
      await page.mouse.up();
      break;
    }
    case "type": await page.keyboard.type(input.text ?? "", { delay: 10 }); break;
    case "key": await page.keyboard.press(toPlaywrightKeys(input.text ?? "")); break;
    case "hold_key": {
      const key = toPlaywrightKeys(input.text ?? "");
      await page.keyboard.down(key);
      await page.waitForTimeout((input.duration ?? 1) * 1000);
      await page.keyboard.up(key);
      break;
    }
    case "scroll": {
      const amount = (input.scroll_amount ?? 3) * 100;
      const direction = input.scroll_direction ?? "down";
      if (x != null) await page.mouse.move(x, y);
      await page.mouse.wheel(
        direction === "left" ? -amount : direction === "right" ? amount : 0,
        direction === "up" ? -amount : direction === "down" ? amount : 0,
      );
      break;
    }
    case "wait": await page.waitForTimeout((input.duration ?? 1) * 1000); break;
    case "cursor_position": return { text: "cursor position unavailable" };
    default: return { text: `Unsupported action: ${action}` };
  }
  await page.waitForTimeout(300);
  return { text: `Executed ${action}` };
}

function pruneImages(messages) {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const block of Array.isArray(messages[i].content) ? messages[i].content : []) {
      if (block.type !== "tool_result" || !Array.isArray(block.content)) continue;
      for (let j = 0; j < block.content.length; j++) {
        if (block.content[j].type === "image" && ++seen > 3)
          block.content[j] = { type: "text", text: "[older screenshot removed]" };
      }
    }
  }
}

export async function run({ task, capsule, page, model = MODEL }) {
  const started = performance.now();
  await page.setViewportSize(VIEWPORT);
  await page.goto(startUrl(task, capsule), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
  const client = new Anthropic({ maxRetries: 2 });
  const sampling = claudeSampling(model);
  const messages = [{ role: "user", content: task.prompt }];
  const tools = [{ type: TOOL_VERSION, name: "computer", display_width_px: VIEWPORT.width, display_height_px: VIEWPORT.height }];
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  // The task YAML's per-interface budget is authoritative; MAX_TURNS is only
  // the fallback when the task doesn't set one. Same rule in every arm.
  const limit = stepBudget(task, "cu", MAX_TURNS);
  let finalText = "";
  let model_snapshot = "";
  let turns = 0;
  const setupMs = performance.now() - started;
  const deadline = performance.now() + ATTEMPT_MS;

  while (turns < limit) {
    if (performance.now() >= deadline) throw new Error("attempt timeout: 600s agent budget");
    turns++;
    pruneImages(messages);
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4096,
      ...sampling.request,
      system: [{ type: "text", text: withToday(SYSTEM), cache_control: { type: "ephemeral" } }],
      tools,
      messages: withCacheBreakpoint(messages),
      betas: [BETA],
    });
    model_snapshot = response.model ?? model_snapshot;
    usage.input_tokens += response.usage.input_tokens ?? 0;
    usage.output_tokens += response.usage.output_tokens ?? 0;
    usage.cached_input_tokens += response.usage.cache_read_input_tokens ?? 0;
    usage.cache_creation_tokens += response.usage.cache_creation_input_tokens ?? 0;
    messages.push({ role: "assistant", content: response.content });
    transcript.push({ turn: turns, role: "assistant", content: response.content, usage: response.usage, stop_reason: response.stop_reason });
    finalText = response.content.filter(({ type }) => type === "text").map(({ text }) => text).join("\n") || finalText;

    const calls = response.content.filter(({ type }) => type === "tool_use");
    if (response.stop_reason !== "tool_use" || !calls.length) break;
    const results = [];
    for (const call of calls) {
      let output;
      try { output = await executeAction(page, call.input); }
      catch (error) { output = { text: `Action error: ${error.message}` }; }
      transcript.push({ turn: turns, action: call.input, ok: !output.text?.startsWith("Action error") });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: output.image
          ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: output.image } }]
          : [{ type: "text", text: output.text }],
      });
    }
    messages.push({ role: "user", content: results });
  }

  return { finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, model_snapshot, budget_exhausted: turns === limit, temperature: sampling.temperature, caching: "enabled" };
}
