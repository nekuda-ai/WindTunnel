import fs from "node:fs";

export const refresh = JSON.parse(fs.readFileSync(new URL("../configs/model-refresh.json", import.meta.url), "utf8"));
export function modelSpec(model) {
  const spec = refresh.models.find((item) => item.id === model || item.openrouter_id === model);
  if (!spec?.provider) throw new Error(`No pinned OpenRouter provider for ${model}`);
  return spec;
}

export function assertNativeAnthropic(env = process.env) {
  if (env.ANTHROPIC_BASE_URL) throw new Error("Unset ANTHROPIC_BASE_URL for native Claude arms; select --transport openrouter explicitly for WebMCP.");
}

export function nativeAnthropicOptions(env = process.env) {
  assertNativeAnthropic(env);
  const workspace = env.ANTHROPIC_WORKSPACE_ID;
  if (workspace && !/^wrkspc_[A-Za-z0-9]+$/.test(workspace)) throw new Error("Invalid ANTHROPIC_WORKSPACE_ID");
  return { maxRetries: 6, baseURL: "https://api.anthropic.com", ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}) };
}

export const responseRefused = (response) => response.stop_reason === "refusal"
  || (response.choices ?? []).some((choice) => choice.message?.refusal || choice.finish_reason === "content_filter")
  || (response.output ?? []).some((item) => item.type === "refusal" || (item.content ?? []).some((block) => block.type === "refusal"));

export function receiptOf(response, model) {
  const spec = modelSpec(model);
  const metadata = response.openrouter_metadata;
  const selected = metadata?.endpoints?.available?.find((endpoint) => endpoint.selected);
  const provider = response.provider ?? selected?.provider ?? "";
  const billed = response.usage?.cost;
  const served = response.model ?? "";
  const problems = [];
  if (!provider) problems.push("missing served provider");
  const normalize = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (provider && normalize(provider) !== normalize(spec.provider.split("/")[0])) problems.push(`unexpected served provider ${provider}`);
  if (!served || !(served === spec.openrouter_id || served === spec.id || served.startsWith(spec.openrouter_id + "-") || served.startsWith(spec.id + "-"))) problems.push(`unexpected served model ${served}`);
  if (typeof billed !== "number" || !Number.isFinite(billed) || billed < 0) problems.push("missing billed cost");
  if (metadata?.attempt > 1 || metadata?.strategy === "fallback") problems.push("unexpected routing fallback");
  const usage = response.usage ?? {};
  if (!("input_tokens" in usage || "prompt_tokens" in usage) || !("output_tokens" in usage || "completion_tokens" in usage)) problems.push("missing token usage");
  if (!response.id) problems.push("missing generation id");
  return { id: response.id ?? "", model: served, provider, provider_pin: spec.provider, cost: Number.isFinite(billed) && billed >= 0 ? billed : null, usage, problems, refusal: responseRefused(response), truncated: response.status === "incomplete" || response.stop_reason === "max_tokens" || (response.choices ?? []).some((choice) => choice.finish_reason === "length") };
}

export function routerUsage(receipts) {
  const total = { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_tokens: 0 };
  for (const { usage: u = {} } of receipts) {
    const details = u.input_tokens_details ?? u.prompt_tokens_details ?? {};
    const cached = u.cache_read_input_tokens ?? details.cached_tokens ?? 0;
    const written = u.cache_creation_input_tokens ?? details.cache_write_tokens ?? 0;
    const anthropic = "cache_read_input_tokens" in u || "cache_creation_input_tokens" in u;
    total.input_tokens += (u.input_tokens ?? u.prompt_tokens ?? 0) - (anthropic ? 0 : cached + written);
    total.output_tokens += u.output_tokens ?? u.completion_tokens ?? 0;
    total.cached_input_tokens += cached;
    total.cache_creation_tokens += written;
  }
  return total;
}

export function routingBody(body, model = body.model) {
  const spec = modelSpec(model);
  return { ...body, ...(spec.reasoning ? { reasoning: spec.reasoning } : {}), model: spec.openrouter_id, provider: { only: [spec.provider], order: [spec.provider], allow_fallbacks: false, require_parameters: true }, plugins: [] };
}

// Native SDKs and Stagehand retain their own request shapes. This fetch only
// changes transport and records the router's receipt; it never changes tools.
export function openRouterFetch(model, receipts, env = process.env) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not set");
  return async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    const format = pathname.endsWith("/messages") ? "messages" : pathname.endsWith("/responses") ? "responses" : pathname.endsWith("/chat/completions") ? "chat/completions" : null;
    if (!format) throw new Error(`Unsupported OpenRouter API path: ${pathname}`);
    const headers = new Headers(init.headers);
    headers.delete("x-api-key");
    headers.set("Authorization", `Bearer ${env.OPENROUTER_API_KEY}`);
    headers.set("Content-Type", "application/json");
    headers.set("X-OpenRouter-Metadata", "enabled");
    const body = routingBody(JSON.parse(init.body), model);
    const response = await fetch(`https://openrouter.ai/api/v1/${format}`, { ...init, headers, body: JSON.stringify(body), signal: init.signal ?? AbortSignal.timeout(600_000) });
    if (!response.ok) {
      const text = (await response.clone().text()).slice(0, 500);
      return new Response(JSON.stringify({ error: { message: `OpenRouter ${response.status}: ${text}` } }), { status: response.status, headers: { "content-type": "application/json" } });
    }
    if (body.stream) {
      // ponytail: buffer a clone for receipts; Stagehand acts after a completed
      // model turn anyway. Use incremental capture if streaming latency matters.
      const events = (await response.clone().text()).split(/\r?\n/).filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
        .map((line) => JSON.parse(line.slice(6)));
      const complete = events.findLast((event) => event.response?.usage)?.response;
      const merged = complete ?? Object.assign({}, ...events.filter((event) => event.usage || event.model || event.openrouter_metadata));
      receipts.push(receiptOf(merged, model));
    } else receipts.push(receiptOf(await response.clone().json(), model));
    return response;
  };
}

export async function requestOpenRouter(format, body, receipts) {
  const send = openRouterFetch(body.model, receipts);
  let retry_wait_ms = 0;
  for (let retries = 0; ; retries++) {
    try {
      const response = await send(`https://openrouter.ai/api/v1/${format}`, { method: "POST", body: JSON.stringify(body) });
      if (!response.ok) throw new Error((await response.json()).error.message);
      return { response: await response.json(), retries, retry_wait_ms };
    } catch (error) {
      if (retries >= 6 || !/OpenRouter (429|5\d\d):|fetch failed|ECONNRESET/.test(error.message)) throw error;
      const wait = Math.min(60_000, 2000 * 2 ** retries);
      retry_wait_ms += wait;
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

export function routerAccounting(receipts, estimated) {
  const complete = receipts.length > 0 && receipts.every((receipt) => !receipt.problems.length);
  const billed = receipts.reduce((sum, receipt) => sum + (receipt.cost ?? 0), 0);
  return {
    transport: "openrouter", provider: [...new Set(receipts.map((receipt) => receipt.provider))].join(","),
    provider_pin: receipts[0]?.provider_pin ?? "", generation_ids: receipts.map((receipt) => receipt.id),
    cost: complete ? billed : Math.max(billed, estimated), billed_cost_usd: billed, cost_estimated: !complete,
    failure: complete ? "" : `provider-accounting: ${receipts.flatMap((receipt) => receipt.problems).join("; ") || "no receipts"}`,
    refusal: receipts.some((receipt) => receipt.refusal), truncated: receipts.some((receipt) => receipt.truncated),
  };
}
