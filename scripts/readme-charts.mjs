#!/usr/bin/env node
// Renders the reference run's four summary charts (success, cost, tokens,
// agent time — per method, infrastructure rows excluded) as self-contained
// SVGs for the README. Same semantics as the explorer: median over valid
// attempts, tokens = total processed (uncached + cached + output).
// Usage: node scripts/readme-charts.mjs [resultsDir]  (default: newest *-reference)
import fs from "node:fs";
import path from "node:path";
import { isInfraRow } from "../harness/lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RES = path.join(ROOT, "results");
const dir = process.argv[2] ?? fs.readdirSync(RES).filter((d) => d.endsWith("-reference")).sort().at(-1);
const data = JSON.parse(fs.readFileSync(path.join(RES, dir, "run.json"), "utf8"));
const rows = data.rows.filter((r) => !isInfraRow(r));

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const isWm = (m) => m.startsWith("wm");
const methods = [...new Set(rows.map((r) => r.arm))];
const agg = methods.map((m) => {
  const rs = rows.filter((r) => r.arm === m);
  return {
    m,
    success: 100 * rs.filter((r) => r.pass === true || r.pass === "true").length / rs.length,
    cost: median(rs.map((r) => +r.est_cost_usd || 0)),
    tokens: median(rs.map((r) => (+r.input_tokens || 0) + (+r.cached_tokens || 0) + (+r.output_tokens || 0))),
    agent: median(rs.map((r) => +r.agent_s || +r.wall_clock_s || 0)),
  };
});

function chart(title, key, fmt, bigIsBetter) {
  const sorted = [...agg].sort((a, b) => bigIsBetter ? b[key] - a[key] : a[key] - b[key]);
  const max = Math.max(...sorted.map((a) => a[key]));
  const W = 720, ROW = 30, TOP = 34, LABEL = 150, BARMAX = 380;
  const H = TOP + sorted.length * ROW + 10;
  const bars = sorted.map((a, i) => {
    const y = TOP + i * ROW;
    const w = Math.max(2, a[key] / max * BARMAX);
    const fill = isWm(a.m) ? "#c8553d" : "#9a9a92";
    return `<text x="${LABEL - 8}" y="${y + 15}" text-anchor="end" font-weight="${isWm(a.m) ? 600 : 400}">${a.m}</text>
<rect x="${LABEL}" y="${y + 3}" width="${w.toFixed(1)}" height="17" fill="${fill}" rx="2"/>
<text x="${LABEL + w + 8}" y="${y + 16}" fill="#555">${fmt(a[key])}</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="system-ui,sans-serif" font-size="13">
<rect width="${W}" height="${H}" fill="white"/>
<text x="8" y="20" font-weight="600" font-size="14">${title}</text>
${bars}
</svg>`;
}

const out = path.join(ROOT, "assets", "charts");
fs.mkdirSync(out, { recursive: true });
const charts = [
  ["success-rate", chart("Success rate — share of attempts passed (higher is better)", "success", (v) => v.toFixed(0) + "%", true)],
  ["cost-per-task", chart("Median cost / task, USD (lower is better)", "cost", (v) => "$" + v.toFixed(3), false)],
  ["tokens-per-task", chart("Median tokens processed / task (lower is better)", "tokens", (v) => Math.round(v).toLocaleString("en-US"), false)],
  ["agent-time", chart("Median agent time / task, seconds (lower is better)", "agent", (v) => v.toFixed(1) + "s", false)],
];
for (const [name, svg] of charts) fs.writeFileSync(path.join(out, `${name}.svg`), svg);
console.log(`wrote ${charts.length} charts from ${dir} to assets/charts/`);
