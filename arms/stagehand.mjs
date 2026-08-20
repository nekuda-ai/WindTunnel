import { Stagehand } from "@browserbasehq/stagehand";
import { chromium } from "playwright";
import { startUrl, stepBudget, withToday } from "../harness/tasks.mjs";
import { costFor } from "../harness/lib.mjs";
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

function createStagehand(apiKey, model = DEFAULT_MODEL, seen = {}) {
  return new Stagehand({
    env: "LOCAL",
    disablePino: true,
    verbose: 0,
    domSettleTimeout: 3000,
    model: { modelName: `${providerFor(model)}/${model}`, modelClientOptions: { ...samplingFor(model).request, fetch: snapshotCapture(seen) }, ...(apiKey ? { apiKey } : {}) },
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
  const seen = {};
  const stagehand = createStagehand(process.env[apiKeyEnvFor(model)], model, seen);
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
      model_snapshot: seen.model ?? "",
      // Stagehand 3.6 exposes no served model and does not forward a custom
      // fetch through modelClientOptions, so the snapshot cannot be read
      // in-band. scripts/verify-model.mjs proves the id resolves at the
      // provider; this marks WHY the per-attempt field is empty rather than
      // leaving it indistinguishable from an arm that simply failed to record.
      snapshot_source: seen.model ? "provider-response" : "unavailable:stagehand@3.6",
      transcript: result.actions ?? [],
      cost: costFor(model, usage),
      turns: result.actions?.length ?? 0,
      setupMs,
      budget_exhausted: (result.actions?.length ?? 0) >= stepBudget(task, "structured", 20),
      temperature: samplingFor(model).temperature,
      effort: "provider-default",
      caching: "unsupported",
    };
  } finally {
    await stagehand.close().catch(() => {});
  }
}
