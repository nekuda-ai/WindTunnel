import assert from "node:assert/strict";
import test from "node:test";

import { run } from "../arms/scripted.mjs";

test("scripted arm executes an injected recipe against an injected page", async () => {
  const calls = [];
  const page = {
    async goto(url) { calls.push(url); },
    async title() { return "Example title"; },
  };
  const result = await run({
    task: { id: "test", recipe: [{ action: "goto", path: "/about" }, { action: "title" }] },
    capsule: { baseUrl: "http://example.test" },
    page,
  });
  assert.deepEqual(calls, ["http://example.test/about"]);
  assert.equal(result.finalText, "Example title");
  assert.equal(result.transcript.length, 2);
});

test("scripted arm skips tasks without a recipe", async () => {
  const result = await run({ task: { id: "unknown" }, capsule: {}, page: {} });
  assert.match(result.finalText, /skipped/i);
});
