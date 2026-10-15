import assert from "node:assert/strict";
import test from "node:test";
import { planRuns, parseArgs } from "../harness/cli.mjs";
import { costFor, classifyFailure } from "../harness/lib.mjs";
import { respond as geminiRespond } from "../arms/cu-gemini.mjs";
import { respond as metaRespond, run as computerRun } from "../arms/cu-openai.mjs";
import { run as geminiRun } from "../arms/cu-gemini.mjs";
import { run as webmcpRun } from "../arms/wm-gpt.mjs";
import { readCheckpoint, appendCheckpoint } from "../scripts/native-flight.mjs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("new models require their own credential and never select OpenAI or Anthropic", () => {
  const options = parseArgs(["--sites", "directory-9d8", "--arms", "wm-meta,cu-meta"]);
  const missing = planRuns(options, { OPENAI_API_KEY: "unused", ANTHROPIC_API_KEY: "unused" });
  assert.equal(missing.runs.length, 0);
  assert.ok(missing.notices.every(n => n.includes("MODEL_API_KEY")));
  assert.equal(planRuns({ ...options, arms: ["wm-meta"], transport: "openrouter" }, { OPENROUTER_API_KEY: "router" }).runs.length, 1);
  assert.throws(() => planRuns({ ...options, arms: ["cu-meta"], transport: "openrouter" }, { OPENROUTER_API_KEY: "router" }), /requires direct/);
  assert.throws(() => planRuns({ ...options, arms: ["cu-openai"], transport: "openrouter" }, { OPENROUTER_API_KEY: "router" }), /requires direct/);
  assert.equal(classifyFailure("Meta 401: invalid key"), "infra");
  assert.equal(costFor("gemini-4-argon", { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 1000 }), 0.0031);
  assert.equal(costFor("muse-wonder-1.0", { input_tokens: 1000, output_tokens: 100, cached_input_tokens: 1000 }), 0.0062);
});

test("unsupported Muse computer requests stop before OpenRouter inference", async t => {
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return Response.json({}); });
  await assert.rejects(metaRespond({ model: "muse-wonder-1.0", tools: [{ type: "computer" }] }, "openrouter", []), /direct Meta/);
  assert.equal(requests, 0);
});

test("Argon reserves spend before inference and refuses uncertain accounting", async t => {
  const budget = await import("../harness/native-request.mjs");
  budget.setRequestBudget(2);
  process.env.GEMINI_API_KEY = "test-google";
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    requests++;
    const body = JSON.parse(init.body);
    assert.equal(body.generation_config.max_output_tokens, 32768);
    assert.equal(body.generation_config.thinking_level, "medium");
    assert.equal(new URL(url).hostname, "generativelanguage.googleapis.com");
    return Response.json({ model: "gemini-4-argon", status: "completed", steps: [], usage: { total_input_tokens: 100, total_output_tokens: 20, total_thought_tokens: 10 } });
  });
  await geminiRespond({ model: "gemini-4-argon", input: "hello" });
  assert.ok(Math.abs(budget.requestSpend() - 0.0005) < 1e-9);
  budget.setRequestBudget(0.0001);
  await assert.rejects(geminiRespond({ model: "gemini-4-argon", input: "hello" }), /budget/);
  assert.equal(requests, 1, "over-budget calls never reach the provider");
  budget.setRequestBudget(2);
  t.mock.method(globalThis, "fetch", async () => Response.json({ model: "gemini-4-argon", steps: [] }));
  await assert.rejects(geminiRespond({ model: "gemini-4-argon", input: "hello" }), /accounting/);
  await assert.rejects(geminiRespond({ model: "gemini-4-argon", input: "hello" }), /accounting|blocked/);
});

test("Muse computer replay keeps real screenshots and provider receipts", async t => {
  const budget = await import("../harness/native-request.mjs");
  budget.setRequestBudget(2);
  process.env.MODEL_API_KEY = "test-meta";
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(new URL(url).hostname, "api.meta.ai");
    assert.equal(init.headers.authorization, "Bearer test-meta");
    const body = JSON.parse(init.body); bodies.push(body);
    const n = bodies.length;
    return Response.json({ model: "muse-wonder-1.0", status: "completed", reasoning: { effort: "medium" }, usage: { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 15 } }, output: n <= 4 ? [{ type: "reasoning", id: `r${n}`, encrypted_content: "opaque", summary: [] }, { type: "computer_call", call_id: `call${n}`, actions: [{ type: "screenshot" }], meta_safety_replay_receipt: "receipt", pending_safety_checks: [] }] : [{ type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Final answer: OK" }] }] });
  });
  const page = { setViewportSize: async () => {}, goto: async () => {}, waitForLoadState: async () => {}, waitForTimeout: async () => {}, screenshot: async () => Buffer.from("real-screenshot"), url: () => "http://localhost/" };
  const result = await computerRun({ model: "muse-wonder-1.0", task: { prompt: "Read the page", max_steps: 8 }, capsule: { baseUrl: "http://localhost/" }, page });
  assert.equal(result.finalText, "Final answer: OK");
  assert.equal(result.usage.output_tokens, 100, "reasoning is already included in output tokens");
  assert.ok(bodies[0].input[0].content.some(c => c.type === "input_image"));
  assert.ok(bodies.every(b => b.store === false && b.include.includes("reasoning.encrypted_content")));
  assert.ok(bodies[4].input.filter(i => i.type === "computer_call").every(i => i.meta_safety_replay_receipt === "receipt"));
  assert.ok(bodies[4].input.filter(i => i.type === "computer_call_output").every(i => i.output.image_url.endsWith(Buffer.from("real-screenshot").toString("base64"))));
});

test("Muse stops before a safety-flagged action", async t => {
  const budget = await import("../harness/native-request.mjs"); budget.setRequestBudget(2);
  process.env.MODEL_API_KEY = "test-meta";
  t.mock.method(globalThis, "fetch", async () => Response.json({ model: "muse-wonder-1.0", status: "completed", usage: { input_tokens: 100, output_tokens: 20 }, output: [{ type: "computer_call", call_id: "call", pending_safety_checks: [{ id: "check", code: "malicious_instructions" }], actions: [{ type: "click", x: 1, y: 1 }] }] }));
  let clicks = 0;
  const page = { setViewportSize: async () => {}, goto: async () => {}, waitForLoadState: async () => {}, waitForTimeout: async () => {}, screenshot: async () => Buffer.from("shot"), mouse: { click: async () => clicks++ }, url: () => "http://localhost/" };
  const result = await computerRun({ model: "muse-wonder-1.0", task: { prompt: "Read page" }, capsule: { baseUrl: "http://localhost/" }, page });
  assert.equal(clicks, 0);
  assert.equal(result.refusal, true);
});

test("truncated Muse responses cannot execute tools or computer actions", async t => {
  const budget = await import("../harness/native-request.mjs");
  process.env.MODEL_API_KEY = "test-meta";
  let actions = 0;
  const page = { setViewportSize: async () => {}, goto: async () => {}, waitForLoadState: async () => {}, waitForTimeout: async () => {}, waitForFunction: async () => {}, context: () => ({ addInitScript: async () => {} }), screenshot: async () => Buffer.from("shot"), mouse: { click: async () => actions++ }, url: () => "http://localhost/", evaluate: async (_fn, input) => input ? (actions++, {}) : [{ name: "noop", inputSchema: { type: "object", properties: {} } }] };
  for (const [run, output] of [[computerRun, [{ type: "computer_call", call_id: "c", actions: [{ type: "click", x: 1, y: 1 }] }]], [webmcpRun, [{ type: "function_call", call_id: "f", name: "noop", arguments: "{}" }]]]) {
    budget.setRequestBudget(2);
    t.mock.method(globalThis, "fetch", async () => Response.json({ model: "muse-wonder-1.0", status: "incomplete", usage: { input_tokens: 100, output_tokens: 20 }, output }));
    const result = await run({ model: "muse-wonder-1.0", task: { prompt: "Read page" }, capsule: { baseUrl: "http://localhost/" }, page });
    assert.equal(result.truncated, true);
    assert.equal(actions, 0);
  }
});

test("Argon does not auto-approve confirmation-required computer actions", async t => {
  const budget = await import("../harness/native-request.mjs"); budget.setRequestBudget(2);
  process.env.GEMINI_API_KEY = "test-google";
  t.mock.method(globalThis, "fetch", async () => Response.json({ model: "gemini-4-argon", status: "completed", usage: { total_input_tokens: 100, total_output_tokens: 20 }, steps: [{ type: "function_call", id: "c", name: "click", arguments: { x: 1, y: 1, safety_decision: { decision: "require_confirmation" } } }] }));
  let actions = 0;
  const page = { setViewportSize: async () => {}, goto: async () => {}, waitForLoadState: async () => {}, waitForTimeout: async () => {}, screenshot: async () => Buffer.from("shot"), mouse: { click: async () => actions++ }, url: () => "http://localhost/" };
  const result = await geminiRun({ model: "gemini-4-argon", task: { prompt: "Read page" }, capsule: { baseUrl: "http://localhost/" }, page });
  assert.equal(result.refusal, true);
  assert.equal(actions, 0);
});

test("new campaigns block resume when an interrupted request has no receipt", () => {
  const file = join(mkdtempSync(join(tmpdir(), "wt-smoke-billing-")), "checkpoint.jsonl");
  appendCheckpoint(file, "fingerprint", { event: "start", cell: { task_id: "t" } });
  assert.throws(() => readCheckpoint(file, "fingerprint", { strictBilling: true }), /reconcile billing/);
  appendCheckpoint(file, "fingerprint", { event: "start", cell: { task_id: "t" } });
  appendCheckpoint(file, "fingerprint", { event: "attempt", row: { task_id: "t", est_cost_usd: 0.01 } });
  assert.throws(() => readCheckpoint(file, "fingerprint", { strictBilling: true }), /reconcile billing/);
});

test("Muse WebMCP uses only parameters its OpenRouter endpoint accepts", async t => {
  const budget = await import("../harness/native-request.mjs"); budget.setRequestBudget(2);
  process.env.OPENROUTER_API_KEY = "test-router";
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    const body = JSON.parse(init.body);
    if ("parallel_tool_calls" in body) return Response.json({ error: { message: "No endpoints found that can handle requested parameters" } }, { status: 404 });
    assert.equal(body.provider.require_parameters, true);
    assert.deepEqual(body.provider.only, ["meta"]);
    return Response.json({ id: "gen-meta", model: "meta/muse-wonder", provider: "Meta", status: "completed", usage: { input_tokens: 100, output_tokens: 20, cost: 0.0008 }, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Final answer: OK" }] }] });
  });
  const page = { goto: async () => {}, waitForTimeout: async () => {}, waitForFunction: async () => {}, context: () => ({ addInitScript: async () => {} }), evaluate: async (_fn, input) => input ? {} : [{ name: "noop", inputSchema: { type: "object", properties: {} } }] };
  const result = await webmcpRun({ model: "muse-wonder-1.0", transport: "openrouter", task: { prompt: "Read page" }, capsule: { baseUrl: "http://localhost/" }, page });
  assert.equal(result.finalText, "Final answer: OK");
  assert.equal(result.cost_estimated, false);
});

test("Meta navigation clicks are recorded and screenshot replay uses the native format", async t => {
  const budget = await import("../harness/native-request.mjs");
  process.env.MODEL_API_KEY = "test-meta";
  for (const button of ["back", "forward"]) {
    budget.setRequestBudget(2);
    let requests = 0, navigations = 0, clicks = 0, url = "http://localhost/one";
    t.mock.method(globalThis, "fetch", async (_url, init) => {
      const body = JSON.parse(init.body); requests++;
      if (requests === 2) {
        const shot = body.input.find(i => i.type === "computer_call_output").output;
        assert.deepEqual(Object.keys(shot).sort(), ["image_url", "type"]);
      }
      return Response.json({ model: "muse-wonder-1.0", status: "completed", usage: { input_tokens: 100, output_tokens: 20 }, output: requests === 1 ? [{ type: "computer_call", call_id: "c", pending_safety_checks: [], meta_safety_replay_receipt: "receipt", actions: [{ type: "click", button, x: 0, y: 0 }, { type: "click", x: 1, y: 1 }] }] : [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Final answer: OK" }] }] });
    });
    const navigate = async () => { navigations++; url = "http://localhost/two"; };
    const page = { setViewportSize: async () => {}, goto: async () => {}, goBack: navigate, goForward: navigate, waitForLoadState: async () => {}, waitForTimeout: async () => {}, screenshot: async () => Buffer.from("shot"), mouse: { click: async () => clicks++ }, url: () => url };
    const result = await computerRun({ model: "muse-wonder-1.0", task: { prompt: "Go back" }, capsule: { baseUrl: "http://localhost/" }, page });
    assert.equal(result.finalText, "Final answer: OK");
    assert.equal(navigations, 1);
    assert.equal(clicks, 0, "batch stops after navigation");
    assert.ok(result.transcript.some(entry => entry.action?.button === button));
  }
});
