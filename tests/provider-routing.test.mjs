// The two structured arms (a11y-stagehand, dom-browseruse) are reused across
// providers via --model overrides — GPT-5.6 Luna runs through the same arms
// that Claude does. Provider prefix, credential and sampling must all follow
// the EFFECTIVE model; pinning any of them to Anthropic sends Luna traffic at
// the wrong provider, or demands a credential the run does not use.
import assert from "node:assert/strict";
import test from "node:test";

import { apiKeyEnvFor, providerFor, samplingFor } from "../arms/prompts.mjs";
import { planRuns } from "../harness/cli.mjs";

test("provider, credential and sampling follow the model, not the arm", () => {
  assert.equal(providerFor("gpt-5.6-luna"), "openai");
  assert.equal(providerFor("claude-sonnet-5"), "anthropic");
  assert.equal(providerFor("gemini-3.6-flash"), "google");

  assert.equal(apiKeyEnvFor("gpt-5.6-luna"), "OPENAI_API_KEY");
  assert.equal(apiKeyEnvFor("claude-sonnet-5"), "ANTHROPIC_API_KEY");
  assert.equal(apiKeyEnvFor("gemini-3.6-flash"), "GEMINI_API_KEY");

  // Only legacy Claude models accept a sampling parameter. GPT-5.x reasoning
  // models and Claude 4.7+ reject a non-default temperature with a 400, which
  // fails the whole request rather than degrading the answer.
  assert.deepEqual(samplingFor("gpt-5.6-luna").request, {});
  assert.deepEqual(samplingFor("claude-sonnet-5").request, {});
  assert.deepEqual(samplingFor("claude-sonnet-4-6").request, { temperature: 0 });
});

test("a Luna override on a structured arm requires OPENAI_API_KEY", () => {
  const methods = {
    "a11y-stagehand": { id: "a11y-stagehand", run() {}, model: "claude-sonnet-4-6", key: apiKeyEnvFor, paid: true },
  };
  const options = { preset: "full", sites: "directory-9d8", arms: ["a11y-stagehand"], seed: 1, budget: 100, perturbed: false, n: 3, models: {} };

  // Default (Claude) model: the Anthropic key is the one that matters.
  assert.equal(planRuns(options, { ANTHROPIC_API_KEY: "x" }, methods).runs.length, 1);

  const luna = { ...options, models: { "a11y-stagehand": "gpt-5.6-luna" } };
  const withAnthropicOnly = planRuns(luna, { ANTHROPIC_API_KEY: "x" }, methods);
  assert.equal(withAnthropicOnly.runs.length, 0, "an Anthropic key must not authorize a Luna run");
  assert.match(withAnthropicOnly.notices[0], /OPENAI_API_KEY/);

  const withOpenAI = planRuns(luna, { OPENAI_API_KEY: "y" }, methods);
  assert.equal(withOpenAI.runs.length, 1);
  assert.equal(withOpenAI.runs[0].method.model, "gpt-5.6-luna");
  assert.equal(withOpenAI.runs[0].method.key, "OPENAI_API_KEY");
});
