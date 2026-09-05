import assert from "node:assert/strict";
import test from "node:test";
import { run } from "../arms/code-openai.mjs";

// Scripted fake Responses API: turn 1 asks to run code, turn 2 answers.
function fakeOpenAI(code) {
  const bodies = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, { body }) => {
    bodies.push(JSON.parse(body));
    const first = bodies.length === 1;
    return new Response(JSON.stringify({
      model: "gpt-6-astra", status: "completed", reasoning: { effort: "medium" },
      output: first
        ? [{ type: "function_call", call_id: "c1", name: "exec_js", arguments: JSON.stringify({ code }) }]
        : [{ type: "message", content: [{ type: "output_text", text: "Final answer: ok" }] }],
      usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 5 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { bodies, restore: () => { globalThis.fetch = original; } };
}
const page = {
  async setViewportSize() {}, async goto() {}, async waitForLoadState() {}, async waitForTimeout() {},
  async title() { return "Hello Capsule"; }, async screenshot() { return Buffer.from("png"); },
  context() { return { browser() { return {}; } }; },
};
const task = { id: "t", prompt: "do the thing", tier: "answer" };
const capsule = { baseUrl: "http://fake", meta: {} };
const outputOf = (api) => api.bodies[1].input.find((i) => i.type === "function_call_output");

test("code-openai: runs the model's code with page in scope and returns stdout", async () => {
  const api = fakeOpenAI("console.log(await page.title())");
  try {
    const result = await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.equal(api.bodies.length, 2);
    assert.equal(api.bodies[0].tools[0].name, "exec_js");
    assert.ok(!("temperature" in api.bodies[0]));
    const out = outputOf(api);
    assert.equal(out.call_id, "c1");
    assert.match(JSON.stringify(out.output), /Hello Capsule/);
    assert.equal(result.finalText, "Final answer: ok");
    assert.equal(result.turns, 2);
    assert.equal(result.effort, "medium");
  } finally { api.restore(); }
});

test("code-openai: display() attaches a screenshot", async () => {
  const api = fakeOpenAI("display((await page.screenshot()).toString('base64'))");
  try {
    await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.ok(outputOf(api).output.some((part) => part.type === "input_image" && part.image_url.startsWith("data:image/png;base64,")));
  } finally { api.restore(); }
});

test("code-openai: a hanging snippet times out and ENDS the attempt (the snippet may still be running)", async () => {
  process.env.WT_CODE_EXEC_MS = "50";
  const api = fakeOpenAI("await new Promise(() => {})");
  try {
    const result = await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.equal(api.bodies.length, 1, "no second model turn after a timed-out snippet");
    assert.match(result.failure, /exec_js timeout/);
  } finally { api.restore(); delete process.env.WT_CODE_EXEC_MS; }
});

test("code-openai: a synchronous infinite loop is killed by the vm timeout and ends the attempt", async () => {
  process.env.WT_CODE_EXEC_MS = "50";
  const api = fakeOpenAI("while (true) {}");
  try {
    const result = await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.equal(api.bodies.length, 1);
    assert.match(result.failure, /exec_js timeout/);
  } finally { api.restore(); delete process.env.WT_CODE_EXEC_MS; }
});

test("code-openai: model code cannot see process, fetch or require", async () => {
  const api = fakeOpenAI("console.log(typeof process, typeof fetch, typeof require)");
  try {
    await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.match(outputOf(api).output[0].text, /undefined undefined undefined/);
  } finally { api.restore(); }
});

test("code-openai: a throwing snippet returns the error text, not a crash", async () => {
  const api = fakeOpenAI("throw new Error('boom')");
  try {
    await run({ task, capsule, page, model: "gpt-6-astra" });
    assert.match(JSON.stringify(outputOf(api).output), /boom/);
  } finally { api.restore(); }
});
