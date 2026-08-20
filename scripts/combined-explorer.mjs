// Curated combined reference: merge the base full run with targeted re-runs
// into ONE canonical results dir (explorer + results.csv + run.json +
// PROVENANCE.md). Later dirs WIN per (site, arm, task) cell — a re-run of e.g.
// cu-openai supersedes the base run's cu-openai rows entirely (no
// double-counting), while cells no re-run touched keep the base data. Excludes
// calibration/smoke noise by taking an explicit, ordered dir list. Usage:
//   node scripts/combined-explorer.mjs [--out <dirname>] <baseDir> <reRunDir> [...]
import fs from "node:fs";
import path from "node:path";
import { renderExplorerHTML, loadTasksBySite } from "../harness/build_explorer.mjs";
import { csv, isInfraRow, verdictFor } from "../harness/lib.mjs";

const RES = path.resolve(import.meta.dirname, "../results");
const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const outName = outIdx >= 0 ? argv.splice(outIdx, 2)[1] : "combined";
const attemptsIdx = argv.indexOf("--attempts");
const ATTEMPTS = attemptsIdx >= 0 ? Number(argv.splice(attemptsIdx, 2)[1]) : 3;
const configsIdx = argv.indexOf("--expect-configs");
const EXPECT_CONFIGS = configsIdx >= 0 ? Number(argv.splice(configsIdx, 2)[1]) : null;
const dirs = argv;
if (!dirs.length) { console.error("need at least one results dir"); process.exit(1); }

// Keyed per (site, arm, MODEL, task) so a later dir supersedes only the exact
// cells it re-ran. The model is part of the key because one arm runs several
// models across the matrix — cu-claude is Sonnet 5 in one configuration and
// Opus 5 in another — and a (site, arm, task) key would let a later run of one
// model silently erase a different model's configuration.
const key = (r) => `${r.site}|${r.arm}|${r.model}|${r.task_id}`;
const configOf = (cell) => { const [site, arm, model] = cell.split("|"); return `${arm} × ${model}`; };
const byCell = new Map();
const ownerOf = new Map(); // cell -> the dir whose rows survived, for the provenance report
const rejected = [];
for (const d of dirs) {
  const rj = path.join(path.isAbsolute(d) ? d : path.join(RES, d), "run.json");
  if (!fs.existsSync(rj)) { console.error("skip (no run.json):", d); continue; }
  const label = path.basename(d);
  const doc = JSON.parse(fs.readFileSync(rj, "utf8"));
  // An aborted flight measures an outage, not the model. The shape check catches
  // most of them, but not one aborted exactly at a cell boundary, nor one that
  // aborted and then recovered — so refuse them by their own marker.
  if (doc.options?.aborted) { console.error(`REFUSING aborted artifact: ${label} — ${doc.options.aborted}`); process.exit(1); }
  const rows = doc.rows ?? [];
  const grouped = new Map();
  for (const r of rows) (grouped.get(key(r)) ?? grouped.set(key(r), []).get(key(r))).push(r);
  for (const [k, cellRows] of grouped) {
    // A replacement must be a COMPLETE cell — merging 1 fresh attempt over 3
    // stale ones would quote a majority verdict computed across two harness
    // generations. Note the test is against the required attempt count, not
    // against the incumbent's: an incumbent can legitimately be partial (a
    // budget-truncated flight), and a complete top-up must be able to supersede
    // it. What must never happen is a partial cell overwriting a complete one.
    if (byCell.has(k) && cellRows.length !== ATTEMPTS) {
      rejected.push(`${label}: ${k} offers ${cellRows.length} attempts, not the required ${ATTEMPTS} — partial replacement rejected`);
      continue;
    }
    byCell.set(k, cellRows);
    ownerOf.set(k, label);
  }
}
const rows = [...byCell.values()].flat();
const sites = new Set(rows.map((r) => r.site));
const tasksBySite = Object.fromEntries(Object.entries(loadTasksBySite()).filter(([s]) => sites.has(s)));

// Shape checks against ABSOLUTE expectations, not mutual consistency: comparing
// configurations against each other hides a uniform shortfall (every
// configuration missing the same site, or every cell holding 2 attempts). The
// expected task set comes from the task files; the attempt count is the
// benchmark's design constant.
// Retired tasks (`excluded: true`) never run, so they are not expected cells.
// loadTasks() filters them; loadTasksBySite() does not, so filter here too.
const expectedPairs = Object.entries(tasksBySite).flatMap(([site, ts]) => ts.filter((t) => !t.excluded).map((t) => `${site}|${t.id}`));
const byConfig = new Map();
for (const cell of byCell.keys()) {
  const [site, arm, model, taskId] = cell.split("|");
  const set = byConfig.get(`${arm} × ${model}`) ?? new Set();
  set.add(`${site}|${taskId}`);
  byConfig.set(`${arm} × ${model}`, set);
}
const problems = [];
for (const [config, covered] of byConfig) {
  const missing = expectedPairs.filter((pair) => !covered.has(pair));
  if (missing.length) problems.push(`${config} is missing ${missing.length} cell(s): ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? " …" : ""}`);
}
const wrongSize = [...byCell.entries()].filter(([, rs]) => rs.length !== ATTEMPTS);
if (wrongSize.length) problems.push(`${wrongSize.length} cell(s) do not hold exactly ${ATTEMPTS} attempts, e.g. ${wrongSize[0][0]} (${wrongSize[0][1].length})`);
// Infrastructure rows do not vote (verdictFor filters them), so a cell like
// [infra, pass, infra] holds 3 rows but decides a "majority" from ONE attempt.
// Require at least 2 valid attempts for the majority verdict to mean anything.
const thinCells = [...byCell.entries()].filter(([, rs]) => rs.filter((r) => !isInfraRow(r)).length < 2);
if (thinCells.length) problems.push(`${thinCells.length} cell(s) have fewer than 2 non-infrastructure attempts, e.g. ${thinCells[0][0]} (${thinCells[0][1].filter((r) => !isInfraRow(r)).length} valid)`);
const runIds = rows.map((r) => r.run_id);
const dupes = [...new Set(runIds.filter((id, i) => runIds.indexOf(id) !== i))];
if (dupes.length) problems.push(`${dupes.length} duplicate run_id(s), e.g. ${dupes[0]}`);
if (EXPECT_CONFIGS !== null && byConfig.size !== EXPECT_CONFIGS) problems.push(`expected ${EXPECT_CONFIGS} configurations, found ${byConfig.size}`);
console.log(`shape: ${byConfig.size} configurations × ${expectedPairs.length} site/tasks × ${ATTEMPTS} attempts = ${byConfig.size * expectedPairs.length * ATTEMPTS} rows expected, ${rows.length} present`);
if (problems.length || rejected.length) {
  console.error("REFUSING TO WRITE — consolidation is not canonical:\n  " + [...rejected, ...problems].join("\n  "));
  process.exit(1);
}
// Provenance is DERIVED, never asserted. An earlier version hardcoded a note
// claiming every cell came from one 2026-07-27 commit, which stayed in the
// output long after this became a multi-generation merge — a written claim
// contradicting PROVENANCE.md in the same directory.
const sourceDates = [...new Set(dirs.map((d) => (path.basename(d).match(/^\d{4}-\d{2}-\d{2}/) || [])[0]).filter(Boolean))].sort();
const span = sourceDates.length > 1 ? `${sourceDates[0]} to ${sourceDates[sourceDates.length - 1]}` : sourceDates[0] || "unknown";
// ownerOf is the authority on which dir a cell came from; row fields are not.
const sourcesPerConfig = new Map();
for (const [cell, dir] of ownerOf) {
  const key = configOf(cell);
  sourcesPerConfig.set(key, (sourcesPerConfig.get(key) ?? new Set()).add(dir));
}
const splitCount = [...sourcesPerConfig.values()].filter((s) => s.size > 1).length;
const html = renderExplorerHTML({ rows, tasksBySite, runCount: dirs.length,
  meta: { date: new Date().toISOString().slice(0, 10), label: outName, preset: "full", sites: "full", n: ATTEMPTS,
    notes: [
      `Consolidated from ${dirs.length} source runs spanning ${span}; ${splitCount} of ${byConfig.size} configurations draw cells from more than one run. Every cell carries exactly ${ATTEMPTS} attempts from a single source — cells are never assembled across runs. Per-cell sources: PROVENANCE.md.`,
      "Scorer corrections are applied by offline re-score (scripts/rescore.mjs) as a separate correction artifact that supersedes the affected cells; raw run directories are never rewritten. Probe predicates ran against live database state and cannot be re-scored offline.",
    ] } });

const out = path.join(RES, outName);
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "explorer.html"), html);
// Artifact fragment (strip the outer doc shell the Artifact wrapper supplies).
const style = (html.match(/<style>[\s\S]*?<\/style>/) || [""])[0];
const body = (html.match(/<body>([\s\S]*?)<\/body>/) || ["", ""])[1];
fs.writeFileSync(path.join(out, "explorer-artifact.html"), `${style}\n${body}`);

// Full reference data alongside the explorer, same shape as a single run's
// output. Verdicts count only agent attempts — infrastructure-errored rows
// (failure_category "harness:…") aren't evidence about the interface, so they
// don't vote; a cell left with zero valid attempts gets attempts: 0, which the
// report layer already treats as "skipped", not failed.
const tierOf = {};
for (const [site, ts] of Object.entries(tasksBySite)) for (const t of ts) tierOf[`${site}|${t.id}`] = t.tier;
const verdicts = [...byCell.entries()].map(([cell, rs]) => {
  const [site, arm, model, taskId] = cell.split("|");
  return { site, taskId, tier: tierOf[`${site}|${taskId}`], method: arm, model, ...verdictFor(rs), source: ownerOf.get(cell) };
});

fs.writeFileSync(path.join(out, "results.csv"), csv(rows));
fs.writeFileSync(path.join(out, "run.json"), JSON.stringify({
  options: { merged: true, sources: dirs.map((d) => path.basename(d)), generated: new Date().toISOString().slice(0, 10) },
  rows, verdicts }, null, 2));
console.log(`${outName}: ${rows.length} rows, ${sites.size} sites, ${new Set(rows.map((r) => r.arm)).size} arms, from ${dirs.length} dirs`);

// Provenance per arm. Later-wins precedence silently mixes methodologies when a
// re-run meant to supersede an arm did not in fact cover every cell — the merged
// table then quotes old and new measurements side by side with nothing to show
// it. An arm sourced from more than one dir is not automatically wrong (a
// gap-fill is legitimate), but it always deserves a look, so print the split.
const perArm = new Map();
for (const [cell, dir] of ownerOf) {
  const arm = configOf(cell);
  const counts = perArm.get(arm) ?? new Map();
  counts.set(dir, (counts.get(dir) ?? 0) + 1);
  perArm.set(arm, counts);
}
const provLines = [];
for (const arm of [...perArm.keys()].sort()) {
  const counts = perArm.get(arm);
  const split = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${n}×${d}`).join("  ");
  provLines.push(`  ${arm.padEnd(34)} ${counts.size > 1 ? "SPLIT " : "      "}${split}`);
}
console.log("provenance (cells per source dir):");
console.log(provLines.join("\n"));
fs.writeFileSync(path.join(out, "PROVENANCE.md"), `# Provenance

This is a merged reference: the base full run plus targeted re-runs, merged
per (site, method, task) cell with later runs superseding earlier ones. Source
runs, in precedence order (later wins):

${dirs.map((d, i) => `${i + 1}. ${path.basename(d)}`).join("\n")}

## Cells per source, by method

An arm marked SPLIT draws cells from more than one source run — legitimate for
gap-fills, but those cells were measured under that run's harness generation.

\`\`\`
${provLines.join("\n")}
\`\`\`

Per-cell sources are in \`run.json\` (each verdict's \`source\` field).
`);
