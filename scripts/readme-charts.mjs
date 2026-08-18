#!/usr/bin/env node
// Renders the reference and paired-model charts (infrastructure rows excluded)
// as self-contained SVGs. Same semantics as the explorer: median over valid
// attempts, tokens = total processed (uncached + cached + output).
// Usage: node scripts/readme-charts.mjs [resultsDir]  (default: newest *-reference)
import fs from "node:fs";
import path from "node:path";
import { isInfraRow } from "../harness/lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RES = path.join(ROOT, "results");
const dir = process.argv[2] ?? fs.readdirSync(RES).filter((d) => d.endsWith("-reference")).sort().at(-1);
const loadRows = (runDir) => JSON.parse(fs.readFileSync(path.join(RES, runDir, "run.json"), "utf8")).rows.filter((r) => !isInfraRow(r));
const rows = loadRows(dir);

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const isWm = (a) => a.webmcp ?? a.m.startsWith("wm");
const methods = [...new Set(rows.map((r) => r.arm))];
const aggregate = (rs, m, webmcp = m.startsWith("wm")) => ({
  m,
  webmcp,
  success: 100 * rs.filter((r) => r.pass === true || r.pass === "true").length / rs.length,
  cost: median(rs.map((r) => +r.est_cost_usd || 0)),
  tokens: median(rs.map((r) => (+r.input_tokens || 0) + (+r.cached_tokens || 0) + (+r.output_tokens || 0))),
  agent: median(rs.map((r) => +r.agent_s || +r.wall_clock_s || 0)),
});
const referenceAgg = methods.map((m) => {
  const rs = rows.filter((r) => r.arm === m);
  return aggregate(rs, m);
});

const canonicalSolRows = (() => {
  const replacements = new Map();
  for (const row of loadRows("2026-08-17-sol-600-timeouts")) {
    const key = `${row.site}\0${row.task_id}`;
    if (!replacements.has(key)) replacements.set(key, []);
    replacements.get(key).push(row);
  }
  let replaced = 0;
  const canonical = loadRows("2026-08-17-sol-full").map((row) => {
    if (!String(row.failure_category).includes("attempt timeout: 300s agent budget")) return row;
    const replacement = replacements.get(`${row.site}\0${row.task_id}`)?.shift();
    if (!replacement) throw new Error(`missing SOL timeout replacement for ${row.site}/${row.task_id}`);
    replaced += 1;
    return replacement;
  });
  if (replaced !== 26 || [...replacements.values()].some((queued) => queued.length)) {
    throw new Error(`expected exactly 26 SOL timeout replacements, applied ${replaced}`);
  }
  return canonical;
})();

const expansionRuns = [
  ["GPT-5.5", "2026-07-27-reference", "cu-openai", "wm-gpt"],
  ["Luna", "2026-08-16-luna-full", "cu-openai", "wm-gpt"],
  ["SOL", "2026-08-17-sol-full", "cu-openai", "wm-gpt"],
  ["Gemini", "2026-08-17-gemini-full", "cu-gemini", "wm-gemini"],
  ["Opus", "2026-08-17-opus5-full", "cu-claude", "wm-claude"],
];
const expansionAgg = expansionRuns.flatMap(([model, runDir, cu, wm]) => {
  const runRows = model === "SOL" ? canonicalSolRows : loadRows(runDir);
  return [
    aggregate(runRows.filter((r) => r.arm === cu), `${model} · CU`, false),
    aggregate(runRows.filter((r) => r.arm === wm), `${model} · WebMCP`, true),
  ];
});

const consolidatedAgg = [
  ...expansionAgg.map((item) => ({ ...item, kind: item.webmcp ? "webmcp" : "cu" })),
  { ...aggregate(rows.filter((r) => r.arm === "wm-claude"), "Sonnet 4.6 · WebMCP", true), kind: "webmcp" },
  { ...aggregate(loadRows("2026-08-13-stagehand-v4-native-full"), "Sonnet 4.6 · WebMCP/Stagehand v4", true), kind: "webmcp" },
  { ...aggregate(rows.filter((r) => r.arm === "cu-claude"), "Sonnet 4.6 · CU", false), kind: "cu" },
  { ...aggregate(rows.filter((r) => r.arm === "dom-browseruse"), "Sonnet 4.6 · DOM + vision", false), kind: "structured" },
  { ...aggregate(rows.filter((r) => r.arm === "a11y-stagehand"), "Sonnet 4.6 · accessibility tree", false), kind: "structured" },
];

const normalize = (values, value, log = false) => {
  const projected = values.map((v) => log ? Math.log(v) : v);
  const current = log ? Math.log(value) : value;
  const min = Math.min(...projected), max = Math.max(...projected);
  return max === min ? 1 : (current - min) / (max - min);
};
const balancedAgg = consolidatedAgg.map((item) => ({
  ...item,
  score: 100 * (
    0.6 * normalize(consolidatedAgg.map((a) => a.success), item.success)
    + 0.2 * (1 - normalize(consolidatedAgg.map((a) => a.cost), item.cost, true))
    + 0.2 * (1 - normalize(consolidatedAgg.map((a) => a.agent), item.agent, true))
  ),
})).sort((a, b) => b.score - a.score);
if (balancedAgg.length !== 15) throw new Error(`expected 15 consolidated model/interface cells, got ${balancedAgg.length}`);

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
  light: { title: "#1f2328", label: "#1f2328", value: "#59636e", dim: "#a8b1ba", structured: "#b06a00", wm: "#0099cc", rule: "#d0d7de", credit: "#57606a" },
  dark: { title: "#f0f6fc", label: "#f0f6fc", value: "#9198a1", dim: "#6e7681", structured: "#d29922", wm: "#00bfff", rule: "#30363d", credit: "#8b949e" },
};

const PANELS = [
  ["Success rate — attempts passed", "success", (v) => v.toFixed(0) + "%", true],
  ["Median cost / task", "cost", (v) => "$" + v.toFixed(3), false],
  ["Median tokens processed / task", "tokens", (v) => Math.round(v).toLocaleString("en-US"), false],
  ["Median agent time / task", "agent", (v) => v.toFixed(1) + "s", false],
];

function quadrant([title, key, fmt, bigIsBetter], x, y, t, data, labelWidth, barMax) {
  const sorted = [...data].sort((a, b) => bigIsBetter ? b[key] - a[key] : a[key] - b[key]);
  const max = Math.max(...sorted.map((a) => a[key]));
  const LABEL = labelWidth, BARMAX = barMax, ROW = 26, TOP = 30;
  const rows = sorted.map((a, i) => {
    const ry = y + TOP + i * ROW;
    const w = Math.max(2, a[key] / max * BARMAX);
    return `<text x="${x + LABEL - 10}" y="${ry + 14}" text-anchor="end" font-weight="${isWm(a) ? 600 : 400}" fill="${t.label}">${a.m}</text>
<rect x="${x + LABEL}" y="${ry + 2}" width="${w.toFixed(1)}" height="16" rx="2" fill="${isWm(a) ? t.wm : t.dim}"/>
<text x="${(x + LABEL + w + 8).toFixed(1)}" y="${ry + 15}" fill="${t.value}" font-variant-numeric="tabular-nums">${fmt(a[key])}</text>`;
  }).join("\n");
  return `<text x="${x}" y="${y + 12}" font-size="13.5" font-weight="600" fill="${t.title}">${title}</text>
<line x1="${x}" y1="${y + 20}" x2="${x + 486}" y2="${y + 20}" stroke="${t.rule}" stroke-width="1"/>
${rows}`;
}

function panel(themeName, data, { title, subtitle, otherLabel, labelWidth = 116, quadrantWidth = 486, barMax = 264 }) {
  const t = THEMES[themeName];
  const PAD = 18, QW = quadrantWidth, GAP_X = 26, GAP_Y = 32, QH = 30 + data.length * 26 + 4;
  const HEAD = 44; // masthead band: caption left, nekuda right
  const W = PAD * 2 + QW * 2 + GAP_X;
  const H = PAD * 2 + HEAD + QH * 2 + GAP_Y + 22;
  const quads = PANELS.map((spec, i) =>
    quadrant(spec, PAD + (i % 2) * (QW + GAP_X), PAD + HEAD + Math.floor(i / 2) * (QH + GAP_Y), t, data, labelWidth, barMax)).join("\n");
  // WebMCP arms are terracotta, everything else grey — stated once, not per chart.
  const legend = `<rect x="${PAD}" y="${H - 30}" width="9" height="9" rx="2" fill="${t.wm}"/>
<text x="${PAD + 14}" y="${H - 22}" font-size="11.5" fill="${t.credit}">WebMCP</text>
<rect x="${PAD + 74}" y="${H - 30}" width="9" height="9" rx="2" fill="${t.dim}"/>
<text x="${PAD + 88}" y="${H - 22}" font-size="11.5" fill="${t.credit}">${otherLabel}</text>`;
  // Masthead: the panel gets copy-pasted into decks, where it would otherwise
  // arrive with no indication of what it measures, so it carries its own
  // caption and provenance.
  const masthead = `<text x="${PAD}" y="${PAD + 15}" font-size="14" font-weight="600" fill="${t.title}">${title}</text>
<text x="${PAD}" y="${PAD + 32}" font-size="11.5" fill="${t.credit}">${subtitle}</text>
<line x1="${PAD}" y1="${PAD + HEAD - 6}" x2="${W - PAD}" y2="${PAD + HEAD - 6}" stroke="${t.rule}" stroke-width="1"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,-apple-system,sans-serif" font-size="13">
${masthead}
${quads}
${legend}
</svg>`;
}

function leaderboard(themeName) {
  const t = THEMES[themeName];
  const W = 1040, PAD = 18, TOP = 98, ROW = 38, H = TOP + balancedAgg.length * ROW + 42;
  const BAR_X = 260, BAR_W = 270, SCORE_X = 580, PASS_X = 700, COST_X = 835, TIME_X = 1005;
  const fill = (a) => a.kind === "webmcp" ? t.wm : a.kind === "structured" ? t.structured : t.dim;
  const rows = balancedAgg.map((a, i) => {
    const y = TOP + i * ROW;
    const width = Math.max(3, a.score / 100 * BAR_W);
    return `<line x1="${PAD}" y1="${y + 29}" x2="${W - PAD}" y2="${y + 29}" stroke="${t.rule}" stroke-width="1"/>
<text x="${PAD + 12}" y="${y + 19}" text-anchor="end" fill="${t.credit}">${i + 1}</text>
<text x="${PAD + 24}" y="${y + 19}" font-weight="600" fill="${t.label}">${a.m}</text>
<rect x="${BAR_X}" y="${y + 5}" width="${BAR_W}" height="18" rx="2" fill="${t.rule}"/>
<rect x="${BAR_X}" y="${y + 5}" width="${width.toFixed(1)}" height="18" rx="2" fill="${fill(a)}"/>
<text x="${SCORE_X}" y="${y + 19}" text-anchor="end" font-weight="700" fill="${t.label}">${a.score.toFixed(1)}</text>
<text x="${PASS_X}" y="${y + 19}" text-anchor="end" fill="${t.label}">${a.success.toFixed(1)}%</text>
<text x="${COST_X}" y="${y + 19}" text-anchor="end" fill="${t.label}">$${a.cost.toFixed(3)}</text>
<text x="${TIME_X}" y="${y + 19}" text-anchor="end" fill="${t.label}">${a.agent.toFixed(1)}s</text>`;
  }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,-apple-system,sans-serif" font-size="13">
<text x="${PAD}" y="${PAD + 15}" font-size="16" font-weight="650" fill="${t.title}">WindTunnel — leaderboard</text>
<text x="${PAD}" y="${PAD + 35}" font-size="11.5" fill="${t.credit}">Attempt success 60% · median cost 20% · median agent time 20% · cost/time log-scaled</text>
<line x1="${PAD}" y1="${PAD + 46}" x2="${W - PAD}" y2="${PAD + 46}" stroke="${t.rule}" stroke-width="1"/>
<text x="${PAD + 24}" y="${TOP - 14}" font-size="11.5" font-weight="600" fill="${t.credit}">Configuration</text>
<text x="${BAR_X + BAR_W / 2}" y="${TOP - 14}" text-anchor="middle" font-size="11.5" font-weight="600" fill="${t.credit}">Final score (0–100)</text>
<text x="${PASS_X}" y="${TOP - 14}" text-anchor="end" font-size="11.5" font-weight="600" fill="${t.credit}">Pass rate</text>
<text x="${COST_X}" y="${TOP - 14}" text-anchor="end" font-size="11.5" font-weight="600" fill="${t.credit}">Median cost / task</text>
<text x="${TIME_X}" y="${TOP - 14}" text-anchor="end" font-size="11.5" font-weight="600" fill="${t.credit}">Median agent time</text>
${rows}
<rect x="${PAD}" y="${H - 25}" width="9" height="9" rx="2" fill="${t.wm}"/>
<text x="${PAD + 14}" y="${H - 17}" font-size="11.5" fill="${t.credit}">WebMCP</text>
<rect x="${PAD + 84}" y="${H - 25}" width="9" height="9" rx="2" fill="${t.dim}"/>
<text x="${PAD + 98}" y="${H - 17}" font-size="11.5" fill="${t.credit}">computer use</text>
<rect x="${PAD + 190}" y="${H - 25}" width="9" height="9" rx="2" fill="${t.structured}"/>
<text x="${PAD + 204}" y="${H - 17}" font-size="11.5" fill="${t.credit}">DOM / accessibility tree</text>
</svg>`;
}

const out = path.join(ROOT, "assets", "charts");
fs.mkdirSync(out, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  const suffix = theme === "dark" ? "-dark" : "";
  fs.writeFileSync(path.join(out, `summary${suffix}.svg`), panel(theme, referenceAgg, {
    title: "WindTunnel — WebMCP vs. browser-agent interfaces",
    subtitle: `49 tasks × 8 sites · 7 methods × 3 attempts · reference run ${dir.slice(0, 10)}`,
    otherLabel: "browser interfaces",
  }));
  fs.writeFileSync(path.join(out, `model-comparison${suffix}.svg`), panel(theme, expansionAgg, {
    title: "WindTunnel — model expansion: WebMCP vs. computer use",
    subtitle: "49 tasks × 8 sites × 3 attempts · 600s per-attempt agent cap",
    otherLabel: "computer use",
    labelWidth: 142,
    quadrantWidth: 500,
    barMax: 238,
  }));
  fs.writeFileSync(path.join(out, `balanced-leaderboard${suffix}.svg`), leaderboard(theme));
}
console.log(`wrote the reference, model-comparison, and leaderboard panels (light + dark) to assets/charts/`);
