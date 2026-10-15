import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import Anthropic from "@anthropic-ai/sdk";
import { assertNativeAnthropic, nativeAnthropicOptions } from "../harness/openrouter.mjs";
import { BASE_SYSTEM, MECHANICS, claudeSampling, withCacheBreakpoint, maxTokensFor } from "./prompts.mjs";

export const TOOL_VERSION = "computer_20251124";
const MODEL = "claude-sonnet-4-6";
export const TOOLSET_VERSION = "computer_toolset_20260801";
export const versionFor = (model) => /claude-(?:sonnet|opus|haiku)-5[.-]5/.test(model) ? TOOLSET_VERSION : TOOL_VERSION;
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

export async function executeAction(page, input, cursor = { x: 0, y: 0 }) {
  const action = input.action;
  const [x, y] = input.coordinate ?? [cursor.x, cursor.y];
  if (input.coordinate) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= VIEWPORT.width || y >= VIEWPORT.height) throw new Error("Coordinates out of bounds");
    cursor.x = x; cursor.y = y;
  }
  const modifiers = /click|drag|scroll/.test(action) && input.text ? toPlaywrightKeys(input.text).split("+") : [];
  try {
  for (const key of modifiers) await page.keyboard.down(key);
  switch (action) {
    case "screenshot":
      return { image: (await page.screenshot()).toString("base64") };
    case "zoom": {
      const [x0, y0, x1, y1] = input.region ?? [];
      if (![x0,y0,x1,y1].every(Number.isFinite) || x0 < 0 || y0 < 0 || x1 <= x0 || y1 <= y0 || x1 > VIEWPORT.width || y1 > VIEWPORT.height) throw new Error("Invalid zoom region");
      return { image: (await page.screenshot({ clip: { x: x0, y: y0, width: x1-x0, height: y1-y0 } })).toString("base64") };
    }
    case "left_mouse_down": await page.mouse.down(); break;
    case "left_mouse_up": await page.mouse.up(); break;
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
    case "key": {
      const repeat = input.repeat ?? 1;
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) throw new Error("Invalid key repeat");
      for (let i = 0; i < repeat; i++) await page.keyboard.press(toPlaywrightKeys(input.text ?? ""));
      break;
    }
    case "hold_key": {
      const key = toPlaywrightKeys(input.text ?? "");
      await page.keyboard.down(key);
      try { await page.waitForTimeout(Math.max(0, Math.min(300, input.duration ?? 1)) * 1000); }
      finally { await page.keyboard.up(key); }
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
    case "wait": await page.waitForTimeout(Math.max(0, Math.min(300, input.duration ?? 1)) * 1000); break;
    case "cursor_position": return { text: `X=${cursor.x}, Y=${cursor.y}` };
    default: throw new Error(`Unsupported action: ${action}`);
  }
  await page.waitForTimeout(300);
  return { text: `Executed ${action}` };
  } finally { for (const key of modifiers.reverse()) await page.keyboard.up(key); }
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

export async function run({ task, capsule, page, model = MODEL, toolVersion = versionFor(model), progress = {} }) {
  assertNativeAnthropic();
  const started = performance.now();
  await page.setViewportSize(VIEWPORT);
  await page.goto(startUrl(task, capsule), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(2_000);
  const client = new Anthropic(nativeAnthropicOptions());
  const toolset = toolVersion === TOOLSET_VERSION;
  if (!toolset && toolVersion !== TOOL_VERSION) throw new Error(`Unsupported Claude computer tool version: ${toolVersion}`);
  if (versionFor(model) === TOOLSET_VERSION && !toolset) throw new Error("Claude 5.5 requires computer_toolset_20260801");
  const cursor = { x: 0, y: 0 };
  let cost = 0;
  const sampling = claudeSampling(model);
  const messages = [{ role: "user", content: task.prompt }];
  const tools = toolset ? [{ type: TOOLSET_VERSION }] : [{ type: TOOL_VERSION, name: "computer", display_width_px: VIEWPORT.width, display_height_px: VIEWPORT.height }];
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  // The task YAML's per-interface budget is authoritative; MAX_TURNS is only
  // the fallback when the task doesn't set one. Same rule in every arm.
  const limit = stepBudget(task, "cu", MAX_TURNS);
  let finalText = "";
  let model_snapshot = "";
  let lastStopReason = "";
  let turns = 0, failure = "";
  const setupMs = performance.now() - started;
  const deadline = performance.now() + ATTEMPT_MS;

  while (turns < limit) {
    if (performance.now() >= deadline) { failure = "attempt timeout: 600s agent budget"; break; }
    turns++;
    pruneImages(messages);
    let response;
    try { response = await (toolset ? client.messages : client.beta.messages).create({
      model,
      max_tokens: maxTokensFor(model),
      ...sampling.request,
      system: [{ type: "text", text: withToday(SYSTEM), cache_control: { type: "ephemeral" } }],
      tools,
      messages: withCacheBreakpoint(messages),
      ...(!toolset ? { betas: [BETA] } : {}),
    }); } catch (error) { failure = error.message; break; }
    model_snapshot = response.model ?? model_snapshot;
    lastStopReason = response.stop_reason ?? lastStopReason;
    cost += costFor(model, { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens, cached_input_tokens: response.usage.cache_read_input_tokens, cache_creation_tokens: response.usage.cache_creation_input_tokens });
    usage.input_tokens += response.usage.input_tokens ?? 0;
    usage.output_tokens += response.usage.output_tokens ?? 0;
    usage.cached_input_tokens += response.usage.cache_read_input_tokens ?? 0;
    usage.cache_creation_tokens += response.usage.cache_creation_input_tokens ?? 0;
    Object.assign(progress, { usage, cost, model_snapshot, transcript });
    messages.push({ role: "assistant", content: response.content });
    transcript.push({ turn: turns, role: "assistant", content: response.content, usage: response.usage, stop_reason: response.stop_reason });
    finalText = response.content.filter(({ type }) => type === "text").map(({ text }) => text).join("\n") || finalText;

    const calls = response.content.filter(({ type }) => type === "tool_use");
    if (response.stop_reason !== "tool_use" || !calls.length) break;
    const results = [];
    for (const call of calls) {
      let output;
      try {
        if (toolset && call.toolset_name !== "computer") throw new Error(`Unexpected toolset: ${call.toolset_name}`);
        output = await executeAction(page, toolset ? { ...call.input, action: call.name } : call.input, cursor);
      }
      catch (error) { output = { text: `Action error: ${error.message}` }; }
      transcript.push({ turn: turns, action: call.input, ok: !output.text?.startsWith("Action error") });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        ...(toolset && call.toolset_name ? { toolset_name: call.toolset_name } : {}),
        is_error: Boolean(output.text?.startsWith("Action error")),
        content: output.image
          ? [{ type: "image", source: { type: "base64", media_type: "image/png", data: output.image } }]
          : [{ type: "text", text: output.text }],
      });
    }
    messages.push({ role: "user", content: results });
  }

  return { finalText, usage, transcript, cost, failure, tool_version: toolVersion, turns, setupMs, model_snapshot,
    budget_exhausted: turns === limit, temperature: sampling.temperature, caching: "enabled",
    stop_reason: lastStopReason, refusal: lastStopReason === "refusal", truncated: lastStopReason === "max_tokens",
    // No explicit effort is sent, so the model runs at the API default
    // (high on Sonnet 5 / Opus 5). Recorded so the artifact states it.
    effort: "api-default" };
}
