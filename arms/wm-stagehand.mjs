import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright";
import { z } from "zod";
import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { installModelContextBridge } from "./wm-claude.mjs";
import { BASE_SYSTEM, MECHANICS, claudeSampling } from "./prompts.mjs";

export const TOOL_VERSION = "stagehand@3.6.0+webmcp";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.webmcp}`;
// Every built-in page tool is excluded so the interface stays pure WebMCP;
// think/wait/done are the agent's own control tools and stay.
const EXCLUDE = ["act", "ariaTree", "extract", "fillForm", "fillFormVision", "goto", "keys", "navback", "screenshot", "scroll", "click", "type", "dragAndDrop", "clickAndHold", "search"];

// One tool call per turn, matching wm-claude's disable_parallel_tool_use and
// wm-gpt's parallel_tool_calls:false — parallel calls race the WebMCP bridge,
// whose tool set changes as the page navigates. Stagehand 3.6.0 exposes no
// option for it (its agent providerOptions are assembled internally), but it
// does apply AI SDK middleware to every model it builds in local mode, and
// transformParams sees the final request. @ai-sdk/anthropic maps
// disableParallelToolUse to tool_choice.disable_parallel_tool_use.
export const serialToolUse = {
  middlewareVersion: "v2",
  transformParams: async ({ params }) => ({
    ...params,
    providerOptions: {
      ...params.providerOptions,
      anthropic: { ...params.providerOptions?.anthropic, disableParallelToolUse: true },
    },
  }),
};

function createStagehand(apiKey, model = DEFAULT_MODEL) {
  return new Stagehand({
    env: "LOCAL",
    // Custom agent tools + excludeTools are gated behind these two flags in
    // stagehand 3.6.0; disableAPI keeps everything on the local browser (we
    // drive the site purely through the WebMCP bridge, not Stagehand's API).
    experimental: true,
    disableAPI: true,
    disablePino: true,
    verbose: 0,
    domSettleTimeout: 3000,
    model: { modelName: `anthropic/${model}`, middleware: serialToolUse, modelClientOptions: { ...claudeSampling(model).request }, ...(apiKey ? { apiKey } : {}) },
    localBrowserLaunchOptions: {
      headless: true,
      executablePath: process.env.WT_CHROME || chromium.executablePath(),
      viewport: { width: 1280, height: 800 },
    },
  });
}

// The live tool registry changes per page, but a Stagehand ToolSet is fixed at
// execute() time — so the arm exposes two stable meta-tools that proxy the
// bridge, MCP-style: discovery + dispatch.
function webmcpToolSet(page) {
  return {
    list_site_tools: {
      description: "List the WebMCP tools the current page exposes: name, description, and JSON input schema for each. The set changes when the site navigates — re-list after any tool that moves you to another page.",
      inputSchema: z.object({}),
      execute: async () => JSON.stringify(await page.evaluate(() => globalThis.__wtModelContextBridge?.list() ?? [])),
    },
    call_site_tool: {
      description: "Call one of the page's WebMCP tools by name with a JSON arguments object matching its input schema.",
      inputSchema: z.object({
        name: z.string().describe("Tool name exactly as returned by list_site_tools"),
        arguments: z.record(z.string(), z.any()).default({}).describe("Arguments object for the tool"),
      }),
      execute: async ({ name, arguments: args }) => {
        try {
          const result = await page.evaluate(
            ({ name, args }) => globalThis.__wtModelContextBridge.execute(name, args),
            { name, args: args ?? {} },
          );
          return JSON.stringify(result).slice(0, 20_000);
        } catch (error) {
          return JSON.stringify({ error: error.message });
        }
      },
    },
  };
}

export async function selfCheck() {
  const stagehand = createStagehand();
  try {
    await stagehand.init();
    const page = stagehand.context.activePage() ?? stagehand.context.pages()[0];
    await page.addInitScript(installModelContextBridge);
    return { ok: true, version: TOOL_VERSION.slice(10) };
  } finally {
    await stagehand.close().catch(() => {});
  }
}

export async function run({ task, capsule, model = DEFAULT_MODEL }) {
  const started = performance.now();
  const stagehand = createStagehand(process.env.ANTHROPIC_API_KEY, model);
  try {
    await stagehand.init();
    const page = stagehand.context.activePage() ?? stagehand.context.pages()[0];
    await page.addInitScript(installModelContextBridge);
    await page.goto(startUrl(task, capsule), { waitUntil: "domcontentloaded", timeoutMs: 30_000 });
    const setupMs = performance.now() - started;
    const result = await stagehand.agent({ mode: "dom", systemPrompt: withToday(SYSTEM), tools: webmcpToolSet(page) }).execute({
      instruction: task.prompt,
      // Each WebMCP action needs discovery plus a call.
      maxSteps: stepBudget(task, "webmcp", 12) * 2,
      excludeTools: EXCLUDE,
    });
    const metrics = result.usage ? null : await stagehand.metrics;
    const usage = {
      input_tokens: result.usage?.input_tokens ?? metrics?.agentPromptTokens ?? metrics?.totalPromptTokens ?? 0,
      output_tokens: result.usage?.output_tokens ?? metrics?.agentCompletionTokens ?? metrics?.totalCompletionTokens ?? 0,
    };
    return {
      finalText: result.message ?? "",
      usage,
      transcript: result.actions ?? [],
      cost: costFor(model, usage),
      turns: result.actions?.length ?? 0,
      setupMs,
      budget_exhausted: (result.actions?.length ?? 0) >= stepBudget(task, "webmcp", 12) * 2,
      temperature: "0",
      caching: "unsupported",
    };
  } finally {
    await stagehand.close().catch(() => {});
  }
}
