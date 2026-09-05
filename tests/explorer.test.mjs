import assert from "node:assert/strict";
import test from "node:test";
import { renderExplorerHTML } from "../harness/build_explorer.mjs";

// Same arm, two models: the explorer must show two configurations, not one
// pooled row (the canonical explorer used to merge Luna and SOL this way).
const row = (model, pass, cost) => ({
  site: "blog", task_id: "b-1", arm: "cu-openai", model, pass, est_cost_usd: cost,
  agent_s: 10, wall_clock_s: 12, input_tokens: 100, cached_tokens: 50, cache_write_tokens: 25, output_tokens: 10,
});
const rows = [
  row("gpt-5.6-sol", true, 1), row("gpt-5.6-sol", true, 1), row("gpt-5.6-sol", true, 1),
  row("gpt-6-astra", true, 2), row("gpt-6-astra", false, 2), row("gpt-6-astra", false, 2),
];
const tasksBySite = { blog: [{ id: "b-1", tier: "answer", prompt: "read" }] };

test("explorer keys every aggregate by arm × model", () => {
  const html = renderExplorerHTML({ rows, tasksBySite });
  assert.match(html, /Computer use · GPT · SOL/);
  assert.match(html, /Computer use · GPT · Astra/);
  // summary bars: separate success rates (100% vs 33%)
  assert.match(html, /100% \(3\/3\)/);
  assert.match(html, /33% \(1\/3\)/);
  // flat table: two entries for the one site/task
  const data = JSON.parse(html.match(/var DATA=(\[.*?\]);/s)[1]);
  assert.equal(data.length, 2);
  assert.deepEqual(data.map((d) => d.model).sort(), ["gpt-5.6-sol", "gpt-6-astra"]);
  // tokens processed include cache writes: 100 + 50 + 25 + 10
  assert.ok(data.every((d) => d.tok === 185));
});

test("explorer files code-openai under its own class, not page structure", () => {
  const html = renderExplorerHTML({ rows: [{ ...row("gpt-6-astra", true, 1), arm: "code-openai" }], tasksBySite });
  assert.match(html, /Code execution · GPT · Astra/);
  assert.match(html, /class="code"/);
  assert.match(html, /Code execution \(Playwright\)/);
  assert.doesNotMatch(html, /comparing three ways/);
});
