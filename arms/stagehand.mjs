import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright";
import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { BASE_SYSTEM, MECHANICS } from "./prompts.mjs";

export const TOOL_VERSION = "stagehand@3.6.0";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.structured}`;

function createStagehand(apiKey, model = DEFAULT_MODEL) {
  return new Stagehand({
    env: "LOCAL",
    disablePino: true,
    verbose: 0,
    domSettleTimeout: 3000,
    model: { modelName: `anthropic/${model}`, modelClientOptions: { temperature: 0 }, ...(apiKey ? { apiKey } : {}) },
    localBrowserLaunchOptions: {
      headless: true,
      executablePath: process.env.WT_CHROME || chromium.executablePath(),
      viewport: { width: 1280, height: 800 },
    },
  });
}

export async function selfCheck() {
  const stagehand = createStagehand();
  try {
    await stagehand.init();
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
    await page.goto(startUrl(task, capsule));
    const setupMs = performance.now() - started;
    const result = await stagehand.agent({ mode: "dom", systemPrompt: withToday(SYSTEM) }).execute({
      instruction: task.prompt,
      maxSteps: stepBudget(task, "structured", 20),
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
      budget_exhausted: (result.actions?.length ?? 0) >= stepBudget(task, "structured", 20),
      temperature: "0",
      caching: "unsupported",
    };
  } finally {
    await stagehand.close().catch(() => {});
  }
}
