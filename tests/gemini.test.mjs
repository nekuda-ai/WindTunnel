import assert from "node:assert/strict";
import test from "node:test";

import { denormalize, executeAction, geminiUsage, windowedHistory } from "../arms/cu-gemini.mjs";
import { geminiTools } from "../arms/wm-gemini.mjs";

test("Gemini coordinates, usage, screenshots, and WebMCP schemas match the REST contract", async () => {
  assert.equal(denormalize(468, 1280), 599);
  assert.deepEqual(geminiUsage({
    total_input_tokens: 100,
    total_cached_tokens: 20,
    total_output_tokens: 10,
    total_thought_tokens: 5,
    total_tool_use_tokens: 2,
  }), { input_tokens: 82, output_tokens: 15, cached_input_tokens: 20, cache_creation_tokens: 0 });

  const history = Array.from({ length: 5 }, (_, index) => ({
    type: "function_result",
    result: [{ type: "image", data: String(index), mime_type: "image/png" }],
  }));
  const windowed = windowedHistory(history);
  assert.equal(windowed.flatMap(({ result }) => result).filter(({ type }) => type === "image").length, 3);
  assert.equal(history[0].result[0].type, "image", "history is not mutated");

  const clicks = [];
  const page = {
    mouse: { click: async (...args) => clicks.push(args) },
    waitForLoadState: async () => {},
    waitForTimeout: async () => {},
  };
  await executeAction(page, "click", { x: 500, y: 500 });
  assert.deepEqual(clicks[0], [640, 400]);

  assert.deepEqual(geminiTools([{ name: "find", inputSchema: { oneOf: [{ type: "string" }] } }]), [{
    type: "function", name: "find", description: "", parameters: { type: "object", properties: {} },
  }]);
});
