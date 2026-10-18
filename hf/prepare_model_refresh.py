#!/usr/bin/env python3
"""Prepare and verify a local HF package from a reviewed canonical board. Never upload."""
import argparse
import collections
import json
from pathlib import Path
import shutil
import statistics
import subprocess
import sys

sys.dont_write_bytecode = True
import build_dataset as build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Validated release candidate's current directory")
    parser.add_argument("output", type=Path, help="Fresh local package directory")
    args = parser.parse_args()
    source, output = args.source.resolve(), args.output.resolve()
    run = json.loads((source / "run.json").read_text())
    configurations = len({(row["arm"], row["model"]) for row in run["rows"]})
    release = run["options"].get("release")
    if release not in {"v1.3", "v1.4"} or not configurations or len(run["rows"]) != configurations * 147 or len(run["verdicts"]) != configurations * 49:
        raise ValueError("Expected a validated board with 49 tasks and three attempts per configuration")
    if output.exists():
        raise ValueError("Choose a fresh output directory")
    origin = Path(__file__).resolve().parent
    build.CANONICAL, build.HF_ROOT, build.DATA_DIR = source, output, output / "dataset/data"
    build.EXPECTED_ROWS = {"attempts": configurations * 147, "verdicts": configurations * 49, "tasks": 49, "transcripts": configurations * 147}
    build.SCHEMAS = {**build.SCHEMAS, "attempts": build.pa.schema(list(build.ATTEMPTS_SCHEMA) + [build.pa.field(*field) for field in build.REFRESH_FIELDS])}
    try:
        build.main()
        for name in ("build_dataset.py", "verify_package.py", "score_answers.py"):
            shutil.copyfile(origin / name, output / name)
        shutil.copyfile(origin.parent / "LICENSE", output / "LICENSE")
        shutil.copyfile(origin / "dataset/LICENSING.md", output / "dataset/LICENSING.md")
        shutil.copyfile(source / "PROVENANCE.json", output / "PROVENANCE.json")
        for name in ("score_answers.py", "PROVENANCE.json", "LICENSE"):
            shutil.copyfile(output / name, output / "dataset" / name)
        shutil.copyfile(output / "LICENSE", output / "space/LICENSE")
        metadata = {"release": release, "configurations": configurations, "explorer_sha256": build.digest(source / "explorer.html")}
        (output / "REFRESH.json").write_text(json.dumps(metadata, indent=2) + "\n")
        frontmatter = (origin / "dataset/README.md").read_text().split("\n---\n", 1)[0] + "\n---\n"
        attempts = collections.defaultdict(list)
        verdicts = collections.defaultdict(list)
        for row in run["rows"]:
            attempts[(row["arm"], row["model"])].append(row)
        for row in run["verdicts"]:
            verdicts[(row["method"], row["model"])].append(row)
        table = ["| Model | Interface | Tasks solved | Attempts passed | Median cost | Median agent s |", "|---|---|---:|---:|---:|---:|"]
        for (arm, model), rows in sorted(attempts.items()):
            solved = sum(bool(row["solved"]) for row in verdicts[(arm, model)])
            passes = sum(bool(row["success"]) for row in rows)
            cost = statistics.median(float(row["est_cost_usd"]) for row in rows)
            seconds = statistics.median(float(row["agent_s"] if row.get("agent_s") not in (None, "") else row["wall_clock_s"]) for row in rows)
            table.append(f"| {model} | {build.interface(arm)} | {solved}/49 | {passes}/147 | ${cost:.6f} | {seconds:.1f} |")
        card = f"""\n# WindTunnel {release}

{configurations} model/interface configurations, 49 tasks, eight sites, seed 1, three attempts per cell and a 600-second agent cap.

WindTunnel and its reference WebMCP tools are authored by nekuda.

Costs are estimates from recorded token usage. Earlier retained measurements keep their recorded costs. Speed is median agent time, excluding environment setup and reset. Model settings and turn budgets differ; results cover this fixed task set.

The four datasets contain attempts, task verdicts, task definitions, and final answers for offline scoring. Previously published redacted Jev/Mercury traces are retained; new raw transcripts and encrypted reasoning are omitted. See LICENSING.md for provider-output terms.

{chr(10).join(table)}

Contamination canary: {build.CANARY}. Do not train on this benchmark.
"""
        (output / "dataset/README.md").write_text(frontmatter + card)
        space_metadata = (origin / "space/README.md").read_text().split("\n---\n", 1)[0] + "\n---\n"
        (output / "space/README.md").write_text(space_metadata + f"\n# WindTunnel {release}\n\nStatic explorer: {configurations} configurations, 49 tasks, eight sites, {configurations * 147} attempts.\n")
        shutil.copyfile(origin / "UPDATE.md", output / "UPLOAD.md")
        subprocess.run([sys.executable, str(output / "verify_package.py")], check=True)
    except BaseException:
        # This directory was created by this invocation; leave no invalid package.
        if output.exists():
            shutil.rmtree(output)
        raise


if __name__ == "__main__":
    main()
