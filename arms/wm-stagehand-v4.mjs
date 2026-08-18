import Anthropic from "@anthropic-ai/sdk";
import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { BASE_SYSTEM, MECHANICS, withCacheBreakpoint } from "./prompts.mjs";

export const TOOL_VERSION = "stagehand@4.0.0+native-webmcp";
const MODEL = "claude-sonnet-4-6";
const MAX_TURNS = 12;
const ATTEMPT_MS = 600_000;
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.webmcp}`;

export async function openStagehand() {
  const { Stagehand, localBrowser } = await import("@browserbasehq/stagehand-v4");
  const browser = await localBrowser.launch({
    headless: true,
    ...(process.env.WT_CHROME ? { executablePath: process.env.WT_CHROME } : {}),
    viewport: { width: 1280, height: 800 },
  });
  try {
    const stagehand = await Stagehand.create({ browser, logging: { level: "off" } });
    return { browser, stagehand };
  } catch (error) {
    await browser.close().catch(() => {});
    throw error;
  }
}

export async function waitForTools(page, timeout = 30_000) {
  const deadline = performance.now() + timeout;
  do {
    const tools = await page.tools({ timeout: Math.min(1000, Math.max(0, deadline - performance.now())) });
    if (tools.length) return tools;
    await page.waitForTimeout(250);
  } while (performance.now() < deadline);
  return [];
}

export function anthropicTools(tools) {
  return tools.map((tool) => {
    let schema = tool.inputSchema ?? { type: "object", properties: {} };
    if (schema.oneOf || schema.allOf || schema.anyOf) schema = { type: "object", properties: {} };
    return { name: tool.name, description: tool.description ?? "", input_schema: schema };
  });
}

export async function invokeTool(tool, input) {
  const response = await (await tool.invoke({ input: input ?? {} })).result({ timeout: 30_000 });
  if (response.status === "Completed") return response.output;
  return { error: response.errorText || `WebMCP invocation ${response.status.toLowerCase()}` };
}

export async function selfCheck() {
  const { browser, stagehand } = await openStagehand();
  try {
    await browser.context.activePage();
    return { ok: true, version: TOOL_VERSION.slice(10) };
  } finally {
    await stagehand.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export async function run({ task, capsule, model = MODEL }) {
  const started = performance.now();
  const { browser, stagehand } = await openStagehand();
  try {
    const page = await browser.context.activePage();
    await page.goto(startUrl(task, capsule), { waitUntil: "domcontentloaded", timeout: 30_000 });

    const client = new Anthropic({ maxRetries: 2 });
    const messages = [{ role: "user", content: task.prompt }];
    const usage = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
    const transcript = [];
    const limit = stepBudget(task, "webmcp", MAX_TURNS);
    let finalText = "";
    let model_snapshot = "";
    let turns = 0;
    let previousTools = "";
    const setupMs = performance.now() - started;
    const deadline = performance.now() + ATTEMPT_MS;

    while (turns < limit) {
      if (performance.now() >= deadline) throw new Error("attempt timeout: 600s agent budget");
      const liveTools = await waitForTools(page);
      if (!liveTools.length) throw new Error("no live WebMCP tools registered");
      const toolNames = liveTools.map(({ name }) => name).join(",");
      if (toolNames !== previousTools) {
        transcript.push({ t: Math.round(performance.now() - started), harness: "discovery", tools: liveTools.map(({ name }) => name) });
        previousTools = toolNames;
      }

      turns++;
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        temperature: 0,
        system: [{ type: "text", text: withToday(SYSTEM), cache_control: { type: "ephemeral" } }],
        tools: anthropicTools(liveTools),
        tool_choice: { type: "auto", disable_parallel_tool_use: true },
        messages: withCacheBreakpoint(messages),
      });
      model_snapshot = response.model ?? model_snapshot;
      usage.input_tokens += response.usage.input_tokens ?? 0;
      usage.output_tokens += response.usage.output_tokens ?? 0;
      usage.cached_input_tokens += response.usage.cache_read_input_tokens ?? 0;
      usage.cache_creation_tokens += response.usage.cache_creation_input_tokens ?? 0;
      messages.push({ role: "assistant", content: response.content });
      transcript.push({ t: Math.round(performance.now() - started), turn: turns, role: "assistant", content: response.content, usage: response.usage });
      finalText = response.content.filter(({ type }) => type === "text").map(({ text }) => text).join("\n") || finalText;

      const calls = response.content.filter(({ type }) => type === "tool_use");
      if (response.stop_reason !== "tool_use" || !calls.length) break;
      const results = [];
      for (const call of calls) {
        const tool = liveTools.find(({ name }) => name === call.name);
        let result;
        try {
          if (!tool) throw new Error(`tool "${call.name}" is not available`);
          result = await invokeTool(tool, call.input);
        } catch (error) {
          result = { error: error.message };
        }
        transcript.push({ t: Math.round(performance.now() - started), turn: turns, tool: call.name, input: call.input, result });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: JSON.stringify(result ?? null).slice(0, 20_000),
          is_error: Boolean(result?.error),
        });
      }
      messages.push({ role: "user", content: results });
      await page.waitForTimeout(300);
    }

    return { finalText, usage, transcript, cost: costFor(model, usage), turns, setupMs, model_snapshot, budget_exhausted: turns === limit, temperature: "0", caching: "enabled" };
  } finally {
    await stagehand.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
