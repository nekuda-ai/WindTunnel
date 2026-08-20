#!/usr/bin/env python3
"""Score JSONL/CSV answers with WindTunnel's published answer predicates."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from pathlib import Path

import pyarrow.parquet as pq


# Reimplemented instead of shelling out to Node so the published scorer is one
# command. --verify-corpus proves these semantics against every stored offline-
# scorable answer; live probe predicates are deliberately reported as SKIP.
def normalize_answer(value: str) -> str:
    value = str(value).lower()
    value = re.sub(r"https?://\S+", " ", value)
    value = re.sub(r"[‐-―−]", "-", value)
    value = re.sub(r"[’‘`´]", "'", value)
    value = re.sub(r"(\d)\s+to\s+(\d)", r"\1-\2", value)
    value = re.sub(r"[-_]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def score_answer(predicate: dict, answer: str) -> tuple[bool, str]:
    text = normalize_answer(answer)
    required = predicate.get("contains", [])
    alternatives = predicate.get("contains_any", [])
    pattern = predicate.get("matches")
    if not required and not alternatives and not pattern:
        raise ValueError("answer predicate has no expected text")
    passed = (
        all(normalize_answer(value) in text for value in required)
        and (not alternatives or any(normalize_answer(value) in text for value in alternatives))
        and (not pattern or re.search(pattern, answer, re.IGNORECASE) is not None)
    )
    if not passed:
        return False, "answer predicate failed"
    forbidden = next((value for value in predicate.get("not_contains", []) if normalize_answer(value) in text), None)
    return (False, f"answer predicate failed (negation): {forbidden}") if forbidden else (True, "predicate passed")


def default_data_dir() -> Path:
    here = Path(__file__).resolve().parent
    for candidate in (here / "dataset" / "data", here / "data"):
        if (candidate / "tasks.parquet").is_file():
            return candidate
    raise FileNotFoundError("cannot find data/tasks.parquet; pass --data-dir")


def load_tasks(data_dir: Path) -> dict[tuple[str, str], dict]:
    tasks = {}
    for row in pq.read_table(data_dir / "tasks.parquet").to_pylist():
        tasks[(row["site"], row["task_id"])] = {**row, "predicate": json.loads(row["predicate"])}
    return tasks


def read_answers(path: Path) -> list[dict]:
    if path.suffix.lower() == ".csv":
        with path.open(newline="") as handle:
            rows = list(csv.DictReader(handle))
    elif path.suffix.lower() in {".jsonl", ".ndjson"}:
        rows = []
        with path.open() as handle:
            for line_number, line in enumerate(handle, 1):
                if line.strip():
                    try:
                        rows.append(json.loads(line))
                    except json.JSONDecodeError as error:
                        raise ValueError(f"{path}:{line_number}: {error}") from error
    else:
        raise ValueError("input must be .jsonl, .ndjson, or .csv")
    for index, row in enumerate(rows, 1):
        missing = {"site", "task_id", "answer"} - set(row)
        if missing:
            raise ValueError(f"row {index}: missing {', '.join(sorted(missing))}")
        if not all(isinstance(row[key], str) for key in ("site", "task_id", "answer")):
            raise ValueError(f"row {index}: site, task_id, and answer must be strings")
    return rows


def score_file(path: Path, data_dir: Path) -> None:
    tasks = load_tasks(data_dir)
    counts = {"PASS": 0, "FAIL": 0, "SKIP": 0}
    for row in read_answers(path):
        key = (row["site"], row["task_id"])
        if key not in tasks:
            raise ValueError(f"unknown task: {key[0]}/{key[1]}")
        task = tasks[key]
        if task["predicate_type"] == "probe":
            status, detail = "SKIP", "live application-state probe cannot be scored offline"
        else:
            passed, detail = score_answer(task["predicate"], row["answer"])
            status = "PASS" if passed else "FAIL"
        counts[status] += 1
        print(f"{status}\t{row['site']}\t{row['task_id']}\t{detail}")
    print(f"SUMMARY\tpassed={counts['PASS']} failed={counts['FAIL']} skipped={counts['SKIP']} total={sum(counts.values())}")


def verify_corpus(data_dir: Path) -> None:
    tasks = load_tasks(data_dir)
    attempts = {row["run_id"]: row for row in pq.read_table(data_dir / "attempts.parquet").to_pylist()}
    transcripts = pq.read_table(data_dir / "transcripts.parquet").to_pylist()
    if len(attempts) != len(transcripts):
        raise AssertionError(f"attempt/transcript count mismatch: {len(attempts)} != {len(transcripts)}")
    checked = skipped = 0
    mismatches = []
    for transcript in transcripts:
        attempt = attempts.get(transcript["run_id"])
        if not attempt:
            raise AssertionError(f"transcript has no attempt: {transcript['run_id']}")
        task = tasks[(attempt["site"], attempt["task_id"])]
        if task["predicate_type"] == "probe":
            skipped += 1
            continue
        actual, _ = score_answer(task["predicate"], transcript["final_text"])
        checked += 1
        if actual != attempt["success"]:
            mismatches.append((attempt["run_id"], attempt["success"], actual))
    print(f"EQUIVALENCE\tstored={len(transcripts)} answer_checked={checked} probe_skipped={skipped} mismatches={len(mismatches)}")
    for run_id, expected, actual in mismatches[:20]:
        print(f"MISMATCH\t{run_id}\tstored={expected}\toffline={actual}")
    if mismatches:
        raise AssertionError(f"{len(mismatches)} offline scores differ from canonical results")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", type=Path, help="JSONL/CSV with site, task_id, answer")
    parser.add_argument("--data-dir", type=Path, help="directory containing the four Parquet files")
    parser.add_argument("--verify-corpus", action="store_true", help="prove answer-predicate equivalence on the stored corpus")
    args = parser.parse_args()
    try:
        data_dir = args.data_dir or default_data_dir()
        if args.verify_corpus:
            verify_corpus(data_dir)
        elif args.input:
            score_file(args.input, data_dir)
        else:
            parser.error("provide an input file or --verify-corpus")
    except (AssertionError, FileNotFoundError, KeyError, OSError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
