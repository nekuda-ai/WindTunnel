import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { csv, PRICES } from "../harness/lib.mjs";
import { verdictFor } from "../harness/lib.mjs";
import { renderExplorerHTML, loadTasksBySite } from "../harness/build_explorer.mjs";

const TEMPLATE = path.resolve(import.meta.dirname, "../results/TEMPLATE.md");

const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
function provenance() {
  try {
    const head = execSync("git rev-parse HEAD", { cwd: path.resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { cwd: path.resolve(import.meta.dirname, ".."), stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return dirty ? `${head}-dirty` : head;
  } catch { return "unknown"; }
}
function hashes() {
  const root = path.resolve(import.meta.dirname, "..");
  const taskFiles = fs.readdirSync(path.join(root, "tasks")).filter((file) => file.endsWith(".yaml")).sort();
  const goldenFiles = fs.readdirSync(path.join(root, "goldens")).filter((file) => file.endsWith(".patch")).sort();
  return { taskSet: digest(taskFiles.map((file) => fs.readFileSync(path.join(root, "tasks", file))).join("")), goldens: digest(goldenFiles.map((file) => fs.readFileSync(path.join(root, "goldens", file))).join("")) };
}

export function writeReport({ rows, verdicts, options, capsules = [], outputRoot = path.resolve(import.meta.dirname, "../results") }) {
  const hashesForRun = hashes();
  options = { ...options, git_revision: provenance(), task_set_hash: hashesForRun.taskSet, goldens_hash: hashesForRun.goldens };
  const date = options.date ?? new Date().toISOString().slice(0, 10);
  const label = options.label ?? `${options.sites}-${options.preset}`;
  // Dry runs (fake lifecycle — no real site booted) are prefixed and bannered so
  // they can never be mistaken for, or ingested as, a real benchmark result.
  const outputDir = path.join(outputRoot, `${options.fake ? "dry-" : ""}${date}-${label}`);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "results.csv"), csv(rows));
  fs.writeFileSync(path.join(outputDir, "run.json"), JSON.stringify({ options: { ...options, prices: PRICES }, capsules, rows, verdicts }, null, 2));

  // A budget stop can leave task×method pairs with zero attempts; counting them
  // as failures would deflate the headline, so they are reported as skipped.
  verdicts = verdicts.map((verdict) => {
    const rowsForVerdict = rows.filter((row) => row.site === verdict.site && row.task_id === verdict.taskId && row.arm === verdict.method);
    return rowsForVerdict.length ? { ...verdict, ...verdictFor(rowsForVerdict) } : verdict;
  });
  const scored = verdicts.filter(({ attempts }) => attempts === undefined || attempts > 0);
  const skipped = verdicts.length - scored.length;
  const solved = scored.filter(({ solved }) => solved).length;
  const total = scored.length;
  const percent = total ? (solved / total * 100).toFixed(1) : "0.0";
  const cost = rows.reduce((sum, row) => sum + Number(row.est_cost_usd || 0), 0);
  const ratio = (items) => `${items.filter(({ solved }) => solved).length}/${items.length}`;
  const arms = options.arms.map((arm) => ({ arm, verdicts: scored.filter(({ method }) => method === arm) }));
  const headline = [
    "| Method | Model | Solved | % |",
    "|---|---|---|---|",
    ...arms.map(({ arm, verdicts: items }) => `| ${arm} | ${options.armModels?.[arm] ?? options.model ?? "none"} | ${ratio(items)} | ${items.length ? (items.filter(({ solved }) => solved).length / items.length * 100).toFixed(1) : "0.0"}% |`),
  ].join("\n") + "\n";
  const tiers = ["answer", "act-short", "act-long", "transaction"];
  const tierTable = [
    `| Tier | ${arms.map(({ arm }) => arm).join(" | ")} |`,
    `|---|${arms.map(() => "---").join("|")}|`,
    ...tiers.map((tier) => `| ${tier} | ${arms.map(({ verdicts: items }) => ratio(items.filter((item) => item.tier === tier))).join(" | ")} |`),
  ].join("\n") + "\n";
  const sites = [...new Set(scored.map(({ site }) => site))];
  const siteTable = [
    `| Site | ${arms.map(({ arm }) => arm).join(" | ")} |`,
    `|---|${arms.map(() => "---").join("|")}|`,
    ...sites.map((site) => `| ${site} | ${arms.map(({ verdicts: items }) => ratio(items.filter((item) => item.site === site))).join(" | ")} |`),
  ].join("\n") + "\n";
  let report = fs.readFileSync(TEMPLATE, "utf8")
    .replace("<label>", label)
    .replace("YYYY-MM-DD", date)
    .replace("<smoke|lite|full>", options.preset)
    .replace("<lite|core|categories|full>", options.sites)
    .replaceAll("<N>", String(options.n))
    .replace("<x>", cost.toFixed(4))
    .replaceAll("<preset>", options.preset)
    .replaceAll("<profile>", `${options.sites} --arms ${options.arms.join(",")}`)
    .replace("<name @ hash>", "development tasks")
    .replace("<git sha>", options.git_revision)
    .replace("<repeats>", String(options.n))
    .replace("<total>", String(total))
    .replace("The same tasks, run three ways. Higher is better.", `**${solved}/${total} task×method combinations solved (${percent}%).**`)
    .replace("<which interface won, and by how much>", `${options.arms.join(", ")} solved ${solved}/${total} task×method combinations.`)
    .replace("- Skipped runs (missing keys, timeouts): <...>", `- Skipped runs (missing keys, timeouts): ${skipped ? `${skipped} task×method verdicts had no attempts (budget stop)` : "none recorded"}`)
    .replace("- Anomalies or surprises: <...>", "- Anomalies or surprises: none recorded")
    .replaceAll("<...>", "none");
  report = report
    .replace(/\| Access method \| Model \| Solved \| % \|\n\|---.*?\n(?:\|.*\n){3}/, headline)
    .replace(/\| Tier \| Screenshots \| Page structure \| WebMCP \|\n\|---.*?\n(?:\|.*\n){4}/, tierTable)
    .replace(/\| Site \| Screenshots \| Page structure \| WebMCP \|\n\|---.*?\n\|.*\n/, siteTable)
    .replace(/## Robustness \(optional\)[\s\S]*?(?=## Notes)/, "## Robustness (optional)\n\nNot implemented.\n\n")
    .replace("Sanity checks (the two control sites behaved as expected?): none",
      `Sanity checks (the two control sites behaved as expected?): ${["tailwind-nextjs-blog", "bulletproof-react"].every((id) => sites.includes(id)) ? "controls included — see the per-site table" : "n/a — control sites not in this run"}`);
  if (options.fake) {
    report = report.replace(/^npm run bench -- /m, "WT_FAKE_LIFECYCLE=1 npm run bench -- ");
    report = `> ⚠️ **DRY RUN — fake lifecycle.** No real site was booted; these numbers exercise the pipeline only and are NOT a benchmark result. Do not publish or add to the leaderboard.\n\n` + report;
  }
  const excluded = rows.filter((row) => row.failure_category?.startsWith("harness-infra:")).reduce((all, row) => {
    const key = `${row.arm} × ${row.failure_category.replace(/^harness-infra:\s*/, "")}`;
    all.set(key, (all.get(key) ?? 0) + 1); return all;
  }, new Map());
  if (excluded.size) report += `\n## Infrastructure exclusions\n\n${[...excluded].map(([key, count]) => `- ${count} attempts excluded: ${key}`).join("\n")}\n`;
  if (options.aborted) report = `> ⛔ **ABORTED FLIGHT — INCOMPLETE.** ${options.aborted}. This artifact measures an outage, not the model; it must not enter the canonical set.\n\n` + report;
  if (verdicts.some(({ attempts }) => attempts === 0)) report = `> ⚠️ **TRUNCATED RUN.** One or more task×method verdicts had zero valid attempts.\n\n${report}`;
  fs.writeFileSync(path.join(outputDir, "report.md"), report);
  // Per-run explorer: the same Nekuda template as results/explorer.html, scoped
  // to this run's rows and the task defs for the sites it covered.
  try {
    const runSites = new Set(rows.map((row) => row.site));
    const allTasks = loadTasksBySite();
    const tasksBySite = Object.fromEntries(Object.entries(allTasks).filter(([site]) => runSites.has(site)));
    const meta = { date, label, preset: options.preset, sites: options.sites, n: options.n };
    fs.writeFileSync(path.join(outputDir, "explorer.html"), renderExplorerHTML({ rows, tasksBySite, runCount: 1, meta }));
  } catch { /* explorer is a nicety; never fail a run over it */ }
  return outputDir;
}
