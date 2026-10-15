import { randomUUID } from "node:crypto";
import { refresh } from "./openrouter.mjs";

export const CSV_COLUMNS = [
  "run_id", "task_id", "arm", "model", "tool_version", "site", "start_url",
  "success", "failure_category", "wall_clock_s", "reset_s", "setup_s", "agent_s", "model_turns",
  "actions_or_tool_calls", "input_tokens", "output_tokens", "cached_tokens", "cache_write_tokens", "caching", "est_cost_usd", "cost_estimated",
  "snapshot_source", "stop_reason", "refusal", "truncated", "effort",
  "retries", "retry_wait_ms", "budget_exhausted", "temperature",
  "perturbation_id", "spec_shape", "rescored", "source", "timestamp", "transport", "provider", "provider_pin", "billed_cost_usd", "generation_ids", "model_snapshot",
];

// A provider outage must never be charged to the model's task ability. These
// signatures are the ones a Claude/OpenAI incident actually produces —
// `rate_limit_error`, `api_error`, `service_unavailable` and the SDK's
// "Connection error." carry no numeric code, and raw socket errors carry no
// HTTP status at all, so a status-code-only rule silently scored them as agent
// failures. Deliberately NOT matched: "attempt timeout: <n>s agent budget"
// (a real timeout under the declared cap) and bridge-registration failures,
// which are site/harness outcomes rather than provider outages.
const INFRA = new RegExp([
  "\\b429\\b", "OpenRouter (?:400|401|402|403|404):", "provider-accounting:", "\\b5(?!55\\b)\\d\\d\\b", "overloaded", "insufficient_quota", "quota",
  "rate[ _-]?limit", "api_error", "service[ _-]?unavailable", "internal server error",
  "connection error", "apiconnectionerror", "request timed out", "socket hang up", "upstream (?:connect|request)",
  "econnreset", "econnrefused", "etimedout", "enotfound", "eai_again", "epipe",
  "capsule (?:boot|reset)", "boot-timeout", "reset-timeout", "probe-error:", "fetch failed",
].join("|"), "i");

// Chromium can lose screenshot capture before the model sees the page.
// Recognize the old agent prefix too so interrupted checkpoints retry these cells.
const SCREENSHOT_FAILURE = /^(?:harness-(?:agent|infra):\s*)?page\.screenshot: Protocol error \(Page\.captureScreenshot\): Unable to capture screenshot\b/i;

export function isProviderSetupFailure(message) {
  return /(?:^|harness-(?:agent|infra):\s*)(?:(?:OpenRouter|OpenAI|Gemini|Anthropic|Meta)\s+)?(?:400|401|402|403|404)\b|authentication_error|permission_error|invalid_api_key|credit balance.*(?:low|insufficient)|insufficient credits/i.test(String(message));
}

export function classifyFailure(message) {
  return SCREENSHOT_FAILURE.test(String(message)) || isProviderSetupFailure(message) || INFRA.test(String(message)) ? "infra" : "agent";
}

export function isInfraRow(row) {
  const failure = String(row.failure_category ?? "");
  return /^harness-infra:/i.test(failure)
    || SCREENSHOT_FAILURE.test(failure)
    || (/^harness:/i.test(failure) && /(?:\b429\b|quota|boot-timeout)/i.test(failure));
}

export function verdictFor(rows) {
  const valid = rows.filter((row) => !isInfraRow(row));
  const passes = valid.filter((row) => row.pass ?? row.success).length;
  return { solved: valid.length > 0 && passes > valid.length / 2, passes, attempts: valid.length };
}

export const newRunId = (taskId, arm) => `${taskId}_${arm}_${randomUUID()}`;

// $ per million tokens (input, output, cached read, cache write), longest-prefix match.
// Unknown models are estimated at Sonnet rates — extend this map when running
// a model that isn't covered.
export const PRICES = [
  ...refresh.models.map(({ id, prices }) => [id, prices]),
  ["claude-fable-5", [10, 50, 1, 12.5]],
  ["claude-opus-5", [5, 25, 0.5, 6.25]],
  ["claude-opus-4", [5, 25, 0.5, 6.25]],
  // Historical legacy entries below are retained for old model families.
  // Current refresh prices above take precedence for identical prefixes.
  ["claude-sonnet-4-6", [3, 15, 0.3, 3.75]],
  ["claude-sonnet-4", [3, 15, 0.3, 3.75]],
  ["claude-haiku-4", [1, 5, 0.1, 1.25]],
  // GPT-6 Astra list rates (≤272K context; longer prompts are 2× — never
  // reached here). Cache writes are billed at 1.25× input, so the arms must
  // report cache_write_tokens as cache_creation_tokens for this to bind.
  ["gpt-6-astra", [10, 50, 1, 12.5]],
  ["gpt-5.6-sol", [5, 30, 0.5, 6.25]],
  ["gpt-5.6-terra", [2.5, 15, 0.25, 3.125]],
  ["gpt-5.6-luna", [0.2, 1.2, 0.02, 0.25]],
  ["gpt-5.5", [5, 30, 0.5, 0]],
  ["computer-use-preview", [1.5, 6, 0.15, 0]],
  ["gemini-3.6-flash", [0.75, 3.75, 0.075, 0]],
];
const warnedModels = new Set();

export function costFor(model, { input_tokens = 0, output_tokens = 0, cached_input_tokens = 0, cache_creation_tokens = 0 } = {}) {
  const bare = String(model).split("/").at(-1).replace(/^(claude-(?:sonnet|opus|haiku)-5)\.5/, "$1-5");
  const price = [...PRICES].sort((a, b) => b[0].length - a[0].length).find(([prefix]) => bare.startsWith(prefix))?.[1];
  if (!price && !warnedModels.has(model)) { warnedModels.add(model); console.warn(`unknown model pricing: ${model}; using Claude Sonnet fallback`); }
  let [input, output, cached, write] = price ?? [3, 15, 0.3, 3.75];
  const tier = refresh.models.find(({ id }) => bare.startsWith(id))?.price_overrides?.filter((tier) => tier.min_prompt_tokens != null && input_tokens + cached_input_tokens + cache_creation_tokens >= tier.min_prompt_tokens).at(-1);
  if (tier) [input, output, cached, write] = [tier.prompt, tier.completion, tier.input_cache_read ?? 0, tier.input_cache_write ?? 0].map((n) => Number(n) * 1_000_000);
  return (input_tokens * input + output_tokens * output + cached_input_tokens * cached + cache_creation_tokens * write) / 1_000_000;
}

export function csv(rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((key) => escape(row[key])).join(","))].join("\n") + "\n";
}
