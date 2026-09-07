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

test("explorer: a recorded agent_s of 0 is a real value, not a missing one", () => {
  // Two instant attempts (agent_s 0, long wall clock) + one 10 s attempt: the
  // median agent time is 0 s. Treating 0 as "missing" swapped in the 500 s wall
  // clock and reported 500 s.
  const rs = [{ ...row("gpt-6-astra", true, 1), agent_s: 0, wall_clock_s: 500 }, { ...row("gpt-6-astra", true, 1), agent_s: 0, wall_clock_s: 500 }, row("gpt-6-astra", true, 1)];
  const html = renderExplorerHTML({ rows: rs, tasksBySite });
  assert.match(html, /<span class="bar-val">0s<\/span>/);
  assert.doesNotMatch(html, /<span class="bar-val">500s<\/span>/);
  // Legacy rows without the agent_s field still fall back to wall clock.
  const legacy = [{ ...row("gpt-6-astra", true, 1), agent_s: undefined, wall_clock_s: 42 }];
  assert.match(renderExplorerHTML({ rows: legacy, tasksBySite }), /<span class="bar-val">42s<\/span>/);
});

test("explorer: interface summary includes every arm present and pools attempt rates", () => {
  const mk = (arm, model, pass) => ({ ...row(model, pass, 1), arm });
  const rs = [
    mk("wm-gpt", "gpt-5.6-luna", false), mk("wm-gpt", "gpt-5.6-luna", false), mk("wm-gpt", "gpt-5.6-luna", false),
    mk("wm-claude", "claude-opus-5", true), mk("wm-claude", "claude-opus-5", true), mk("wm-claude", "claude-opus-5", true),
    mk("wm-gemini", "gemini-3.6-flash", true), mk("wm-gemini", "gemini-3.6-flash", true), mk("wm-gemini", "gemini-3.6-flash", true),
    mk("cu-gemini", "gemini-3.6-flash", true), mk("wm-stagehand-v4", "claude-sonnet-5", true),
  ];
  const html = renderExplorerHTML({ rows: rs, tasksBySite, canonical: true });
  const table = html.slice(html.indexOf('<table class="imp">'), html.indexOf("</table>", html.indexOf('<table class="imp">')));
  for (const arm of ["wm-gemini", "cu-gemini", "wm-stagehand-v4"]) assert.ok(table.includes(arm), `${arm} missing from the interface summary`);
  // pooled 7/10 = 70% across the four WebMCP configs, whereas a median of
  // per-config rates (0, 100, 100, 100) would say 100%
  assert.match(html, /WebMCP passed <b>70%<\/b> of attempts/);
  assert.match(html, /Canonical leaderboard — consolidated per cell/);
  assert.doesNotMatch(renderExplorerHTML({ rows: rs, tasksBySite }), /Canonical leaderboard/);
});
