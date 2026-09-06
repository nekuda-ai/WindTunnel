#!/usr/bin/env python3
"""Release gate for the WindTunnel Hugging Face package."""

from __future__ import annotations

import getpass
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

import pyarrow as pa
import pyarrow.parquet as pq
import yaml

from build_dataset import CANARY, EXPECTED_ROWS, SCHEMAS


HF_ROOT = Path(__file__).resolve().parent
REPO_ROOT = HF_ROOT.parent
DATA_DIR = HF_ROOT / "dataset" / "data"
CONFIGS = {name: f"data/{name}.parquet" for name in SCHEMAS}
ALLOWED_LOCAL_HOSTS = {
    "easyappointments.local", "invoice.local", "invoicing.local", "gmail.local", "erp.local",
}
SECRET_PATTERNS = [
    ("Anthropic provider key", re.compile(r"sk-" r"ant-api\d\d-[A-Za-z0-9_-]{10,}")),
    ("OpenAI project/service key", re.compile(r"sk-" r"(?:proj|svcacct)-[A-Za-z0-9_-]{10,}")),
    ("Google provider key", re.compile(r"AI" r"zaSy[A-Za-z0-9_-]{33}")),
    ("GitHub token", re.compile(r"(?:ghp|gho)" r"_[A-Za-z0-9]{36}")),
    ("Slack token", re.compile(r"xox" r"[baprs]-[A-Za-z0-9-]{10,}")),
]
# Anchored to a path start: a site's own source tree may contain a segment
# named "Users" (hi-events: routes/admin/Users/index.tsx), which is not a
# home directory. A real leak looks like /Users/<name>/..., at the start of a
# path.
USERS_PATH = re.compile(r"(?<![A-Za-z0-9_./-])/Users/[A-Za-z0-9_.-]+/")
PRIVATE_IP = re.compile(
    r"(?<![\d.])(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?![\d.])"
)
LOCAL_HOST = re.compile(r"(?<![\w.-])(?:[A-Za-z0-9-]+\.)*[A-Za-z0-9-]+\.local(?![\w.-])")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def frontmatter(path: Path) -> dict:
    text = path.read_text()
    if not text.startswith("---\n") or "\n---\n" not in text[4:]:
        raise AssertionError(f"{path.relative_to(HF_ROOT)} has no YAML frontmatter")
    return yaml.safe_load(text.split("---\n", 2)[1])


def check_files() -> str:
    required = {
        "build_dataset.py", "verify_package.py", "score_answers.py", "UPLOAD.md",
        "dataset/README.md", "dataset/LICENSING.md", "space/README.md", "space/index.html",
        *(f"dataset/{path}" for path in CONFIGS.values()),
    }
    missing = sorted(path for path in required if not (HF_ROOT / path).is_file())
    if missing:
        raise AssertionError(f"missing: {', '.join(missing)}")
    return f"{len(required)} required files present"


def check_card_configs() -> str:
    metadata = frontmatter(HF_ROOT / "dataset" / "README.md")
    required = {"license", "task_categories", "language", "tags", "size_categories", "configs", "pretty_name", "annotations_creators", "source_datasets"}
    missing = sorted(required - set(metadata))
    if missing:
        raise AssertionError(f"dataset card metadata missing: {', '.join(missing)}")
    declared = {}
    for config in metadata["configs"]:
        files = config.get("data_files", [])
        if len(files) != 1 or files[0].get("split") != "train":
            raise AssertionError(f"{config.get('config_name')}: expected one train data_file")
        declared[config["config_name"]] = files[0].get("path")
    if declared != CONFIGS:
        raise AssertionError(f"card configs {declared!r} != expected {CONFIGS!r}")
    space = frontmatter(HF_ROOT / "space" / "README.md")
    if space.get("sdk") != "static" or space.get("app_file", "index.html") != "index.html":
        raise AssertionError("Space card must declare sdk: static and app_file: index.html")
    return "four dataset configs and static Space metadata declared"


def load_tables() -> dict[str, pa.Table]:
    tables = {}
    for name, schema in SCHEMAS.items():
        path = DATA_DIR / f"{name}.parquet"
        table = pq.read_table(path)
        if not table.schema.equals(schema, check_metadata=False):
            raise AssertionError(f"{name} schema mismatch\nexpected: {schema}\nactual: {table.schema}")
        tables[name] = table
    return tables


def check_parquet() -> str:
    tables = load_tables()
    wrong = {name: table.num_rows for name, table in tables.items() if table.num_rows != EXPECTED_ROWS[name]}
    if wrong:
        raise AssertionError(f"wrong row counts: {wrong}")
    if "transcript" in tables["attempts"].column_names:
        raise AssertionError("attempts contains a transcript column")
    if any(pa.types.is_nested(field.type) for field in tables["attempts"].schema):
        raise AssertionError("attempts contains a nested column")
    return ", ".join(f"{name}={tables[name].num_rows}" for name in SCHEMAS)


def check_dimensions() -> str:
    tables = load_tables()
    attempts = tables["attempts"].to_pylist()
    verdicts = tables["verdicts"].to_pylist()
    tasks = tables["tasks"].to_pylist()
    counts = {
        "attempts": len(attempts),
        "verdicts": len(verdicts),
        "tasks": len(tasks),
        "configurations": len({(row["arm"], row["model"]) for row in attempts}),
        "sites": len({row["site"] for row in attempts}),
    }
    expected = {"attempts": 2793, "verdicts": 931, "tasks": 49, "configurations": 19, "sites": 8}
    if counts != expected:
        raise AssertionError(f"dimensions {counts!r} != {expected!r}")
    if len({(row["configuration"], row["site"], row["task_id"]) for row in verdicts}) != 931:
        raise AssertionError("duplicate verdict cell")
    return ", ".join(f"{key}={value}" for key, value in counts.items())


def check_run_ids() -> str:
    ids = pq.read_table(DATA_DIR / "attempts.parquet", columns=["run_id"])["run_id"].to_pylist()
    duplicates = len(ids) - len(set(ids))
    if duplicates:
        raise AssertionError(f"{duplicates} duplicate run_id values")
    return f"{len(ids)} unique run_id values"


def check_canary() -> str:
    card = (HF_ROOT / "dataset" / "README.md").read_text()
    if CANARY not in card:
        raise AssertionError("canary GUID missing from dataset card")
    values = pq.read_table(DATA_DIR / "tasks.parquet", columns=["canary"])["canary"].to_pylist()
    if set(values) != {CANARY}:
        raise AssertionError("tasks canary column is missing or inconsistent")
    return f"GUID present in card and all {len(values)} task rows"


def scan_string(value: str, location: str, findings: list[str], usernames: set[str]) -> None:
    for label, pattern in SECRET_PATTERNS:
        if pattern.search(value):
            findings.append(f"{location}: {label}")
    if USERS_PATH.search(value):
        findings.append(f"{location}: absolute macOS user path")
    for username in usernames:
        if re.search(rf"(?<![A-Za-z0-9_-]){re.escape(username)}(?![A-Za-z0-9_-])", value):
            findings.append(f"{location}: personal username {username!r}")
    if PRIVATE_IP.search(value):
        findings.append(f"{location}: private IP address")
    for hostname in LOCAL_HOST.findall(value):
        if hostname.lower() not in ALLOWED_LOCAL_HOSTS:
            findings.append(f"{location}: machine hostname {hostname!r}")


def check_sensitive_data() -> str:
    usernames = {getpass.getuser(), Path.home().name, os.environ.get("USER", "")}
    usernames -= {"", "root", "runner", "ubuntu", "user"}
    findings = []
    strings = 0
    for path in sorted(HF_ROOT.rglob("*")):
        if not path.is_file() or "__pycache__" in path.parts:
            continue
        relative = path.relative_to(HF_ROOT)
        if path.suffix == ".parquet":
            table = pq.read_table(path)
            for column_name in table.column_names:
                if not pa.types.is_string(table.schema.field(column_name).type):
                    continue
                for row_number, value in enumerate(table[column_name].to_pylist(), 1):
                    if value is not None:
                        strings += 1
                        scan_string(value, f"{relative}:{column_name}[{row_number}]", findings, usernames)
        else:
            text = path.read_text()
            strings += 1
            scan_string(text, str(relative), findings, usernames)
    if findings:
        raise AssertionError("sensitive data found:\n  " + "\n  ".join(findings[:50]))
    return f"{strings} text values scanned case-sensitively; no keys, personal paths/hosts, or private IPs"


def check_space() -> str:
    source = REPO_ROOT / "results" / "canonical" / "explorer.html"
    target = HF_ROOT / "space" / "index.html"
    if sha256(source) != sha256(target):
        raise AssertionError("space/index.html is not a byte-for-byte copy of canonical explorer.html")
    return f"self-contained explorer preserved ({target.stat().st_size} bytes)"


def check_scorer() -> str:
    env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
    result = subprocess.run(
        [sys.executable, str(HF_ROOT / "score_answers.py"), "--verify-corpus", "--data-dir", str(DATA_DIR)],
        text=True, capture_output=True, env=env,
    )
    if result.returncode:
        raise AssertionError((result.stdout + result.stderr).strip())
    line = next((line for line in result.stdout.splitlines() if line.startswith("EQUIVALENCE\t")), "")
    if not line:
        raise AssertionError("scorer emitted no equivalence summary")
    return line.removeprefix("EQUIVALENCE\t")


def main() -> None:
    gates = [
        ("required files", check_files),
        ("card metadata", check_card_configs),
        ("Parquet load/schema/counts", check_parquet),
        ("benchmark dimensions", check_dimensions),
        ("run_id uniqueness", check_run_ids),
        ("contamination canary", check_canary),
        ("sensitive-data scan", check_sensitive_data),
        ("static explorer", check_space),
        ("offline scorer equivalence", check_scorer),
    ]
    failures = []
    print("WindTunnel Hugging Face package release gate")
    for label, gate in gates:
        try:
            print(f"PASS  {label}: {gate()}")
        except Exception as error:
            failures.append((label, str(error)))
            print(f"FAIL  {label}: {error}")
    print(f"SUMMARY: {len(gates) - len(failures)} passed, {len(failures)} failed")
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
