# Update WindTunnel on Hugging Face

Preparation is local. Upload only after the reviewed website board is final.
The existing repositories are `nekuda/windtunnel` (dataset) and
`nekuda/windtunnel-results-explorer` (static Space).

## Prepare from the website board

From the packaging checkout, activate its existing environment:

```bash
source .hfenv/bin/activate
python hf/prepare_refresh_source.py "$BOARD_CSV" "$RUN_REPO" "$SOURCE_DIR"
python hf/prepare_model_refresh.py "$SOURCE_DIR" "$PACKAGE_DIR"
```

Set those four paths to the reviewed website CSV, run checkout, and two fresh
output folders. Source hashes, three attempts per task, and website metrics are
checked before packaging. Incomplete runs and smoke tests stay out.

## Review the package

From the generated package folder, with that environment still active:

```bash
python verify_package.py
python score_answers.py --verify-corpus --data-dir dataset/data
```

Require `SUMMARY: 9 passed, 0 failed` and `mismatches=0`.
Check `REFRESH.json` for the configuration count and `PROVENANCE.json` for source
hashes. Review the dataset card and `dataset/LICENSING.md`.

For a local explorer preview:

```bash
python -m http.server 8888 --bind 127.0.0.1 --directory space
```

Open <http://127.0.0.1:8888>, check model/site/interface filters, then stop the
server with Control-C. No API calls or keys are needed by the explorer.

## Upload after approval

These are the only publishing commands. Each folder is uploaded in one commit.
The dataset folder includes its scorer, provenance, licenses, and four Parquet
files. Existing remote history is preserved.

```bash
hf auth whoami
hf upload nekuda/windtunnel dataset . --repo-type dataset --commit-message "Update WindTunnel v1.3 results"
hf upload nekuda/windtunnel-results-explorer space . --repo-type space --commit-message "Update WindTunnel v1.3 explorer"
```

## Verify the uploaded bytes

```bash
export HF_CHECK_DIR="$(mktemp -d)"
hf download nekuda/windtunnel --repo-type dataset --local-dir "$HF_CHECK_DIR/dataset"
hf download nekuda/windtunnel-results-explorer --repo-type space --local-dir "$HF_CHECK_DIR/space"
diff -rq dataset "$HF_CHECK_DIR/dataset" --exclude=.cache
diff -rq space "$HF_CHECK_DIR/space" --exclude=.cache
python "$HF_CHECK_DIR/dataset/score_answers.py" --verify-corpus --data-dir "$HF_CHECK_DIR/dataset/data"
```

Both diffs must be empty and scoring must report `mismatches=0`.
If unrelated older remote files remain, inspect them; do not delete history or
files blindly. Record both uploaded commit IDs.

Finally check the four dataset Viewer configurations and the Space filters:

- <https://huggingface.co/datasets/nekuda/windtunnel>
- <https://huggingface.co/spaces/nekuda/windtunnel-results-explorer>
