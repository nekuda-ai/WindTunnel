import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright";
import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
import { modelSpec, openRouterFetch, routerAccounting, routerUsage, assertNativeAnthropic } from "../harness/openrouter.mjs";
import { BASE_SYSTEM, MECHANICS, apiKeyEnvFor, providerFor, samplingFor } from "./prompts.mjs";

export const TOOL_VERSION = "stagehand@3.6.0";
const DEFAULT_MODEL = "claude-sonnet-4-6";
const SYSTEM = `${BASE_SYSTEM} ${MECHANICS.structured}`;

// Stagehand 3.6 does not surface which model actually answered, and the plan
// gates every flight on the served snapshot matching the requested model. The
// only place the truth is visible is the provider's own HTTP response, so wrap
// fetch and read `model` off it. Non-JSON/streaming bodies are skipped rather
// than consumed — the response handed back is always the original.
function snapshotCapture(seen) {
  return async (url, init) => {
    const response = await fetch(url, init);
    try {
      if ((response.headers.get("content-type") ?? "").includes("application/json")) {
        const body = await response.clone().json();
        if (body?.model) seen.model = body.model;
      }
    } catch { /* body not readable as JSON — leave the snapshot unrecorded */ }
    return response;
  };
}

export function stagehandModel(apiKey, model, seen = {}, transport = "direct", receipts = []) {
  if (transport === "openrouter") return { modelName: `openai/${modelSpec(model).openrouter_id}`, apiKey, baseURL: "https://openrouter.ai/api/v1", fetch: openRouterFetch(model, receipts) };
  if (providerFor(model) === "anthropic") assertNativeAnthropic();
  return { modelName: `${providerFor(model)}/${model}`, ...samplingFor(model).request, fetch: snapshotCapture(seen), ...(apiKey ? { apiKey } : {}) };
}

function createStagehand(apiKey, model = DEFAULT_MODEL, seen = {}, transport = "direct", receipts = []) {
  return new Stagehand({
    env: "LOCAL",
    disablePino: true,
    verbose: 0,
    domSettleTimeout: 3000,
    model: stagehandModel(apiKey, model, seen, transport, receipts),
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

export async function run({ task, capsule, model = DEFAULT_MODEL, transport = "direct", receipts = [], progress = {} }) {
  const started = performance.now();
  const seen = {};
  const stagehand = createStagehand(process.env[transport === "openrouter" ? "OPENROUTER_API_KEY" : apiKeyEnvFor(model)], model, seen, transport, receipts);
  try {
    await stagehand.init();
    const page = stagehand.context.activePage() ?? stagehand.context.pages()[0];
    await page.goto(startUrl(task, capsule));
    const setupMs = performance.now() - started;
    const result = await stagehand.agent({ mode: "dom", systemPrompt: withToday(SYSTEM) }).execute({
      instruction: task.prompt,
      maxSteps: stepBudget(task, "structured", 20),
      signal: AbortSignal.timeout(600_000),
    });
    const metrics = result.usage ? null : await stagehand.metrics;
    const usage = transport === "openrouter" ? routerUsage(receipts) : {
      input_tokens: result.usage?.input_tokens ?? metrics?.agentPromptTokens ?? metrics?.totalPromptTokens ?? 0,
      output_tokens: result.usage?.output_tokens ?? metrics?.agentCompletionTokens ?? metrics?.totalCompletionTokens ?? 0,
    };
    return {
      finalText: result.message ?? "",
      usage,
      model_snapshot: receipts.at(-1)?.model ?? seen.model ?? "",
      // Capture the provider response because Stagehand's result omits it.
      snapshot_source: receipts.length ? "provider-response" : seen.model ? "provider-response" : "unavailable:stagehand@3.6",
      transcript: result.actions ?? [],
      cost: costFor(model, usage),
      ...(transport === "openrouter" ? routerAccounting(receipts, costFor(model, usage)) : {}),
      failure: (result.success === false ? result.message : "") || (transport === "openrouter" ? routerAccounting(receipts, costFor(model, usage)).failure : ""),
      turns: result.actions?.length ?? 0,
      setupMs,
      budget_exhausted: (result.actions?.length ?? 0) >= stepBudget(task, "structured", 20),
      temperature: samplingFor(model).temperature,
      effort: transport === "openrouter" ? modelSpec(model).reasoning?.effort ?? "provider-default" : "provider-default",
      caching: transport === "openrouter" ? "provider-managed" : "unsupported",
    };
  } catch (error) {
    if (transport !== "openrouter") throw error;
    const usage = routerUsage(receipts);
    return { finalText: "", usage, model_snapshot: receipts.at(-1)?.model ?? "", ...routerAccounting(receipts, costFor(model, usage)), failure: error.message, turns: receipts.length, setupMs: 0 };
  } finally {
    await stagehand.close().catch(() => {});
  }
}
