#!/usr/bin/env python3
"""Build a private, sanitized HF source from the reviewed website board and source audits."""
import argparse
import collections
import csv
import hashlib
import json
from pathlib import Path
import subprocess


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("board", type=Path)
    parser.add_argument("runs", type=Path, help="Run repository containing the private source audits")
    parser.add_argument("output", type=Path, help="Fresh private source directory")
    args = parser.parse_args()
    board, runs, output = args.board.resolve(), args.runs.resolve(), args.output.resolve()
    if output.exists():
        raise ValueError("Choose a fresh output directory")
    private = runs / "results/model-refresh-private"
    audit = json.loads((private / "benchmark-preview-provenance.json").read_text())
    canonical = runs / "results/canonical/run.json"
    assert digest(canonical) == audit["canonical_sha256"]
    source_rows = json.loads(canonical.read_text())["rows"]
    sources = []
    for item in audit["sources"]:
        path = (private / "sonnet-scorer-v2" / ("corrected-" + item["configuration"]) / "run.json"
                if item["scorer_revision"] else private / "native-flight" / item["source"] / "run.json")
        assert digest(path) == item["selected_sha256"], item["configuration"]
        run = json.loads(path.read_text())
        source_rows += run["rows"]
        sources.append({"configuration": item["configuration"], "sha256": digest(path), "options": provenance_options(run)})
    for proof in sorted(private.glob("benchmark-preview-*-provenance.json")):
        item = json.loads(proof.read_text()).get("added")
        if not item:
            continue
        found = list(private.glob("*/" + item["source"] + "/run.json"))
        assert len(found) == 1, item["source"]
        path = found[0]
        assert digest(path) == item["source_sha256"]
        run = json.loads(path.read_text())
        source_rows += run["rows"]
        sources.append({"configuration": item["configuration"], "sha256": digest(path), "options": provenance_options(run)})
    by_id = {row["run_id"]: row for row in source_rows}
    with board.open() as handle:
        public = list(csv.DictReader(handle))
    selected = []
    for row in public:
        raw = by_id[row["run_id"]]
        passed = bool(raw.get("pass", raw.get("success")))
        assert passed == (row["success"].lower() == "true")
        for key in ("arm", "model", "site", "task_id"):
            assert raw[key] == row[key]
        for key in ("est_cost_usd", "agent_s", "input_tokens", "output_tokens", "cached_tokens", "cache_write_tokens"):
            assert float(raw.get(key) or 0) == float(row[key] or 0), (row["run_id"], key)
        selected.append({**raw, "pass": passed, "success": passed, "source": row["source"]})
    counts = collections.Counter((r["arm"], r["model"], r["site"], r["task_id"]) for r in selected)
    configurations = len({(r["arm"], r["model"]) for r in selected})
    assert len({r["run_id"] for r in selected}) == configurations * 147
    assert len(counts) == configurations * 49 and set(counts.values()) == {3}
    output.mkdir(parents=True, mode=0o700)
    payload = output / ".private-input.json"
    payload.write_text(json.dumps(selected))
    try:
        subprocess.run(["node", "--input-type=module", "-e", RENDER, str(payload), str(output)],
                       cwd=Path(__file__).resolve().parent.parent, check=True)
    finally:
        payload.unlink(missing_ok=True)
    (output / "PROVENANCE.json").write_text(json.dumps({"release": "v1.3", "configurations": configurations,
        "attempts": len(selected), "website_csv_sha256": digest(board), "base_revision": audit["source_commit"],
        "base_run_sha256": audit["canonical_sha256"], "sources": sources}, indent=2) + "\n")
    print(f"Prepared {configurations} configurations, {len(selected)} attempts: {output}")


def provenance_options(run):
    return {key: run["options"][key] for key in ("git_revision", "refresh_hash", "task_set_hash", "goldens_hash", "scorer_revision") if key in run["options"]}


RENDER = r"""
import fs from 'node:fs';
import { CSV_COLUMNS, csv, verdictFor } from './harness/lib.mjs';
import { loadTasksBySite, renderExplorerHTML } from './harness/build_explorer.mjs';
import { publicCleaner } from './scripts/prepare-model-release.mjs';
const [input, out] = process.argv.slice(1), clean = publicCleaner();
const allowed = new Set([...CSV_COLUMNS, 'method', 'pass', 'model_snapshot', 'final_text', 'ms', 'tokens', 'evaluation_s']);
const rows = JSON.parse(fs.readFileSync(input)).map(r => clean(Object.fromEntries(Object.entries(r).filter(([k]) => allowed.has(k)))));
const pairs = new Set(rows.map(r => `${r.site}|${r.task_id}`));
const tasks = clean(Object.fromEntries(Object.entries(loadTasksBySite()).map(([site, ts]) => [site, ts.filter(t => pairs.has(`${site}|${t.id}`))]).filter(([, ts]) => ts.length)));
const cells = new Map();
for (const r of rows) { const k = `${r.arm}|${r.model}|${r.site}|${r.task_id}`; cells.set(k, [...(cells.get(k) ?? []), r]); }
const verdicts = [...cells.values()].map(rs => ({ site: rs[0].site, taskId: rs[0].task_id, method: rs[0].arm, model: rs[0].model, tier: tasks[rs[0].site].find(t => t.id === rs[0].task_id).tier, ...verdictFor(rs), source: rs[0].source }));
const options = { release: 'v1.3', label: 'WindTunnel v1.3', seed: 1, n: 3, privacy: 'New raw transcripts omitted; final answers redacted.' };
fs.writeFileSync(`${out}/run.json`, JSON.stringify({ options, rows, verdicts }));
fs.writeFileSync(`${out}/results.csv`, csv(rows));
fs.writeFileSync(`${out}/tasks.json`, JSON.stringify(tasks));
fs.writeFileSync(`${out}/explorer.html`, renderExplorerHTML({ rows, tasksBySite: tasks, canonical: true, runCount: rows.length / 147, meta: { date: new Date().toISOString().slice(0, 10), label: options.label, preset: 'full', sites: 'full', n: 3, notes: [options.privacy, 'Costs are estimates. Timing is agent time, excluding setup and reset.'] } }).replace(/[ \t]+$/gm, ''));
"""

if __name__ == "__main__":
    main()
