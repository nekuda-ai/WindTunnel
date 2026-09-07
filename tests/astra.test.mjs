import assert from "node:assert/strict";
import test from "node:test";
import { costFor, PRICES } from "../harness/lib.mjs";

test("gpt-6-astra is priced at list: $10 in, $50 out, $1 cached, $12.50 cache write", () => {
  assert.ok(PRICES.some(([prefix]) => prefix === "gpt-6-astra"), "no PRICES row for gpt-6-astra");
  const usd = costFor("gpt-6-astra", { input_tokens: 1_000_000, output_tokens: 1_000_000, cached_input_tokens: 1_000_000, cache_creation_tokens: 1_000_000 });
  assert.equal(usd, 10 + 50 + 1 + 12.5);
});
import { run as runWM } from "../arms/wm-gpt.mjs";
import { run as runCU } from "../arms/cu-openai.mjs";

// A fake Responses API: records every request body, answers once with a
// final message. Usage mimics Astra's real shape (cache_write inside input_tokens).
function fakeOpenAI(usage, extra = {}) {
  const bodies = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, { body }) => {
    bodies.push(JSON.parse(body));
    return new Response(JSON.stringify({
      model: "gpt-6-astra", status: "completed",
      reasoning: { effort: "medium" },
      output: [{ type: "message", content: [{ type: "output_text", text: "Final answer: ok" }] }],
      usage, ...extra,
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { bodies, restore: () => { globalThis.fetch = originalFetch; } };
}

const ASTRA_USAGE = {
  input_tokens: 3761, input_tokens_details: { cache_write_tokens: 3000, cached_tokens: 700 },
  output_tokens: 5, output_tokens_details: { reasoning_tokens: 0 },
};

// WebMCP arm: stub exactly what prepareWebMCPPage / listLiveTools touch
// (arms/wm-claude.mjs): context().addInitScript, goto, waitForFunction,
// evaluate (returns the live tool list), waitForTimeout. One tool the model never calls.
const wmContext = { async addInitScript() {} };
const wmPage = {
  context() { return wmContext; },
  async goto() {}, async waitForFunction() {}, async waitForTimeout() {},
  async evaluate() { return [{ name: "noop", description: "", inputSchema: { type: "object", properties: {} } }]; },
};
// CU arm: enough Playwright surface for setup + one screenshot-free turn.
const cuPage = {
  async setViewportSize() {}, async goto() {}, async waitForLoadState() {}, async waitForTimeout() {},
  async screenshot() { return Buffer.from("png"); },
};
const task = { id: "t", prompt: "do the thing", tier: "answer" };
const capsule = { baseUrl: "http://fake", meta: {} };

for (const [name, run, page] of [["wm-gpt", runWM, wmPage], ["cu-openai", runCU, cuPage]]) {
  test(`${name}: never sends temperature to an OpenAI model`, async () => {
    const api = fakeOpenAI(ASTRA_USAGE);
    try {
      const result = await run({ task, capsule, page, model: "gpt-6-astra" });
      assert.equal(api.bodies.length, 1, "one request per turn — the temperature probe used to make two");
      assert.ok(!("temperature" in api.bodies[0]));
      assert.equal(result.temperature, "default");
    } finally { api.restore(); }
  });

  test(`${name}: splits cache writes out of input and prices them`, async () => {
    const api = fakeOpenAI(ASTRA_USAGE);
    try {
      const { usage, cost } = await run({ task, capsule, page, model: "gpt-6-astra" });
      assert.equal(usage.input_tokens, 3761 - 3000 - 700);
      assert.equal(usage.cached_input_tokens, 700);
      assert.equal(usage.cache_creation_tokens, 3000);
      assert.equal(cost, (61 * 10 + 700 * 1 + 3000 * 12.5 + 5 * 50) / 1e6);
    } finally { api.restore(); }
  });

  test(`${name}: records effort and truncation for the smoke gate`, async () => {
    const api = fakeOpenAI(ASTRA_USAGE, { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } });
    try {
      const result = await run({ task, capsule, page, model: "gpt-6-astra" });
      assert.equal(result.effort, "medium");
      assert.equal(result.truncated, true);
    } finally { api.restore(); }
  });
}

// OpenAI's `keypress` action carries ONE chord ("the combination of keys"); models
// spell it many ways. Astra alone sent 16 spellings of Ctrl+A on one form.
import { keyChord } from "../arms/cu-openai.mjs";
test("cu-openai: keypress keys are one chord in Playwright syntax, whatever the spelling", () => {
  for (const keys of [["CTRL", "a"], ["CTRL", "A"], ["Control", "a"], ["CTRL+A"], ["ctrl+a"], ["Control+a"], ["Control_L", "a"], ["Ctrl", "a"]])
    assert.equal(keyChord(keys), "Control+a", JSON.stringify(keys));
  assert.equal(keyChord(["Control", "KeyA"]), "Control+KeyA", "DOM code passes through — Playwright accepts it");
  assert.equal(keyChord(["CMD", "a"]), "Meta+a");
  assert.equal(keyChord(["SHIFT", "END"]), "Shift+End");
  assert.equal(keyChord(["Shift_R", "Tab"]), "Shift+Tab");
  assert.equal(keyChord(["BackSpace"]), "Backspace");
  assert.equal(keyChord(["ESC"]), "Escape");
  assert.equal(keyChord(["KeyA"]), "KeyA");
  assert.equal(keyChord(["Digit5"]), "Digit5");
  assert.equal(keyChord(["f5"]), "F5");
  assert.equal(keyChord(["A"]), "A", "a lone capital letter types a capital");
  assert.equal(keyChord(["+"]), "+", "a literal plus is a key, not a separator");
  assert.equal(keyChord(["Control++"]), "Control++", "trailing plus is the key");
  assert.equal(keyChord([" "]), " ", "space is a key, not whitespace");
  assert.equal(keyChord(["ControlOrMeta", "a"]), "ControlOrMeta+a", "valid Playwright names pass through unchanged");
  assert.equal(keyChord(["ShiftLeft"]), "ShiftLeft");
  assert.equal(keyChord(["NumpadEnter"]), "NumpadEnter");
  assert.equal(keyChord(["pagedown"]), "PageDown");
});
