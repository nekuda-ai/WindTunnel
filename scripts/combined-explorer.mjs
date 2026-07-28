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
const dirs = argv;
if (!dirs.length) { console.error("need at least one results dir"); process.exit(1); }

// Keyed per (site, arm, task) so a later dir supersedes only the exact tasks it
// re-ran — a partial re-run (e.g. cu-openai on just 2 idurar tasks) merges in
// without dropping the tasks an earlier dir already covered for that cell.
const key = (r) => `${r.site}|${r.arm}|${r.task_id}`;
const byCell = new Map();
const ownerOf = new Map(); // cell -> the dir whose rows survived, for the provenance report
for (const d of dirs) {
  const rj = path.join(path.isAbsolute(d) ? d : path.join(RES, d), "run.json");
  if (!fs.existsSync(rj)) { console.error("skip (no run.json):", d); continue; }
  const label = path.basename(d);
  const rows = JSON.parse(fs.readFileSync(rj, "utf8")).rows ?? [];
  for (const k of new Set(rows.map(key))) { byCell.set(k, []); ownerOf.set(k, label); }
  for (const r of rows) byCell.get(key(r)).push(r);
}
const rows = [...byCell.values()].flat();
const sites = new Set(rows.map((r) => r.site));
const tasksBySite = Object.fromEntries(Object.entries(loadTasksBySite()).filter(([s]) => sites.has(s)));
const html = renderExplorerHTML({ rows, tasksBySite, runCount: dirs.length,
  meta: { date: new Date().toISOString().slice(0, 10), label: "full reference", preset: "full", sites: "full", n: 3,
    notes: [
      "All cells were measured on one benchmark generation (single commit, 2026-07-27): the base 56-batch run plus two same-day targeted patches — md-5/md-8 × wm-claude (re-run after an oracle shell-quoting fix) and id-6 × all arms (re-run after its assertion shape was corrected; agents had verifiably done the task). Per-cell sources: PROVENANCE.md.",
      "One post-run predicate correction was applied by offline re-score: hev-4's regex forbade a sentence break inside the answer, failing one model's correct-but-multi-sentence phrasing; the corrected pattern was validated against every arm's stored answer (21/21 match) before re-scoring.",
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
  const [site, arm, taskId] = cell.split("|");
  return { site, taskId, tier: tierOf[`${site}|${taskId}`], method: arm, ...verdictFor(rs), source: ownerOf.get(cell) };
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
  const arm = cell.split("|")[1];
  const counts = perArm.get(arm) ?? new Map();
  counts.set(dir, (counts.get(dir) ?? 0) + 1);
  perArm.set(arm, counts);
}
const provLines = [];
for (const arm of [...perArm.keys()].sort()) {
  const counts = perArm.get(arm);
  const split = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d, n]) => `${n}×${d}`).join("  ");
  provLines.push(`  ${arm.padEnd(15)} ${counts.size > 1 ? "SPLIT " : "      "}${split}`);
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
