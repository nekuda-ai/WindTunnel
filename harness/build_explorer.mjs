// Results explorer: renders a single self-contained HTML in the Nekuda
// collapsible-doc visual system — one card per task, grouped by site, each
// showing the per-method data.
//
// Two entry points:
//   • renderExplorerHTML({ rows, tasksBySite, runCount }) — pure render; used by
//     scoring/report.mjs to drop an explorer.html into every run's dir.
//   • run directly (`node harness/build_explorer.mjs`) — aggregates tasks/*.yaml
//     + all results/*/run.json into results/explorer.html.
import fs from "node:fs";
import path from "node:path";
import { load as yaml } from "js-yaml";
import { isInfraRow } from "./lib.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const TASK_DIR = path.join(ROOT, "tasks");
const RES_DIR = path.join(ROOT, "results");

// Nekuda logo, inlined as a data URI so the self-contained artifact needs no
// external image request (CSP-safe).
const LOGO = (() => {
  try { return `data:image/png;base64,${fs.readFileSync(path.join(ROOT, "assets", "nekuda-logo.png")).toString("base64")}`; }
  catch { return null; }
})();

// Site type/category straight from the registry (sites/sites.yaml) — never invented.
const SITE_TYPE = (() => {
  try {
    const doc = yaml(fs.readFileSync(path.join(ROOT, "sites", "sites.yaml"), "utf8"));
    return Object.fromEntries((doc.sites || []).map((s) => [s.id, (s.category || "").replace(/-/g, " ")]));
  } catch { return {}; }
})();

const METHOD_LABEL = {
  "wm-claude": "WebMCP · Claude", "wm-gpt": "WebMCP · GPT", "code-openai": "Code execution · GPT",
  "wm-stagehand": "WebMCP · Stagehand", "cu-claude": "Computer use · Claude",
  "cu-openai": "Computer use · GPT", "dom-browseruse": "Browser Use · DOM + screenshot",
  "a11y-stagehand": "Page structure · Stagehand (a11y)", "scripted": "Scripted (no-LLM)",
};
const CLASS = (a) => a.startsWith("wm") ? "webmcp" : a.startsWith("cu") ? "cu" : a.startsWith("code") ? "code" : a === "scripted" ? "scripted" : "struct";
const MODEL_LABEL = {
  "claude-sonnet-5": "Sonnet 5", "claude-opus-5": "Opus 5", "claude-sonnet-4-6": "Sonnet 4.6",
  "gpt-5.6-luna": "Luna", "gpt-5.6-sol": "SOL", "gpt-6-astra": "Astra", "gpt-5.5": "GPT-5.5", "gemini-3.6-flash": "Gemini 3.6",
};
// Every aggregate is one CONFIGURATION (arm × model), never an arm: the same
// arm runs several models (cu-openai: Luna, SOL, Astra) and pooling them hid
// that. Styling (CLASS/IFACE) stays keyed on the arm.
const cfgKey = (r) => `${r.arm}\u0000${r.model ?? ""}`;
const cfgLabel = (arm, model) => `${METHOD_LABEL[arm] ?? arm}${model ? ` · ${MODEL_LABEL[model] ?? model}` : ""}`;
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const passed = (r) => r.pass === true || r.pass === "true" || r.success === true || r.success === "true";
// Total tokens PROCESSED — uncached input + cache reads + cache writes + output. Cache
// reads are real model context (the discount is a billing fact, captured in
// est_cost_usd); charting only full-price tokens would make cached arms look
// 10x lighter than they are. The cached/uncached split stays available in
// results.csv for appendix-level analysis. Old rows without cached_tokens
// are unaffected.
const tok = (r) => (+r.input_tokens || 0) + (+r.cached_tokens || 0) + (+r.cache_write_tokens || 0) + (+r.output_tokens || 0);
// Agent time when the row carries the split (post-2026-07-27 runs); wall clock
// as fallback for old rows. Wall clock includes identical per-attempt harness
// overhead (DB reset + page boot) that swamps short attempts — see the audit.
// Fall back only when agent_s is ABSENT — a recorded 0 is a real (instant)
// attempt, not a missing value; treating it as missing swapped in wall-clock
// time for five canonical rows.
const secs = (r) => (r.agent_s == null || r.agent_s === "") ? (+r.wall_clock_s || 0) : +r.agent_s;
const money = (v) => v == null ? "—" : "$" + v.toFixed(3);
const num = (v) => v == null ? "—" : Math.round(v).toLocaleString();

export function loadTasksBySite() {
  const bySite = {};
  for (const f of fs.existsSync(TASK_DIR) ? fs.readdirSync(TASK_DIR) : []) {
    if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
    // Calibration files are a separate cost-measurement task set, not benchmark
    // tasks — excluded so their definitions don't show as "not run yet" cards.
    if (f.startsWith("calibration-")) continue;
    let doc; try { doc = yaml(fs.readFileSync(path.join(TASK_DIR, f), "utf8")); } catch { continue; }
    const list = Array.isArray(doc) ? doc : doc?.tasks ?? [doc];
    for (const t of list) { if (!t?.id) continue; (bySite[t.site ?? path.basename(f, path.extname(f))] ??= []).push(t); }
  }
  return bySite;
}

export function renderExplorerHTML({ rows: allRows, tasksBySite = {}, runCount = 1, meta = null }) {
  // Drop infrastructure failures — 429s, boot/registration timeouts, browser
  // crashes (failure_category prefixed "harness:") — from every aggregate, so a
  // method that errored out (e.g. rate-limited cu-openai) can't skew the medians,
  // ranking, or success rate. Legitimate predicate failures (agent ran, got it
  // wrong) are kept. The count of dropped runs is surfaced in the summary.
  const isInfraError = isInfraRow;
  const droppedCount = allRows.filter(isInfraError).length;
  const rows = allRows.filter((r) => !isInfraError(r));
  const rowsFor = (site, taskId) => rows.filter((r) => r.site === site && r.task_id === taskId);
  const allConfigs = [...new Set(rows.map(cfgKey))];

  const methodAgg = allConfigs.map((key) => {
    const rs = rows.filter((r) => cfgKey(r) === key);
    const { arm, model } = rs[0];
    return { key, arm, model, m: cfgLabel(arm, model), n: rs.length, pass: rs.filter(passed).length,
      cost: median(rs.map((r) => +r.est_cost_usd || 0)), ms: median(rs.map(secs)), tk: median(rs.map(tok)) };
  }).sort((a, b) => (b.pass / (b.n || 1)) - (a.pass / (a.n || 1)) || (a.cost - b.cost));

  function taskCard(site, t) {
    const rs = rowsFor(site, t.id);
    const byMethod = {};
    for (const r of rs) (byMethod[cfgKey(r)] ??= []).push(r);
    const methodRows = Object.values(byMethod).map((mr) => ({ arm: mr[0].arm, m: cfgLabel(mr[0].arm, mr[0].model), p: mr.filter(passed).length, n: mr.length,
      cost: median(mr.map((r) => +r.est_cost_usd || 0)), ms: median(mr.map(secs)), tk: median(mr.map(tok)) }))
      .sort((a, b) => (b.p / b.n - a.p / a.n) || (a.cost - b.cost));
    const solved = rs.length ? `${rs.filter(passed).length}/${rs.length} runs pass` : "not run yet";
    const pred = t.predicate ? `<div class="pred"><span class="k">check</span> ${esc(JSON.stringify(t.predicate))}</div>` : "";
    const table = methodRows.length ? `<table class="t"><thead><tr><th>method</th><th>result</th><th>time</th><th>tokens</th><th>cost</th></tr></thead><tbody>${
      methodRows.map((x) => `<tr class="${CLASS(x.arm)}"><td>${esc(x.m)}</td><td>${x.p === x.n ? "✓" : x.p === 0 ? "✕" : "◑"} <span class="muted">${x.p}/${x.n}</span></td><td>${x.ms == null ? "—" : x.ms.toFixed(1) + "s"}</td><td>${num(x.tk)}</td><td>${money(x.cost)}</td></tr>`).join("")
    }</tbody></table>` : `<p class="muted">No runs recorded for this task yet.</p>`;
    return `<details><summary><span class="stitle">${esc(t.id)}</span><span class="smeta">${esc(t.tier ?? "")} · ${esc(solved)}</span><span class="chev">›</span></summary>
      <div class="body"><div class="prompt"><span class="k">prompt</span>${esc(t.prompt ?? t.prompt_template ?? "")}</div>${pred}${table}</div></details>`;
  }

  const sites = [...new Set([...Object.keys(tasksBySite), ...rows.map((r) => r.site)])].filter(Boolean).sort();
  const siteSections = sites.map((site) => {
    const ts = (tasksBySite[site] ?? []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const idsFromRuns = [...new Set(rows.filter((r) => r.site === site).map((r) => r.task_id))];
    for (const id of idsFromRuns) if (!ts.find((t) => t.id === id)) ts.push({ id, site, prompt: "(task definition not in tasks/)" });
    const ran = rows.some((r) => r.site === site);
    return `<h2>${esc(site)} ${ran ? "" : '<span class="muted">(no runs yet)</span>'}</h2>${ts.map((t) => taskCard(site, t)).join("\n")}`;
  }).join("\n");

  // ---- run summary: bar charts + improvement table (shown before the boxes) ----
  // Bars are linear (so WebMCP's sliver next to the others IS the finding) and
  // every bar is directly labelled — labels, not colour, carry identity, which
  // is what keeps the green/red pair legible under colour-blindness.
  // Each chart sorts on its own metric and leads with the best performer: lowest
  // first for cost, tokens and time, highest first for success rate, where big
  // is good. So every chart reads top-down as best-to-worst, and a shared order
  // (which would leave three of the four looking shuffled) is avoided. The
  // methods land in a different order per chart, which is fine — every bar is
  // directly labelled, so identity comes from the label, not the position.
  const maxOf = (f) => Math.max(1e-9, ...methodAgg.map(f).map((v) => v || 0));
  const barBlock = (title, valueOf, fmt, max, bigIsBetter = false) => `<figure class="chart"><figcaption>${title}</figcaption>${
    [...methodAgg].sort((x, y) => {
      const d = (valueOf(x) || 0) - (valueOf(y) || 0);
      return bigIsBetter ? -d : d;
    }).map((a) => {
      const v = valueOf(a) || 0;
      const w = Math.max(v > 0 ? 2 : 0, (v / max) * 100);
      return `<div class="bar-row"><span class="bar-label">${esc(a.m)}</span><div class="bar-track"><div class="bar-fill ${CLASS(a.arm)}" style="width:${w.toFixed(1)}%"></div></div><span class="bar-val">${fmt(v, a)}</span></div>`;
    }).join("")
  }</figure>`;
  const charts = `<div class="charts">
    ${barBlock("Median cost / task", (a) => a.cost, money, maxOf((a) => a.cost))}
    ${barBlock("Median tokens processed / task", (a) => a.tk, num, maxOf((a) => a.tk))}
    ${barBlock("Median agent time / task", (a) => a.ms, (v) => v.toFixed(0) + "s", maxOf((a) => a.ms))}
    ${barBlock("Success rate", (a) => (a.n ? a.pass / a.n * 100 : 0), (v, a) => `${v.toFixed(0)}% (${a.pass}/${a.n})`, 100, true)}
  </div>`;

  // Improvement table: interfaces grouped, WebMCP as the reference, others shown
  // as multiples of the WebMCP median for cost / tokens / time.
  const aggsOf = (arm) => methodAgg.filter((a) => a.arm === arm);
  const GROUPS = [
    { label: "WebMCP", arms: ["wm-gpt", "wm-claude", "wm-stagehand"], cls: "webmcp" },
    { label: "Page structure · a11y", arms: ["a11y-stagehand"], cls: "struct" },
    { label: "DOM + vision (multimodal)", arms: ["dom-browseruse"], cls: "struct" },
    { label: "Screenshots", arms: ["cu-claude", "cu-openai"], cls: "cu" },
    { label: "Code execution (Playwright)", arms: ["code-openai"], cls: "code" },
  ].map((g) => ({ ...g, aggs: g.arms.flatMap(aggsOf) })).filter((g) => g.aggs.length);
  const wmAggs = GROUPS.find((g) => g.cls === "webmcp")?.aggs ?? [];
  const wmCost = median(wmAggs.map((a) => a.cost).filter((x) => x != null));
  const wmTok = median(wmAggs.map((a) => a.tk).filter((x) => x != null));
  const wmMs = median(wmAggs.map((a) => a.ms).filter((x) => x != null));
  const slash = (aggs, fmt) => aggs.map((a) => fmt(a)).join(" / ");
  const mult = (v, base) => (v != null && base) ? (v / base).toFixed(v / base >= 10 ? 0 : 1) + "×" : "—";
  const impRows = GROUPS.map((g) => {
    const cost = median(g.aggs.map((a) => a.cost).filter((x) => x != null));
    const tk = median(g.aggs.map((a) => a.tk).filter((x) => x != null));
    const ms = median(g.aggs.map((a) => a.ms).filter((x) => x != null));
    const vs = g.cls === "webmcp" ? "<td>reference</td>"
      : `<td>${mult(cost, wmCost)} cost · ${mult(tk, wmTok)} tok · ${mult(ms, wmMs)} time</td>`;
    return `<tr class="${g.cls}${g.cls === "webmcp" ? " ref" : ""}"><td>${esc(g.label)}</td><td class="mono">${esc(g.aggs.map((a) => a.m).join(" / "))}</td><td class="mono">${slash(g.aggs, (a) => money(a.cost))}</td><td class="mono">${slash(g.aggs, (a) => num(a.tk))}</td>${vs}</tr>`;
  }).join("");
  const ratioVs = (val, base) => GROUPS.filter((g) => g.cls !== "webmcp")
    .map((g) => median(g.aggs.map(val).filter((x) => x != null)) / (base || 1))
    .filter((x) => Number.isFinite(x) && x > 0);
  const others = ratioVs((a) => a.cost, wmCost);
  const tokOthers = ratioVs((a) => a.tk, wmTok);
  const msOthers = ratioVs((a) => a.ms, wmMs);
  const range = (xs) => {
    if (!xs.length) return "—";
    const lo = Math.round(Math.min(...xs)), hi = Math.round(Math.max(...xs));
    return lo === hi ? `${lo}×` : `${lo}×–${hi}×`;
  };
  const succOf = (aggs) => median(aggs.map((a) => (a.n ? a.pass / a.n * 100 : null)).filter((x) => x != null));
  const wmSucc = succOf(wmAggs);
  const otherSucc = GROUPS.filter((g) => g.cls !== "webmcp").map((g) => succOf(g.aggs)).filter((x) => Number.isFinite(x));
  const succRange = otherSucc.length ? `${Math.round(Math.min(...otherSucc))}%–${Math.round(Math.max(...otherSucc))}%` : "—";
  const takeaway = wmAggs.length && others.length
    ? `WebMCP solved <b>${Math.round(wmSucc)}%</b> of attempts (vs ${succRange} for the other interfaces) while being <b>${range(others)} cheaper</b>, <b>${range(tokOthers)} lighter</b> (median tokens), and <b>${range(msOthers)} faster</b>.`
    : "";
  // ---- run identity + plain-language "what ran" ----
  const armIds = [...new Set(rows.map((r) => r.arm))];
  const siteIds = [...new Set(rows.map((r) => r.site))];
  const taskIds = [...new Set(rows.map((r) => r.task_id))];
  const totalCost = rows.reduce((s, r) => s + (+r.est_cost_usd || 0), 0);
  const nfmt = (x) => x.toLocaleString();
  const plural = (x, w) => `${nfmt(x)} ${w}${x === 1 ? "" : "s"}`;
  const title = meta ? "WindTunnel benchmark run" : "WindTunnel — results explorer";
  const subLine = meta
    ? [meta.date, plural(siteIds.length, "site"), plural(armIds.length, "method"), meta.n && `${meta.n} attempt${meta.n === 1 ? "" : "s"} per task`].filter(Boolean).join(" · ")
    : `${plural(runCount, "run")} aggregated · ${plural(armIds.length, "method")} · ${plural(siteIds.length, "site")}`;
  // Lead with what WindTunnel measures, for a reader with zero context.
  const lead = "WindTunnel measures how reliably and cheaply an AI browser agent can operate real websites, comparing four ways it can “see” and act on a page.";
  const plain = meta
    ? `${lead} This run put <b>${plural(armIds.length, "method")}</b> through <b>${plural(taskIds.length, "task")}</b> across <b>${plural(siteIds.length, "site")}</b>${meta.n ? `, ${meta.n} attempt${meta.n === 1 ? "" : "s"} each` : ""} — <b>${nfmt(rows.length)}</b> agent runs in total, about <b>$${totalCost.toFixed(2)}</b>. The four interfaces: <b style="color:var(--webmcp)">WebMCP</b> (the site hands the agent direct tools), <b style="color:var(--cu)">computer use</b> (the agent reads screenshots), <b style="color:var(--struct)">page structure</b> (the agent reads the DOM / accessibility tree), and <b style="color:var(--code)">code execution</b> (the agent writes Playwright code against the page).`
    : `${lead} Aggregated across <b>${plural(runCount, "run")}</b>: ${plural(armIds.length, "method")}, ${plural(siteIds.length, "site")}, <b>${nfmt(rows.length)}</b> runs. <b style="color:var(--webmcp)">WebMCP</b> · <b style="color:var(--cu)">computer use</b> · <b style="color:var(--struct)">page structure</b> · <b style="color:var(--code)">code execution</b>.`;
  const droppedNote = droppedCount ? ` <span class="muted">(${plural(droppedCount, "run")} that errored on infrastructure — rate-limits, boot/registration timeouts, crashes — excluded from every number here.)</span>` : "";
  const finding = takeaway ? `<b>Headline:</b> ${takeaway}${droppedNote}` : `Per-method cost, tokens, and success are charted below.${droppedNote}`;
  // ---- how the advantage scales with journey length ----
  // The per-tier view is the finding a flat median hides: page-reading agents
  // re-read the whole page every step, so their cost and token disadvantage
  // compounds with journey length, while WebMCP's stays flat.
  const tierOf = {};
  for (const [site, ts] of Object.entries(tasksBySite)) for (const t of ts) tierOf[`${site}|${t.id}`] = t.tier || "";
  const TIERS = ["answer", "act-short", "act-long", "transaction"];
  const TIER_LABEL = { "answer": "Answer (1–2 steps)", "act-short": "Act, short (3–5)", "act-long": "Act, long (6–10)", "transaction": "Transaction (8–15)" };
  const inTier = (tier) => rows.filter((r) => tierOf[`${r.site}|${r.task_id}`] === tier);
  const isWmArm = (a) => a.startsWith("wm");
  const tierRows = TIERS.map((tier) => {
    const rs = inTier(tier);
    const wm = rs.filter((r) => isWmArm(r.arm)), br = rs.filter((r) => !isWmArm(r.arm));
    if (!wm.length || !br.length) return "";
    const ratio = (f) => { const a = median(wm.map(f)), b = median(br.map(f)); return a ? (b / a) : null; };
    const x = (v) => v == null ? "—" : `${v.toFixed(1)}×`;
    const tasks = new Set(rs.map((r) => `${r.site}|${r.task_id}`)).size;
    const solved = (arms) => {
      const cells = {};
      for (const r of rs.filter(arms)) (cells[`${r.site}|${r.task_id}|${cfgKey(r)}`] ??= []).push(r);
      const list = Object.values(cells);
      return `${list.filter((c) => c.filter(passed).length > c.length / 2).length}/${list.length}`;
    };
    return `<tr><td>${TIER_LABEL[tier] ?? tier}</td><td class="mono">${tasks}</td><td class="mono">${solved((r) => isWmArm(r.arm))}</td><td class="mono">${solved((r) => !isWmArm(r.arm))}</td><td class="mono">${x(ratio((r) => +r.est_cost_usd || 0))}</td><td class="mono">${x(ratio(secs))}</td><td class="mono">${x(ratio(tok))}</td></tr>`;
  }).join("");
  const tierTable = tierRows ? `<h2>How the advantage scales with journey length</h2>
    <p class="hint">Solved counts are task×method cells (majority of attempts passing). The multiples are the pooled browser-method median divided by the pooled WebMCP median for that tier — higher means WebMCP is further ahead.</p>
    <table class="imp"><thead><tr><th>Tier</th><th>Tasks</th><th>WebMCP solved</th><th>Browser solved</th><th>Cheaper</th><th>Faster</th><th>Lighter</th></tr></thead><tbody>${tierRows}</tbody></table>
    <p class="note">A page-reading agent re-reads the whole page on every step, so its cost and token disadvantage <b>compounds with journey length</b>; a WebMCP call returns a small JSON result regardless of how long the journey is. On the longest journeys the cost gap reaches an order of magnitude, while the speed gap — bounded by model latency per turn rather than by payload size — grows more slowly.</p>` : "";

  const summary = `${charts}
    <table class="imp"><thead><tr><th>Interface</th><th>Method</th><th>Median $/task</th><th>Median tokens</th><th>vs WebMCP</th></tr></thead><tbody>${impRows}</tbody></table>
    <p class="note">The <b>DOM + vision</b> row (Browser Use) is <b>multimodal</b> — by default it reads the page's DOM <em>and</em> a screenshot each step, so it's the strongest realistic non-WebMCP baseline here, not a DOM-only agent. The computer-use rows are screenshots-only; the a11y row is accessibility-tree-only. WebMCP is compared against each on equal footing.</p>
    ${tierTable}`;

  // ---- flat sortable/filterable data table (spreadsheet view) ----
  const IFACE = (a) => a.startsWith("wm") ? "WebMCP" : a.startsWith("cu") ? "Screenshots" : a === "code-openai" ? "Code execution (Playwright)" : a === "a11y-stagehand" ? "Page structure (a11y)" : a === "dom-browseruse" ? "DOM + vision" : a;
  const flatCells = {};
  for (const r of rows) { const k = `${r.site}|${r.task_id}|${cfgKey(r)}`; (flatCells[k] ??= []).push(r); }
  const flat = Object.values(flatCells).map((rs) => {
    const { site, task_id: task, arm, model = "" } = rs[0];
    const pass = rs.filter(passed).length;
    return { site, type: SITE_TYPE[site] || "", task, tier: tierOf[`${site}|${task}`] || "", iface: IFACE(arm), method: cfgLabel(arm, model), arm, model, cls: CLASS(arm),
      p: pass, n: rs.length, pct: Math.round(pass / rs.length * 100),
      cost: median(rs.map((r) => +r.est_cost_usd || 0)), tok: Math.round(median(rs.map(tok)) || 0), sec: Math.round(median(rs.map((r) => +r.wall_clock_s || 0)) || 0) };
  }).sort((a, b) => a.site.localeCompare(b.site) || a.task.localeCompare(b.task));
  const opt = (vals) => vals.map((v) => `<option>${esc(v)}</option>`).join("");
  const dataTable = `<p class="hint">Filter by site, interface or tier; click any column header to sort. Site type is from the benchmark's own site registry. Cost/tokens/time are medians across repeats; infrastructure-errored runs are excluded.</p>
<div class="dt-controls">
<select id="f-site"><option value="">All sites</option>${opt([...new Set(flat.map((r) => r.site))].sort())}</select>
<select id="f-iface"><option value="">All interfaces</option>${opt([...new Set(flat.map((r) => r.iface))])}</select>
<select id="f-tier"><option value="">All tiers</option>${opt([...new Set(flat.map((r) => r.tier).filter(Boolean))])}</select>
<input id="f-q" type="search" placeholder="search site / task / method…">
<span id="dt-count" class="muted"></span>
</div>
<div class="dt-wrap"><table class="dt" id="dt"><thead><tr>
<th data-k="site">Site</th><th data-k="type">Type</th><th data-k="task">Task</th><th data-k="tier">Tier</th><th data-k="iface">Interface</th><th data-k="method">Method</th><th data-k="p">Pass</th><th data-k="pct">Success</th><th data-k="cost">$/task</th><th data-k="tok">Tokens</th><th data-k="sec">Time</th>
</tr></thead><tbody id="dt-body"></tbody></table></div>
<script>(function(){
var DATA=${JSON.stringify(flat)};
var sk='site',sd=1,f={site:'',iface:'',tier:'',q:''};
var body=document.getElementById('dt-body');
function money(v){return v==null?'—':'$'+Number(v).toFixed(3);}
function e(s){return String(s).replace(/[&<>]/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':'&gt;';});}
function render(){
var rows=DATA.filter(function(r){return (!f.site||r.site===f.site)&&(!f.iface||r.iface===f.iface)&&(!f.tier||r.tier===f.tier)&&(!f.q||(r.site+' '+r.task+' '+r.method+' '+r.type).toLowerCase().indexOf(f.q.toLowerCase())>=0);});
rows.sort(function(a,b){var x=a[sk],y=b[sk];if(typeof x==='string'){return sd*String(x).localeCompare(String(y));}return sd*((x||0)-(y||0));});
var h='';for(var i=0;i<rows.length;i++){var r=rows[i];h+='<tr class="'+e(r.cls)+'"><td>'+e(r.site)+'</td><td class="muted">'+e(r.type)+'</td><td class="mono">'+e(r.task)+'</td><td>'+e(r.tier)+'</td><td>'+e(r.iface)+'</td><td class="mono">'+e(r.method)+'</td><td>'+r.p+'/'+r.n+'</td><td>'+r.pct+'%</td><td>'+money(r.cost)+'</td><td>'+(r.tok||0).toLocaleString()+'</td><td>'+r.sec+'s</td></tr>';}
body.innerHTML=h||'<tr><td colspan="11" class="muted">No rows match.</td></tr>';
document.getElementById('dt-count').textContent=rows.length+' rows';
}
['site','iface','tier'].forEach(function(k){document.getElementById('f-'+k).addEventListener('change',function(e){f[k]=e.target.value;render();});});
document.getElementById('f-q').addEventListener('input',function(e){f.q=e.target.value;render();});
var ths=document.querySelectorAll('#dt th[data-k]');for(var j=0;j<ths.length;j++){ths[j].addEventListener('click',function(){var k=this.getAttribute('data-k');if(sk===k){sd=-sd;}else{sk=k;sd=(k==='cost'||k==='tok'||k==='sec'||k==='pct'||k==='p')?-1:1;}render();});}
render();
})();</script>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WindTunnel — Results Explorer</title><style>
:root{--bg:#fafaf7;--surface:#fff;--ink:#1a1a1a;--soft:#555;--muted:#888;--line:#e5e3dc;--accent:#0b8fc4;--accent-soft:#e2f2fb;--done:#6b8e4e;--warn:#b8860b;--code:#f4f2ec;
--webmcp:#6b8e4e;--cu:#c8553d;--struct:#7c6a9c;--code:#2f7d5a;--scripted:#888;}
*{box-sizing:border-box;}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:var(--bg);color:var(--ink);margin:0;line-height:1.55;font-size:16px;}
.container{max-width:900px;margin:0 auto;padding:56px 32px 120px;}
.logo{height:30px;width:auto;display:block;margin:0 0 18px auto;}
.doc-tag{display:inline-block;background:var(--accent);color:#fff;padding:4px 10px;border-radius:4px;font-size:13px;font-weight:600;margin-bottom:14px;letter-spacing:.02em;}
h1{font-size:30px;margin:0 0 6px;letter-spacing:-.01em;}
.sub{color:var(--muted);font-size:15px;margin:0 0 28px;}
h2{font-size:14px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);margin:38px 0 12px;font-weight:650;border-bottom:1px solid var(--line);padding-bottom:8px;}
.plain{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px 20px;margin:0 0 14px;}
.plain p{margin:0;color:var(--soft);font-size:15px;line-height:1.6;}
.tldr{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:0 10px 10px 0;padding:16px 20px;margin:0 0 22px;}
.tldr p{margin:0;color:var(--soft);font-size:14.5px;}
.hint{color:var(--muted);font-size:13px;margin:-4px 0 14px;}
.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin:0 0 22px;}
@media(max-width:600px){.charts{grid-template-columns:1fr;}}
.chart{min-width:0;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px 16px 10px;margin:0;}
.chart figcaption,figcaption{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:650;margin-bottom:10px;}
.bar-row{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12.5px;}
.bar-label{flex:0 0 96px;font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.bar-track{flex:1;background:var(--code);border-radius:4px;height:14px;overflow:hidden;}
.bar-fill{height:100%;border-radius:4px;min-width:2px;}
.bar-fill.webmcp{background:var(--webmcp);}.bar-fill.cu{background:var(--cu);}.bar-fill.struct{background:var(--struct);}.bar-fill.code{background:var(--code);}.bar-fill.scripted{background:var(--scripted);}
.bar-val{flex:0 0 62px;text-align:right;font-variant-numeric:tabular-nums;color:var(--soft);font-weight:600;}
table.imp{width:100%;border-collapse:collapse;font-size:13.5px;margin:0 0 12px;background:var(--surface);border:1px solid var(--line);border-radius:10px;overflow:hidden;}
table.imp th,table.imp td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);}
table.imp th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:650;}
table.imp td.mono{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;}
table.imp tr.ref{background:var(--accent-soft);font-weight:600;}
table.imp tr td:first-child{border-left:3px solid transparent;}
table.imp tr.webmcp td:first-child{border-left-color:var(--webmcp);}table.imp tr.cu td:first-child{border-left-color:var(--cu);}table.imp tr.struct td:first-child{border-left-color:var(--struct);}table.imp tr.code td:first-child{border-left-color:var(--code);}
.takeaway{background:var(--surface);border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:0 8px 8px 0;padding:12px 16px;margin:0 0 26px;font-size:14px;color:var(--soft);}
.note{font-size:12.5px;color:var(--muted);line-height:1.55;margin:0 0 26px;padding:0 2px;}
details{background:var(--surface);border:1px solid var(--line);border-radius:9px;margin-bottom:8px;overflow:hidden;}
details[open]{border-color:var(--accent);}
summary{padding:13px 17px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:13px;}
summary::-webkit-details-marker{display:none;}summary:hover{background:var(--accent-soft);}
.stitle{font-weight:650;font-family:ui-monospace,Menlo,monospace;font-size:14px;}.smeta{color:var(--muted);font-size:13px;flex:1;}
.chev{color:var(--muted);transition:transform .2s;}details[open] .chev{transform:rotate(90deg);}
.body{padding:6px 17px 18px;border-top:1px solid var(--line);}
.prompt,.pred{background:var(--code);border-radius:7px;padding:11px 13px;margin:13px 0;font-size:14px;color:var(--soft);}
.pred{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;}
.k{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);font-weight:600;margin-bottom:4px;}
table.t{width:100%;border-collapse:collapse;font-size:14px;}
table.t th,table.t td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);}
table.t th{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;}
table.t td:first-child{font-weight:500;}
tr.webmcp td:first-child{border-left:3px solid var(--webmcp);}tr.cu td:first-child{border-left:3px solid var(--cu);}tr.struct td:first-child{border-left:3px solid var(--struct);}tr.code td:first-child{border-left:3px solid var(--code);}tr.scripted td:first-child{border-left:3px solid var(--scripted);}
.muted{color:var(--muted);}
.dt-controls{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:6px 0 12px;}
.dt-controls select,.dt-controls input{font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--soft);}
.dt-controls input[type=search]{min-width:190px;flex:1;}
.dt-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:9px;}
table.dt{width:100%;border-collapse:collapse;font-size:13px;}
table.dt th,table.dt td{text-align:left;padding:7px 11px;border-bottom:1px solid var(--line);white-space:nowrap;}
table.dt thead th{position:sticky;top:0;background:var(--accent-soft);font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;cursor:pointer;user-select:none;}
table.dt thead th:hover{color:var(--accent);}
table.dt tbody tr:hover{background:var(--accent-soft);}
table.dt td.mono{font-family:ui-monospace,Menlo,monospace;font-size:12px;}
table.dt td:nth-child(n+7){font-variant-numeric:tabular-nums;text-align:right;}
tr.webmcp td:first-child{border-left:3px solid var(--webmcp);}tr.cu td:first-child{border-left:3px solid var(--cu);}tr.struct td:first-child{border-left:3px solid var(--struct);}tr.code td:first-child{border-left:3px solid var(--code);}tr.scripted td:first-child{border-left:3px solid var(--scripted);}
/* ponytail: CSS-only tabs (radio + :checked ~ sibling). No JS, and arrow-key
   navigation between tabs comes free with radio semantics. */
.tabr{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin:36px 0 18px;}
.tabs label{padding:9px 15px;font-size:11.5px;font-weight:650;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);cursor:pointer;border:1px solid transparent;border-bottom:none;border-radius:8px 8px 0 0;margin-bottom:-1px;}
.tabs label:hover{color:var(--accent);}
.panel{display:none;}
#v-tasks:checked~.tabs label[for=v-tasks],#v-table:checked~.tabs label[for=v-table]{background:var(--surface);border-color:var(--line);color:var(--accent);}
#v-tasks:checked~.p-tasks,#v-table:checked~.p-table{display:block;}
#v-tasks:focus-visible~.tabs label[for=v-tasks],#v-table:focus-visible~.tabs label[for=v-table]{outline:2px solid var(--accent);outline-offset:2px;}
.footnotes{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);}
.footnotes .note{margin:0 0 10px;}
footer{margin-top:44px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:12.5px;}
.footnotes+footer{margin-top:18px;border-top:none;padding-top:0;}
</style></head><body><div class="container">
${LOGO ? `<img class="logo" src="${LOGO}" alt="nekuda">` : ""}
<span class="doc-tag">RESULTS EXPLORER</span>
<h1>${title}</h1>
<p class="sub">${subLine}</p>
<div class="plain"><p>${plain}</p></div>
<div class="tldr"><p>${finding}</p></div>
<h2>Run summary</h2>
${summary}
<input class="tabr" type="radio" name="view" id="v-tasks" checked>
<input class="tabr" type="radio" name="view" id="v-table">
<div class="tabs">
<label for="v-tasks">Tasks by site</label>
<label for="v-table">All results table</label>
</div>
<section class="panel p-tasks">
<p class="hint">Click any task to see how each method did — pass rate, time, tokens, and cost — ranked best→worst. Cost/time/tokens are medians across repeats.</p>
${siteSections}
</section>
<section class="panel p-table">
${dataTable}
</section>
${(meta?.notes ?? []).length ? `<div class="footnotes">${meta.notes.map((note) => `<p class="note">* ${note}</p>`).join("\n")}</div>` : ""}
<footer>Generated by harness/build_explorer.mjs. Cost/tokens/success exclude infrastructure-errored runs. Not a canonical leaderboard — includes calibration flights.</footer>
</div></body></html>`;
}

// Standalone: aggregate every run into results/explorer.html.
function main() {
  const rows = [];
  const seen = new Set();
  for (const d of fs.existsSync(RES_DIR) ? fs.readdirSync(RES_DIR) : []) {
    if (d.startsWith("dry-")) continue;
    const rj = path.join(RES_DIR, d, "run.json");
    if (!fs.existsSync(rj)) continue;
    let data; try { data = JSON.parse(fs.readFileSync(rj, "utf8")); } catch { continue; }
    seen.add(d);
    for (const r of data.rows ?? []) rows.push(r);
  }
  const html = renderExplorerHTML({ rows, tasksBySite: loadTasksBySite(), runCount: seen.size });
  fs.writeFileSync(path.join(RES_DIR, "explorer.html"), html);
  console.log("explorer.html written:", (html.length / 1024).toFixed(0), "KB ·", rows.length, "run rows ·", seen.size, "runs");
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
