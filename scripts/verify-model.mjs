#!/usr/bin/env node
// Out-of-band model verification: ask the provider directly what a model id
// resolves to, and print the snapshot it served.
//
//   node scripts/verify-model.mjs claude-sonnet-5 gpt-5.6-luna
//
// Why this exists: the plan gates every flight on "exact requested
// model/snapshot" and "do not silently fall back to another model". Arms that
// drive a model through the provider SDK record the served snapshot per
// attempt. Third-party harnesses do not: Stagehand 3.6 exposes no served model
// and does not forward a custom fetch through modelClientOptions, so there is
// no in-band place to read it. This probe closes that gap by proving the id
// resolves at the provider and to WHAT — so a silent substitution would be
// visible here even though the harness cannot report it per attempt.
//
// Costs a few tokens per model.
import { apiKeyEnvFor, providerFor, samplingFor } from "../arms/prompts.mjs";

const models = process.argv.slice(2);
if (!models.length) { console.error("usage: verify-model.mjs <model> [model...]"); process.exit(2); }

let failed = false;
for (const model of models) {
  const provider = providerFor(model);
  const keyEnv = apiKeyEnvFor(model);
  const apiKey = process.env[keyEnv];
  if (!apiKey) { console.error(`${model}: ${keyEnv} is not set`); failed = true; continue; }
  try {
    let served, note = "";
    if (provider === "anthropic") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 4, messages: [{ role: "user", content: "ok" }], ...samplingFor(model).request }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`${response.status} ${body?.error?.message ?? ""}`);
      served = body.model;
      note = `stop_reason=${body.stop_reason}`;
    } else if (provider === "openai") {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model, input: "ok", max_output_tokens: 16 }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(`${response.status} ${body?.error?.message ?? ""}`);
      served = body.model;
      note = `status=${body.status}`;
    } else {
      console.log(`${model}: ${provider} — no direct probe implemented, skipped`);
      continue;
    }
    const match = String(served).startsWith(model);
    console.log(`${match ? "✅" : "❌"} ${model} -> served "${served}" ${note}`);
    if (!match) failed = true;
  } catch (error) {
    console.error(`❌ ${model}: ${error.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
