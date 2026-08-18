import assert from "node:assert/strict";
import test from "node:test";

import { anthropicTools, invokeTool, waitForTools } from "../arms/wm-stagehand-v4.mjs";

test("Stagehand v4 tools keep schemas and return native WebMCP results", async () => {
  const tool = {
    name: "search",
    description: "Search",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    invoke: async ({ input }) => ({ result: async () => ({ status: "Completed", output: { query: input.query, found: 1 } }) }),
  };

  assert.deepEqual(anthropicTools([tool])[0].input_schema, tool.inputSchema);
  assert.deepEqual(await invokeTool(tool, { query: "stagehand" }), { query: "stagehand", found: 1 });
});

test("Stagehand v4 waits for asynchronously registered page tools", async () => {
  let calls = 0;
  const page = {
    tools: async () => ++calls === 3 ? [{ name: "ready" }] : [],
    waitForTimeout: async () => {},
  };
  assert.deepEqual(await waitForTools(page, 1000), [{ name: "ready" }]);
  assert.equal(calls, 3);
});
