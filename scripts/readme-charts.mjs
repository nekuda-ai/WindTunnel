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

// --- combined 2x2 panel, one file per theme -------------------------------
// Four stacked full-width charts with a hardcoded white background read as
// four glowing slabs on a dark README, and they all rank the methods the same
// way, so the repetition costs a screen of scroll for no extra information.
// One panel, transparent, per-theme colors, selected in the README with
// <picture> + prefers-color-scheme.
// WebMCP arms carry the nekuda cyan; on white the full-strength brand cyan
// glows and loses its edge, so the light theme deepens it a step. Greys are
// cool, to sit with cyan rather than fight it.
const THEMES = {
  light: { title: "#1f2328", label: "#1f2328", value: "#59636e", dim: "#a8b1ba", wm: "#0099cc", rule: "#d0d7de", credit: "#57606a" },
  dark: { title: "#f0f6fc", label: "#f0f6fc", value: "#9198a1", dim: "#6e7681", wm: "#00bfff", rule: "#30363d", credit: "#8b949e" },
};

const PANELS = [
  ["Success rate — attempts passed", "success", (v) => v.toFixed(0) + "%", true],
  ["Median cost / task", "cost", (v) => "$" + v.toFixed(3), false],
  ["Median tokens processed / task", "tokens", (v) => Math.round(v).toLocaleString("en-US"), false],
  ["Median agent time / task", "agent", (v) => v.toFixed(1) + "s", false],
];

function quadrant([title, key, fmt, bigIsBetter], x, y, t) {
  const sorted = [...agg].sort((a, b) => bigIsBetter ? b[key] - a[key] : a[key] - b[key]);
  const max = Math.max(...sorted.map((a) => a[key]));
  const LABEL = 116, BARMAX = 264, ROW = 26, TOP = 30;
  const rows = sorted.map((a, i) => {
    const ry = y + TOP + i * ROW;
    const w = Math.max(2, a[key] / max * BARMAX);
    return `<text x="${x + LABEL - 10}" y="${ry + 14}" text-anchor="end" font-weight="${isWm(a.m) ? 600 : 400}" fill="${t.label}">${a.m}</text>
<rect x="${x + LABEL}" y="${ry + 2}" width="${w.toFixed(1)}" height="16" rx="2" fill="${isWm(a.m) ? t.wm : t.dim}"/>
<text x="${(x + LABEL + w + 8).toFixed(1)}" y="${ry + 15}" fill="${t.value}" font-variant-numeric="tabular-nums">${fmt(a[key])}</text>`;
  }).join("\n");
  return `<text x="${x}" y="${y + 12}" font-size="13.5" font-weight="600" fill="${t.title}">${title}</text>
<line x1="${x}" y1="${y + 20}" x2="${x + 486}" y2="${y + 20}" stroke="${t.rule}" stroke-width="1"/>
${rows}`;
}

function panel(themeName) {
  const t = THEMES[themeName];
  const PAD = 18, QW = 486, GAP_X = 26, GAP_Y = 32, QH = 30 + agg.length * 26 + 4;
  const HEAD = 44; // masthead band: caption left, nekuda right
  const W = PAD * 2 + QW * 2 + GAP_X;
  const H = PAD * 2 + HEAD + QH * 2 + GAP_Y + 22;
  const quads = PANELS.map((spec, i) =>
    quadrant(spec, PAD + (i % 2) * (QW + GAP_X), PAD + HEAD + Math.floor(i / 2) * (QH + GAP_Y), t)).join("\n");
  // WebMCP arms are terracotta, everything else grey — stated once, not per chart.
  const legend = `<rect x="${PAD}" y="${H - 30}" width="9" height="9" rx="2" fill="${t.wm}"/>
<text x="${PAD + 14}" y="${H - 22}" font-size="11.5" fill="${t.credit}">WebMCP</text>
<rect x="${PAD + 74}" y="${H - 30}" width="9" height="9" rx="2" fill="${t.dim}"/>
<text x="${PAD + 88}" y="${H - 22}" font-size="11.5" fill="${t.credit}">browser interfaces</text>`;
  // Masthead: the panel gets copy-pasted into decks, where it would otherwise
  // arrive with no indication of what it measures, so it carries its own
  // caption and provenance.
  const masthead = `<text x="${PAD}" y="${PAD + 15}" font-size="14" font-weight="600" fill="${t.title}">WindTunnel — WebMCP vs. browser-agent interfaces</text>
<text x="${PAD}" y="${PAD + 32}" font-size="11.5" fill="${t.credit}">49 tasks × 8 sites · 7 methods × 3 attempts · reference run ${dir.slice(0, 10)}</text>
<line x1="${PAD}" y1="${PAD + HEAD - 6}" x2="${W - PAD}" y2="${PAD + HEAD - 6}" stroke="${t.rule}" stroke-width="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,-apple-system,sans-serif" font-size="13">
${masthead}
${quads}
${legend}
</svg>`;
}

const out = path.join(ROOT, "assets", "charts");
fs.mkdirSync(out, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  fs.writeFileSync(path.join(out, `summary${theme === "dark" ? "-dark" : ""}.svg`), panel(theme));
}
console.log(`wrote the summary panel (light + dark) from ${dir} to assets/charts/`);
