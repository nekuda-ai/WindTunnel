// Evaluate every stored answer row against the CURRENT task predicates and
// report every pass/fail transition against what the artifact recorded.
import fs from "node:fs"; import path from "node:path";
import { score } from "../scoring/predicates.mjs";
import { loadTasksBySite } from "../harness/build_explorer.mjs";
const cur = {};
for (const [site, tasks] of Object.entries(loadTasksBySite()))
  for (const t of tasks) if (t.predicate?.type === "answer") cur[`${site}|${t.id}`] = t.predicate;
const RES = path.resolve(import.meta.dirname, "../results");
const promo = [], demo = [];
const seenRunIds = new Set();
for (const dir of fs.readdirSync(RES)) {
  const f = path.join(RES, dir, "run.json");
  if (!fs.existsSync(f)) continue;
  const doc = JSON.parse(fs.readFileSync(f, "utf8"));
  // Dedupe by run_id rather than skipping dirs flagged `merged`: the canonical
  // 2026-07-27-reference IS a merged artifact whose source dirs are no longer
  // present, so skipping merged dirs would silently drop the largest run.
  // run_id is unique per attempt, so this handles any overlap correctly.
  for (const r of doc.rows ?? []) {
    if (seenRunIds.has(r.run_id)) continue;
    seenRunIds.add(r.run_id);
    const p = cur[`${r.site}|${r.task_id}`]; if (!p) continue;
    const text = r.final_text ?? ""; if (!text) continue;
    const now = (await score(p, null, text)).pass;
    if (now === !!r.pass) continue;
    (now ? promo : demo).push({ dir, task: r.task_id, arm: r.arm, model: r.model, text: text.replace(/\s+/g," ").slice(0,190) });
  }
}
const byTask = (rows) => rows.reduce((m,r)=>(m[r.task]=(m[r.task]??0)+1,m),{});
console.log(`PROMOTIONS (fail -> pass): ${promo.length}`, byTask(promo));
console.log(`DEMOTIONS  (pass -> fail): ${demo.length}`, byTask(demo));
console.log("\n=== every demotion, in full ===");
for (const d of demo) console.log(`\n[${d.dir}] ${d.task} ${d.arm}/${d.model}\n  ${d.text}`);
