import assert from "node:assert/strict";
import test from "node:test";

import { renderExplorerHTML } from "../harness/build_explorer.mjs";

const rows = [
  { site: "directory-9d8", task_id: "d-1", arm: "wm-claude", pass: true, est_cost_usd: 0.01, wall_clock_s: 5, input_tokens: 100, output_tokens: 10 },
  { site: "directory-9d8", task_id: "d-1", arm: "cu-claude", pass: false, est_cost_usd: 0.3, wall_clock_s: 50, input_tokens: 9000, output_tokens: 90 },
];
const tasksBySite = { "directory-9d8": [{ id: "d-1", tier: "answer", prompt: "How many?" }] };
const html = renderExplorerHTML({ rows, tasksBySite, runCount: 1, meta: { date: "2026-07-25", label: "t", preset: "lite", sites: "lite", n: 1 } });

test("explorer renders the tasks and table views as separate tabs", () => {
  // Both panels exist, and the tasks panel is the one selected by default.
  assert.match(html, /<input class="tabr" type="radio" name="view" id="v-tasks" checked>/);
  assert.match(html, /<section class="panel p-tasks">/);
  assert.match(html, /<section class="panel p-table">/);
  assert.ok(!/id="v-table" checked/.test(html), "table tab must not be the default view");

  // The two views must not collapse into one scroll: site sections belong to
  // the tasks panel, the sortable table to the table panel.
  const tasksAt = html.indexOf('<section class="panel p-tasks">');
  const tableAt = html.indexOf('<section class="panel p-table">');
  const siteAt = html.indexOf("<h2>directory-9d8");
  const dataAt = html.indexOf("var DATA=");
  assert.ok(siteAt > tasksAt && siteAt < tableAt, "site sections must sit inside the tasks panel");
  assert.ok(dataAt > tableAt, "the data table must sit inside the table panel");

  // CSS that does the switching, and a label per tab to click.
  assert.match(html, /#v-tasks:checked~\.p-tasks,#v-table:checked~\.p-table\{display:block;\}/);
  assert.match(html, /<label for="v-tasks">/);
  assert.match(html, /<label for="v-table">/);
});

test("each summary chart sorts on its own metric, best performer first", () => {
  // Three methods whose cost and success orders deliberately disagree, so a
  // shared sort order would show up as one of the charts being unsorted.
  const mixed = [
    { site: "s", task_id: "t1", arm: "wm-claude", pass: true, est_cost_usd: 0.30, wall_clock_s: 1, input_tokens: 1, output_tokens: 0 },
    { site: "s", task_id: "t1", arm: "cu-claude", pass: true, est_cost_usd: 0.01, wall_clock_s: 1, input_tokens: 1, output_tokens: 0 },
    { site: "s", task_id: "t1", arm: "a11y-stagehand", pass: false, est_cost_usd: 0.10, wall_clock_s: 1, input_tokens: 1, output_tokens: 0 },
  ];
  const out = renderExplorerHTML({
    rows: mixed,
    tasksBySite: { s: [{ id: "t1", tier: "answer", prompt: "p" }] },
    runCount: 1,
    meta: { date: "2026-07-25", label: "t", preset: "lite", sites: "lite", n: 1 },
  });

  // Pull each chart's bar values in render order. Cost/tokens/time lead with the
  // lowest (best); success rate leads with the highest, because there big is good.
  for (const [caption, parse, bigIsBetter] of [
    ["Median cost / task", (s) => Number(s.replace(/[$,]/g, "")), false],
    ["Median tokens processed / task", (s) => Number(s.replace(/,/g, "")), false],
    ["Median agent time / task", (s) => Number(s.replace("s", "")), false],
    ["Success rate", (s) => Number(s.replace("%", "")), true],
  ]) {
    const chart = out.split(`<figcaption>${caption}</figcaption>`)[1].split("</figure>")[0];
    const vals = [...chart.matchAll(/<span class="bar-val">([^<]+)<\/span>/g)].map((m) => parse(m[1]));
    assert.ok(vals.length >= 3, `${caption}: expected at least 3 bars, got ${vals.length}`);
    const want = [...vals].sort((a, b) => (bigIsBetter ? b - a : a - b));
    assert.deepEqual(vals, want, `${caption} should lead with the best performer, got: ${vals}`);
  }

  // And the two charts must genuinely differ in order, or the sort is shared.
  const order = (caption) => {
    const chart = out.split(`<figcaption>${caption}</figcaption>`)[1].split("</figure>")[0];
    return [...chart.matchAll(/<span class="bar-label">([^<]+)<\/span>/g)].map((m) => m[1]);
  };
  assert.notDeepEqual(order("Median cost / task"), order("Success rate"),
    "charts share one order — each should sort on its own metric");
});

test("explorer table embeds one row per site/task/method with medians", () => {
  const data = JSON.parse(html.match(/var DATA=(\[[\s\S]*?\]);/)[1]);
  assert.equal(data.length, 2);
  const wm = data.find((r) => r.method === "wm-claude");
  assert.deepEqual(
    { site: wm.site, task: wm.task, tier: wm.tier, iface: wm.iface, p: wm.p, n: wm.n, pct: wm.pct },
    { site: "directory-9d8", task: "d-1", tier: "answer", iface: "WebMCP", p: 1, n: 1, pct: 100 },
  );
  assert.equal(data.find((r) => r.method === "cu-claude").iface, "Screenshots");
});
