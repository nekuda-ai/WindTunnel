import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import Anthropic from "@anthropic-ai/sdk";
import { BASE_SYSTEM, MECHANICS, claudeSampling, withCacheBreakpoint, maxTokensFor } from "./prompts.mjs";

const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 12;
const ATTEMPT_MS = 600_000;
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.webmcp}`;
const bridgedContexts = new WeakSet();

// No arm-side login. Auth-gated tasks name their credentials in the prompt, so
// signing in is part of the task and every interface must do it the same way:
// the screenshot/DOM/a11y arms drive the login form, and a WebMCP arm calls the
// site's own sign-in tool. Establishing the session here instead would hand the
// WebMCP arms the first step of those tasks for free — a site that exposes no
// auth tool should register as exactly that, not be papered over.
export function installModelContextBridge() {
  const registrations = new Map();
  let nextId = 0;
  const bridge = {
    registerTool(definition, options = {}) {
      const signal = options.signal;
      if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      const id = ++nextId;
      registrations.set(definition.name, { id, definition });
      return new Promise((_, reject) => signal?.addEventListener("abort", () => {
        if (registrations.get(definition.name)?.id === id) registrations.delete(definition.name);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true }));
    },
    list: () => [...registrations.values()].map(({ definition }) => ({
      name: definition.name,
      description: definition.description ?? "",
      inputSchema: definition.inputSchema ?? { type: "object", properties: {} },
    })),
    execute: async (name, args) => {
      const tool = registrations.get(name)?.definition;
      if (!tool) throw new Error(`tool "${name}" is not available`);
      return tool.execute(args ?? {});
    },
  };
  Object.defineProperty(globalThis, "__wtModelContextBridge", { configurable: true, value: bridge });
  for (const target of [document, navigator]) {
    try { Object.defineProperty(target, "modelContext", { configurable: true, value: bridge }); }
    catch { target.modelContext = bridge; }
  }
}

export const listLiveTools = (page) => page.evaluate(() => globalThis.__wtModelContextBridge?.list() ?? []);

// Shared by every WebMCP arm: install the bridge once per context, open the
// site, and wait until the capsule's tools have registered.
export async function prepareWebMCPPage(page, baseUrl) {
  const context = page.context();
  if (!bridgedContexts.has(context)) {
    await context.addInitScript(installModelContextBridge);
    bridgedContexts.add(context);
  }
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
  // Tools register only after the site's JS hydrates and calls registerTool.
  // Heavy SSR apps (hi-events) hydrate well past 5s, so wait generously — this
  // returns the instant tools appear, so fast sites aren't slowed.
  await page.waitForFunction(() => globalThis.__wtModelContextBridge?.list().length, null, { timeout: 30_000 });
}

export const executeBridgeTool = (page, name, args) => page.evaluate(
  ({ name, args }) => globalThis.__wtModelContextBridge.execute(name, args),
  { name, args },
);

function anthropicTools(tools) {
  return tools.map((tool) => {
    let schema = tool.inputSchema ?? { type: "object", properties: {} };
    if (schema.oneOf || schema.allOf || schema.anyOf) schema = { type: "object", properties: {} };
    return { name: tool.name, description: tool.description ?? "", input_schema: schema };
  });
}

export async function run({ task, capsule, page, model = MODEL }) {
  const started = performance.now();
  await prepareWebMCPPage(page, startUrl(task, capsule));

  const client = new Anthropic({ maxRetries: 6 });
  const sampling = claudeSampling(model);
  const messages = [{ role: "user", content: task.prompt }];
  const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  const transcript = [];
  // The task YAML's per-interface budget is authoritative; MAX_TURNS is only
  // the fallback when the task doesn't set one. Same rule in every arm.
  const limit = stepBudget(task, "webmcp", MAX_TURNS);
  let finalText = "";
  let model_snapshot = "";
  let lastStopReason = "";
  let turns = 0;
  let previousTools = "";
  const setupMs = performance.now() - started;
  const deadline = performance.now() + ATTEMPT_MS;

  while (turns < limit) {
    if (performance.now() >= deadline) throw new Error("attempt timeout: 600s agent budget");
    const tools = await listLiveTools(page);
    if (!tools.length) throw new Error("no live WebMCP tools registered");
    const toolNames = tools.map(({ name }) => name).join(",");
    if (toolNames !== previousTools) {
      transcript.push({ harness: "discovery", tools: tools.map(({ name }) => name) });
      previousTools = toolNames;
    }

    turns++;
    const response = await client.messages.create({
      model,
      max_tokens: maxTokensFor(model),
      ...sampling.request,
      system: [{ type: "text", text: withToday(SYSTEM), cache_control: { type: "ephemeral" } }],
      tools: anthropicTools(tools),
      tool_choice: { type: "auto", disable_parallel_tool_use: true },
      messages: withCacheBreakpoint(messages),
    });
    model_snapshot = response.model ?? model_snapshot;
    lastStopReason = response.stop_reason ?? lastStopReason;
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
      let result;
      try {
        result = await executeBridgeTool(page, call.name, call.input);
      } catch (error) {
        result = { error: error.message };
      }
      transcript.push({ turn: turns, tool: call.name, input: call.input, result });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify(result).slice(0, 20_000),
        is_error: Boolean(result?.error),
      });
    }
    messages.push({ role: "user", content: results });
    await page.waitForTimeout(300);
  }

  return { finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, model_snapshot,
    budget_exhausted: turns === limit, temperature: sampling.temperature, caching: "enabled",
    stop_reason: lastStopReason, refusal: lastStopReason === "refusal", truncated: lastStopReason === "max_tokens",
    // No explicit effort is sent, so the model runs at the API default
    // (high on Sonnet 5 / Opus 5). Recorded so the artifact states it.
    effort: "api-default" };
}
