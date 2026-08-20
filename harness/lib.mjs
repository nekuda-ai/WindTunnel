import { randomUUID } from "node:crypto";

export const CSV_COLUMNS = [
  "run_id", "task_id", "arm", "model", "tool_version", "site", "start_url",
  "success", "failure_category", "wall_clock_s", "reset_s", "setup_s", "agent_s", "model_turns",
  "actions_or_tool_calls", "input_tokens", "output_tokens", "cached_tokens", "cache_write_tokens", "caching", "est_cost_usd", "cost_estimated",
  "snapshot_source", "stop_reason", "refusal", "truncated", "effort",
  "retries", "retry_wait_ms", "budget_exhausted", "temperature",
  "perturbation_id", "spec_shape", "rescored", "source", "timestamp",
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
  "\\b429\\b", "\\b5(?!55\\b)\\d\\d\\b", "overloaded", "insufficient_quota", "quota",
  "rate[ _-]?limit", "api_error", "service[ _-]?unavailable", "internal server error",
  "connection error", "apiconnectionerror", "request timed out", "socket hang up", "upstream (?:connect|request)",
  "econnreset", "econnrefused", "etimedout", "enotfound", "eai_again", "epipe",
  "capsule (?:boot|reset)", "boot-timeout", "reset-timeout", "probe-error:", "fetch failed",
].join("|"), "i");

export function classifyFailure(message) {
  return INFRA.test(String(message)) ? "infra" : "agent";
}

export function isInfraRow(row) {
  const failure = String(row.failure_category ?? "");
  return /^harness-infra:/i.test(failure)
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
  ["claude-fable-5", [10, 50, 1, 12.5]],
  ["claude-opus-5", [5, 25, 0.5, 6.25]],
  ["claude-opus-4", [5, 25, 0.5, 6.25]],
  // Standard list rates. An introductory $2/$10 applies through 2026-08-31;
  // pinning list keeps cost-per-task comparable with the other models and
  // reproducible afterwards, and makes the budget cap bind conservatively.
  ["claude-sonnet-5", [3, 15, 0.3, 3.75]],
  ["claude-sonnet-4-6", [3, 15, 0.3, 3.75]],
  ["claude-sonnet-4", [3, 15, 0.3, 3.75]],
  ["claude-haiku-4", [1, 5, 0.1, 1.25]],
  ["gpt-5.6-sol", [5, 30, 0.5, 6.25]],
  ["gpt-5.6-terra", [2.5, 15, 0.25, 3.125]],
  ["gpt-5.6-luna", [1, 6, 0.1, 1.25]],
  ["gpt-5.5", [5, 30, 0.5, 0]],
  ["computer-use-preview", [1.5, 6, 0.15, 0]],
  ["gemini-3.6-flash", [0.75, 3.75, 0.075, 0]],
];
const warnedModels = new Set();

export function costFor(model, { input_tokens = 0, output_tokens = 0, cached_input_tokens = 0, cache_creation_tokens = 0 } = {}) {
  const price = PRICES.find(([prefix]) => String(model).startsWith(prefix))?.[1];
  if (!price && !warnedModels.has(model)) { warnedModels.add(model); console.warn(`unknown model pricing: ${model}; using Claude Sonnet fallback`); }
  const [input, output, cached, write] = price ?? [3, 15, 0.3, 3.75];
  return (input_tokens * input + output_tokens * output + cached_input_tokens * cached + cache_creation_tokens * write) / 1_000_000;
}

export function csv(rows) {
  const escape = (value) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [CSV_COLUMNS.join(","), ...rows.map((row) => CSV_COLUMNS.map((key) => escape(row[key])).join(","))].join("\n") + "\n";
}
