import { execFileSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import { costFor, classifyFailure } from "../harness/lib.mjs";
import { refresh, openRouterFetch, requestOpenRouter, routerAccounting, receiptOf } from "../harness/openrouter.mjs";
import { parseArgs, planRuns, runBenchmark } from "../harness/cli.mjs";
import { executeAction, versionFor, run as runComputer } from "../arms/cu-claude.mjs";
import { run as runClaude } from "../arms/wm-claude.mjs";
import { run as runChat } from "../arms/wm-chat.mjs";
import { stagehandModel, createStagehand } from "../arms/stagehand.mjs";
import { Stagehand } from "@browserbasehq/stagehand";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configHash, validateRun, root, argsFor, recordedSpend } from "../scripts/model-refresh.mjs";
import { hashes } from "../scoring/report.mjs";
import { buildRelease, publicCleaner } from "../scripts/prepare-model-release.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const env = { MODEL_API_KEY: "test-meta", OPENROUTER_API_KEY: "test-router", ANTHROPIC_API_KEY: "test-claude", OPENAI_API_KEY: "test-openai", GEMINI_API_KEY: "test-google" };
const context = { async addInitScript() {} };
const page = { context: () => context, async goto() {}, async waitForFunction() {}, async waitForTimeout() {},
  async evaluate(_fn, input) { return input ? { ok: true } : [{ name: "noop", inputSchema: { type: "object", properties: {} } }]; } };
const task = { id: "t", prompt: "Call noop, then finish.", tier: "answer" }, capsule = { baseUrl: "http://fake" };

test("Flash 1017 flight preserves OpenRouter and pins Fireworks with high reasoning", async () => {
  const { flightConfigurations = [] } = await import("../scripts/native-flight.mjs");
  const configs = flightConfigurations.filter(c => c.model === "deepseek-v4.1-flash-1017");
  assert.deepEqual(configs.map(c => c.arm).sort(), ["a11y-stagehand", "wm-chat"]);
  for (const config of configs) {
    const plan = planRuns(parseArgs(argsFor(config, 10, "test", false)), { OPENROUTER_API_KEY: "test-router" });
    assert.equal(plan.notices.length, 0);
    assert.equal(plan.runs.length, 8);
    assert(plan.runs.every(r => r.method.transport === "openrouter"));
  }
  const original = globalThis.fetch, old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-router";
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.model, "deepseek/deepseek-v4.1-flash-1017");
      assert.deepEqual(body.provider.only, ["fireworks"]);
      assert.equal(body.provider.allow_fallbacks, false);
      assert.equal(body.reasoning.effort, "high");
      return json({ id: "gen-flash-1017", model: body.model, provider: "Fireworks", usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.0001 }, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Final answer: done" } }] });
    };
    const result = await runChat({ task, capsule, page, model: "deepseek-v4.1-flash-1017" });
    assert.equal(result.failure, "");
    assert.equal(result.effort, "high");
    assert.equal(result.provider_pin, "fireworks");
    assert.equal(result.cost_estimated, false);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; }
});

test("matrix plans all 24 configurations, without Grok or missing-key skips", () => {
  assert.deepEqual(parseArgs(argsFor(refresh.configurations[0], 1, "test", true)).taskIds, ["md-1", "md-5"]);
  assert.equal(refresh.configurations.length, 24);
  assert.equal(refresh.configurations.filter((c) => c.role === "current").length, 17);
  assert(!JSON.stringify(refresh).toLowerCase().includes("grok"));
  for (const c of refresh.configurations) {
    const args = ["--sites", "full", "--arms", c.arm, "--model", `${c.arm}=${c.model}`, "--transport", c.transport];
    if (c.tool_version) args.push("--tool-version", `${c.arm}=${c.tool_version}`);
    const plan = planRuns(parseArgs(args), env);
    assert.equal(plan.notices.length, 0, c.id);
    assert.equal(plan.runs.length, 8, c.id);
  }
  assert.throws(() => planRuns(parseArgs(["--arms", "cu-openai", "--transport", "openrouter"]), env), /requires direct/);
  assert.throws(() => planRuns(parseArgs(["--arms", "wm-claude"]), { ...env, ANTHROPIC_BASE_URL: "https://other.invalid" }), /Unset ANTHROPIC_BASE_URL/);
});

test("pricing chooses the longest prefix and normalizes OpenRouter IDs", () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 1_000_000, cached_input_tokens: 1_000_000, cache_creation_tokens: 1_000_000 };
  assert.equal(costFor("claude-opus-5", usage), 36.75);
  assert.equal(costFor("claude-opus-5-5", usage), 29.2);
  assert.equal(costFor("anthropic/claude-opus-5.5", usage), 29.2);
  assert.equal(costFor("claude-sonnet-5", usage), 14.7);
  assert.equal(costFor("gpt-6-luna", usage), 1.22);
  assert.equal(costFor("gpt-6-luna", { input_tokens: 1000, output_tokens: 1000 }), 0.0006);
  assert.ok(Math.abs(costFor("claude-haiku-5-5", { input_tokens: 99_999 }) - 0.0099999) < 1e-12);
  assert.equal(costFor("claude-haiku-5-5", { input_tokens: 100_000 }), 0.05);
});

test("OpenRouter errors are infrastructure; task timeouts remain model outcomes", () => {
  for (const code of [400, 401, 402, 403, 404, 429, 500]) assert.equal(classifyFailure(`OpenRouter ${code}: failed`), "infra");
  assert.equal(classifyFailure("provider-accounting: missing billed cost"), "infra");
  assert.equal(classifyFailure("attempt timeout: 600s agent budget"), "agent");
});

test("router transport pins provider, strips SDK credentials and records billed cost", async () => {
  const original = globalThis.fetch, receipts = [];
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://openrouter.ai/api/v1/messages");
      assert.equal(init.headers.get("authorization"), "Bearer test-router");
      assert.equal(init.headers.get("x-api-key"), null);
      const body = JSON.parse(init.body);
      assert.equal(body.model, "anthropic/claude-sonnet-5.5");
      assert.deepEqual(body.provider, { only: ["anthropic"], order: ["anthropic"], allow_fallbacks: false, require_parameters: true });
      return json({ id: "gen-1", model: body.model, usage: { input_tokens: 1, output_tokens: 1, cost: 0.03 }, openrouter_metadata: { attempt: 1, endpoints: { available: [{ selected: true, provider: "Anthropic" }] } } });
    };
    const response = await openRouterFetch("claude-sonnet-5-5", receipts, env)("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": "unused" }, body: JSON.stringify({ model: "claude-sonnet-5-5" }) });
    assert.equal((await response.json()).id, "gen-1");
    assert.equal(routerAccounting(receipts, 1).cost, 0.03);
    assert.equal(routerAccounting(receipts, 1).cost_estimated, false);
    assert.equal(receipts[0].provider, "Anthropic");
    const missing = receiptOf({ model: "anthropic/claude-sonnet-5.5" }, "claude-sonnet-5-5");
    assert.match(routerAccounting([missing], 1).failure, /missing billed cost/);
  } finally { globalThis.fetch = original; }
});

test("credit exhaustion fails immediately and preserves a 402 message", async () => {
  const original = globalThis.fetch, old = process.env.OPENROUTER_API_KEY;
  let calls = 0;
  process.env.OPENROUTER_API_KEY = "test-router";
  try {
    globalThis.fetch = async () => { calls++; return json({ error: { message: "Insufficient credits" } }, 402); };
    await assert.rejects(requestOpenRouter("responses", { model: "gpt-6-luna" }, []), /OpenRouter 402:/);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; }
});

test("Chat Completions WebMCP preserves reasoning and completes a tool roundtrip", async () => {
  const original = globalThis.fetch, old = process.env.OPENROUTER_API_KEY;
  const requests = []; process.env.OPENROUTER_API_KEY = "test-router";
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      return json({ id: `gen-${requests.length}`, model: body.model, provider: "DeepSeek", usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 20, cache_write_tokens: 5 }, cost: 0.002 }, choices: [{ finish_reason: "stop", message: requests.length === 1 ? { role: "assistant", content: null, reasoning_details: [{ type: "reasoning.text", text: "think" }], tool_calls: [{ id: "call-1", type: "function", function: { name: "noop", arguments: "{}" } }] } : { role: "assistant", content: "Final answer: done" } }] });
    };
    const result = await runChat({ task, capsule, page, model: "deepseek-v4.1-flash" });
    assert.equal(result.finalText, "Final answer: done"); assert.equal(result.cost, 0.004);
    assert.equal(result.usage.input_tokens, 150); assert.equal(result.usage.cache_creation_tokens, 10);
    assert.equal(requests[1].messages[2].reasoning_details[0].text, "think");
    assert.equal(requests[1].messages[3].tool_call_id, "call-1"); assert.equal(result.failure, "");
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; }
});

test("Anthropic-compatible WebMCP retains cache writes and router receipts", async () => {
  const original = globalThis.fetch, old = process.env.OPENROUTER_API_KEY;
  let calls = 0; process.env.OPENROUTER_API_KEY = "test-router";
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body); calls++;
      assert.equal(body.model, "anthropic/claude-opus-5.5"); assert.equal(body.max_tokens, 16384);
      return json({ id: `gen-${calls}`, type: "message", role: "assistant", model: body.model, provider: "Anthropic", stop_reason: calls === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 30, cache_read_input_tokens: 20, cost: 0.01 }, content: calls === 1 ? [{ type: "tool_use", id: "tool-1", name: "noop", input: {} }] : [{ type: "text", text: "Final answer: done" }] });
    };
    const result = await runClaude({ task, capsule, page, model: "claude-opus-5-5", transport: "openrouter" });
    assert.equal(result.usage.cache_creation_tokens, 60); assert.equal(result.cost, 0.02);
    assert.equal(result.failure, ""); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; }
});

test("Claude toolset handles modifiers, key repeats, mouse buttons and crop", async () => {
  assert.equal(versionFor("claude-haiku-5-5"), "computer_toolset_20260801");
  assert.equal(versionFor("claude-sonnet-5"), "computer_20251124");
  const calls = [], cursor = { x: 0, y: 0 };
  const p = { mouse: { click: async (...args) => calls.push(["click", ...args]), down: async () => calls.push(["mouse_down"]), up: async () => calls.push(["mouse_up"]) }, keyboard: { down: async (k) => calls.push(["down", k]), up: async (k) => calls.push(["up", k]), press: async (k) => calls.push(["key", k]) }, waitForTimeout: async () => {}, screenshot: async (options) => { calls.push(["screenshot", options]); return Buffer.from("png"); } };
  await executeAction(p, { action: "left_click", coordinate: [10, 20], text: "shift" }, cursor);
  await executeAction(p, { action: "key", text: "Tab", repeat: 4 }, cursor);
  await executeAction(p, { action: "left_mouse_down" }, cursor);
  await executeAction(p, { action: "left_mouse_up" }, cursor);
  await executeAction(p, { action: "zoom", region: [0, 0, 100, 100] }, cursor);
  assert.deepEqual(calls.slice(0, 3), [["down", "Shift"], ["click", 10, 20], ["up", "Shift"]]);
  assert.equal(calls.filter(([type]) => type === "key").length, 4);
  assert.equal((await executeAction(p, { action: "cursor_position" }, cursor)).text, "X=10, Y=20");
  await assert.rejects(executeAction(p, { action: "zoom", region: [1, 1, -1, -1] }), /Invalid zoom/);
});

test("local Stagehand honors agent cancellation before making a paid request", async () => {
  const old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-router";
  const stagehand = createStagehand("test-router", "deepseek-v4.1-flash-1017", {}, "openrouter");
  const original = globalThis.fetch;
  try {
    await stagehand.init();
    globalThis.fetch = async () => { throw new Error("Unexpected paid API request"); };
    const result = await stagehand.agent({ mode: "dom" }).execute({ instruction: "Do nothing.", signal: AbortSignal.abort(new Error("test cancelled")) }).catch(error => ({ message: error.message }));
    assert.match(result.message, /test cancelled|aborted/i);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; await stagehand.close().catch(() => {}); }
});

test("Stagehand's installed SDK uses the pinned router transport and captures its receipt", async () => {
  const original = globalThis.fetch, old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-router";
  const receipts = [];
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://openrouter.ai/api/v1/responses");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "z-ai/glm-5.3");
      assert.deepEqual(body.provider.only, ["z-ai/fp8"]);
      return json({ id: "gen-stagehand", object: "response", created_at: 0, status: "completed", model: body.model, provider: "Z.AI", output: [{ id: "msg-1", type: "message", role: "assistant", content: [{ type: "output_text", text: "done", annotations: [] }] }], usage: { input_tokens: 100, output_tokens: 2, total_tokens: 102, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 0 }, cost: 0.01 } });
    };
    const config = stagehandModel("test-router", "glm-5.3", {}, "openrouter", receipts);
    const stagehand = new Stagehand({ env: "LOCAL", disablePino: true, verbose: 0, model: config });
    const result = await stagehand.llmClient.getLanguageModel().doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "finish" }] }] });
    assert.equal(result.content[0].text, "done");
    assert.equal(receipts[0].provider, "Z.AI");
    assert.equal(routerAccounting(receipts, 1).cost, 0.01);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; }
});

test("new Claude computer toolset uses stable Messages and echoes member/toolset IDs", async () => {
  const original = globalThis.fetch, old = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-claude";
  let calls = 0;
  try {
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(init.body); calls++;
      assert.equal(String(url), "https://api.anthropic.com/v1/messages");
      assert.deepEqual(body.tools, [{ type: "computer_toolset_20260801" }]);
      assert(!body.betas);
      if (calls === 2) {
        const result = body.messages[2].content[0];
        assert.equal(result.toolset_name, "computer");
        assert.equal(result.tool_use_id, "shot-1");
        assert.equal(result.content[0].type, "image");
      }
      return json({ id: `msg-${calls}`, type: "message", role: "assistant", model: body.model, stop_reason: calls === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 1 }, content: calls === 1 ? [{ type: "tool_use", id: "shot-1", toolset_name: "computer", name: "screenshot", input: {} }] : [{ type: "text", text: "Final answer: done" }] });
    };
    const fake = { ...page, async setViewportSize() {}, async waitForLoadState() {}, async screenshot() { return Buffer.from("png"); } };
    const result = await runComputer({ task, capsule, page: fake, model: "claude-haiku-5-5" });
    assert.equal(result.tool_version, "computer_toolset_20260801");
    assert.equal(result.failure, ""); assert.equal(calls, 2);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = old; }
});

test("Claude toolset rejects a nonmember call without inventing its toolset name", async () => {
  const original = globalThis.fetch, old = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-claude";
  let calls = 0, screenshots = 0;
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body); calls++;
      if (calls === 2) {
        const result = body.messages.at(-1).content[0];
        assert.equal(result.tool_use_id, "nonmember-1");
        assert.equal(result.is_error, true);
        assert(!Object.hasOwn(result, "toolset_name"));
        assert.equal(screenshots, 0);
      }
      if (calls === 3) {
        const result = body.messages.at(-1).content[0];
        assert.equal(result.toolset_name, "computer");
        assert.equal(result.tool_use_id, "shot-2");
        assert.equal(result.content[0].type, "image");
      }
      const content = calls === 1
        ? [{ type: "tool_use", id: "nonmember-1", name: "computer", input: { actions: [] } }]
        : calls === 2
          ? [{ type: "tool_use", id: "shot-2", toolset_name: "computer", name: "screenshot", input: {} }]
          : [{ type: "text", text: "Final answer: done" }];
      return json({ id: `msg-${calls}`, type: "message", role: "assistant", model: body.model,
        stop_reason: calls < 3 ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5 }, content });
    };
    const fake = { ...page, async setViewportSize() {}, async waitForLoadState() {},
      async screenshot() { screenshots++; return Buffer.from("png"); } };
    const result = await runComputer({ task, capsule, page: fake, model: "claude-haiku-5-5" });
    assert.equal(result.failure, "");
    assert.equal(result.finalText, "Final answer: done");
    assert.equal(calls, 3); assert.equal(screenshots, 1);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = old; }
});

test("a router 402 aborts the whole flight and journals prior billed spend", async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wt-router-abort-"));
  const costs = [];
  try {
    const result = await runBenchmark(["--sites", "full", "--arms", "wm-chat", "--n", "3", "--transport", "openrouter"], {
      env: { ...env, WT_FAKE_LIFECYCLE: "1" }, outputRoot, log() {}, onAttempt(row) { costs.push(row.est_cost_usd); },
      methods: { "wm-chat": { id: "wm-chat", model: "glm-5.3", paid: true, async run() { return { failure: "OpenRouter 402: no credits", cost: 0.02 }; } } },
    });
    assert.equal(result.rows.length, 1);
    assert.deepEqual(costs, [0.02]);
    assert.match(JSON.parse(fs.readFileSync(path.join(result.outputDir, "run.json"))).options.aborted, /provider setup/);
  } finally { fs.rmSync(outputRoot, { recursive: true, force: true }); }
});

test("release preparation rejects incomplete sources and preserves history without secrets", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "wt-refresh-release-"));
  const base = JSON.parse(execFileSync("git", ["show", `${refresh.base_revision}:results/canonical/run.json`], { cwd: root, maxBuffer: 100 * 1024 * 1024 }));
  const oldRows = base.rows.filter((row) => row.model === "claude-sonnet-5" && row.arm === "wm-claude");
  const runs = refresh.configurations.map((config) => {
    const spec = refresh.models.find((spec) => spec.id === config.model);
    const rows = oldRows.map((old, i) => ({ ...old, run_id: `${config.id}-${i}`, arm: config.arm, method: config.arm, model: config.model, model_snapshot: config.model, tool_version: config.tool_version ?? (config.arm === "cu-claude" ? versionFor(config.model) : "mock"), transport: config.transport, provider: spec.provider?.split("/")[0] ?? "Google", provider_pin: spec.provider ?? "", billed_cost_usd: config.transport === "openrouter" ? 0.01 : "", est_cost_usd: 0.01, cost_estimated: config.transport === "openrouter" ? false : true, generation_ids: '["gen-mock"]', transcript: [{ secret: "never publish" }] }));
    return { options: { seed: 1, task_set_hash: hashes().taskSet, goldens_hash: hashes().goldens, refresh_hash: configHash() }, rows };
  });
  try {
    assert.equal(oldRows.length, 147);
    const config = refresh.configurations[0], original = runs[0];
    assert.throws(() => validateRun({ ...original, rows: original.rows.slice(1) }, config), /incomplete task coverage/);
    assert.throws(() => validateRun({ ...original, options: { ...original.options, fake: true } }, config), /fake/);
    assert.throws(() => validateRun({ ...original, rows: [{ ...original.rows[0], model_snapshot: "wrong-model" }, ...original.rows.slice(1)] }, config), /snapshot/);
    assert.throws(() => validateRun({ ...original, rows: [{ ...original.rows[0], provider_pin: "wrong" }, ...original.rows.slice(1)] }, config), /accounting/);
    const clean = publicCleaner();
    assert.equal(clean("sk-or-v1-" + "a".repeat(30)), "[redacted]");
    assert.equal(clean("AIzaSy" + "a".repeat(33)), "[redacted]");
    const dirs = runs.map((run, i) => { const dir = path.join(temporary, String(i)); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run)); return dir; });
    const out = path.join(temporary, "release");
    assert.throws(() => buildRelease(dirs.slice(1), out), /Missing complete/);
    assert(!fs.existsSync(out));
    const result = buildRelease(dirs, out);
    assert.deepEqual([result.current, result.history, result.controls], [3234, 5586, 147]);
    const currentText = fs.readFileSync(path.join(out, "current/run.json"), "utf8");
    assert(!currentText.includes('"transcript"')); assert(!currentText.includes("never publish"));
    const history = JSON.parse(fs.readFileSync(path.join(out, "history/run.json")));
    assert.deepEqual(history.rows.slice(0, base.rows.length), base.rows);
    const current = JSON.parse(currentText);
    assert.equal(new Set(current.rows.map((row) => `${row.arm}|${row.model}`)).size, 22);
    // A fixture can be retained outside the repo to exercise the Python package builder.
    if (process.env.WT_REFRESH_TEST_ARTIFACT) fs.cpSync(out, process.env.WT_REFRESH_TEST_ARTIFACT, { recursive: true, errorOnExist: true });
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("native access errors abort instead of becoming model failures", async () => {
  for (const message of ['OpenAI 401: invalid_api_key', '403 {"error":{"type":"permission_error"}}', '400 {"error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}']) assert.equal(classifyFailure(message), "infra", message);
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wt-native-abort-"));
  try {
    const result = await runBenchmark(["--sites", "full", "--arms", "cu-openai", "--n", "3"], {
      env: { ...env, WT_FAKE_LIFECYCLE: "1" }, outputRoot, log() {},
      methods: { "cu-openai": { id: "cu-openai", model: "gpt-6-luna", paid: true, async run() { return { failure: "OpenAI 401: invalid_api_key", cost: 0.02, usage: { input_tokens: 1 } }; } } },
    });
    assert.equal(result.rows.length, 1);
    assert.match(result.rows[0].failure_category, /^harness-infra:/);
  } finally { fs.rmSync(outputRoot, { recursive: true, force: true }); }
});

test("a browser/discovery exception after a billed turn retains receipts and usage", async () => {
  const { runBatch } = await import("../harness/run.mjs");
  const { run } = await import("../arms/wm-gpt.mjs");
  const original = globalThis.fetch, old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-router";
  let discoveries = 0;
  try {
    globalThis.fetch = async (_url, init) => json({ id: "gen-paid", model: JSON.parse(init.body).model, provider: "OpenAI", usage: { input_tokens: 100, output_tokens: 10, cost: 0.03 }, output: [{ type: "function_call", name: "noop", arguments: "{}", call_id: "call-paid" }] });
    const broken = { ...page, async evaluate(_fn, input) { return input ? { ok: true } : ++discoveries === 1 ? [{ name: "noop" }] : []; } };
    const result = await runBatch({ siteId: "fake", tasks: [task], n: 1, method: { id: "wm-gpt", model: "gpt-6-luna", transport: "openrouter", paid: true, run }, page: broken, boot: async () => ({ ...capsule, async reset() {}, async down() {} }) });
    assert.equal(result.rows[0].est_cost_usd, 0.03);
    assert.equal(result.rows[0].input_tokens, 100);
    assert.equal(result.rows[0].generation_ids, '["gen-paid"]');
    assert.match(result.rows[0].failure_category, /no live WebMCP tools/);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; }
});

test("browser-context cleanup cannot drop paid rows or journaled spend", async () => {
  const { runBatch } = await import("../harness/run.mjs");
  assert.equal(recordedSpend(0.03, []), 0.03);
  let contexts = 0, spent = 0;
  const result = await runBatch({ siteId: "fake", tasks: [task], n: 2, method: { id: "fake", paid: true, async run() { return { finalText: "done", cost: 0.03 }; } },
    browser: { async newContext() { const number = ++contexts; return { async newPage() { return {}; }, async close() { if (number === 2) throw new Error("browser died"); } }; } },
    boot: async () => ({ ...capsule, async reset() {}, async down() {} }), onResult(row) { spent += row.est_cost_usd; },
  });
  assert.equal(result.rows.length, 2);
  assert.equal(spent, 0.06);
  assert.match(result.rows[1].failure_category, /harness-infra: browser context close/);
});

test("explicit refusals propagate from chat and Responses to the smoke gate", async () => {
  const original = globalThis.fetch, old = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-router";
  try {
    globalThis.fetch = async (_url, init) => json({ id: "gen-refusal", model: JSON.parse(init.body).model, provider: "DeepSeek", usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.03 }, choices: [{ finish_reason: "stop", message: { role: "assistant", content: null, refusal: "I cannot assist." } }] });
    const result = await runChat({ task, capsule, page, model: "deepseek-v4.1-flash" });
    assert.equal(result.refusal, true);
    const responseReceipt = receiptOf({ id: "gen-response-refusal", model: "openai/gpt-6-luna", provider: "OpenAI", usage: { input_tokens: 100, output_tokens: 10, cost: 0.02 }, output: [{ type: "message", content: [{ type: "refusal", refusal: "I cannot assist." }] }] }, "gpt-6-luna");
    assert.equal(routerAccounting([responseReceipt], 1).refusal, true);
  } finally { globalThis.fetch = original; if (old === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = old; }
});
