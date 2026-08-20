# Publishing the WindTunnel Hugging Face package

Run these commands from the WindTunnel source repository root. They create exactly two public Hub repositories: one dataset and one static Space. They do not create a model repository or a submission service.

## 0. Create the packaging environment (once)

`/tmp` is cleared on reboot, so build the environment somewhere durable and use
`$HFPY` throughout. This is isolated from the Node project and installs nothing
globally.

```bash
python3 -m venv .hfenv
./.hfenv/bin/pip install -q pyarrow pandas 'huggingface_hub[cli]'
export HFPY="$PWD/.hfenv/bin/python"
export HFCLI="$PWD/.hfenv/bin/hf"
$HFCLI version   # expect 1.x
```

## 1. Choose the Hub names

The publisher must choose the namespace. The suggested repository slugs can be changed before creation.

```bash
export HF_NAMESPACE="REPLACE_WITH_USER_OR_ORG"
export HF_DATASET_REPO="windtunnel"
export HF_SPACE_REPO="windtunnel-results-explorer"
```

## 2. Rebuild and run the release gate

Use the pinned packaging environment; this does not modify the Node project.

```bash
$HFPY hf/build_dataset.py
$HFPY hf/verify_package.py
```

Do not upload unless the final line is `SUMMARY: 9 passed, 0 failed`.

The four generated Parquet files should be committed in the publication package. They are the actual dataset payload, are deterministic outputs of immutable canonical artifacts, and are required for the Hub viewer; leaving them ignored would publish an empty dataset. Re-run the build and gate whenever `results/canonical/` changes.

## 3. Review the legal boundary

Read `hf/dataset/LICENSING.md`. Confirm that the provider agreements and any organization-specific order forms governing the canonical run permit the planned public transcript distribution. Re-check the linked Anthropic, OpenAI, and Google terms on publication day. If transcripts cannot be cleared, stop: changing the agreed four-config architecture requires the requester rather than silently omitting that config.

## 4. Authenticate and create exactly two repositories

```bash
$HFCLI auth login
$HFCLI repos create "$HF_NAMESPACE/$HF_DATASET_REPO" --repo-type dataset --public --exist-ok
$HFCLI repos create "$HF_NAMESPACE/$HF_SPACE_REPO" --repo-type space --sdk static --public --exist-ok
```

## 5. Upload the dataset repository

The first command uploads the card, licensing note, and all four Parquet files. The second places the standalone scorer at the dataset repository root, where its default `data/` lookup works.

```bash
$HFCLI upload "$HF_NAMESPACE/$HF_DATASET_REPO" hf/dataset . --repo-type dataset --commit-message "Publish WindTunnel canonical dataset"
$HFCLI upload "$HF_NAMESPACE/$HF_DATASET_REPO" hf/score_answers.py score_answers.py --repo-type dataset --commit-message "Add standalone answer scorer"
```

## 6. Upload the static Space

```bash
$HFCLI upload "$HF_NAMESPACE/$HF_SPACE_REPO" hf/space . --repo-type space --commit-message "Publish canonical WindTunnel explorer"
```

There is no build command, runtime secret, API key, storage volume, or paid Space hardware requirement.

## 7. Verify the published repositories

First confirm both Hub APIs resolve:

```bash
curl -fsS "https://huggingface.co/api/datasets/$HF_NAMESPACE/$HF_DATASET_REPO" >/dev/null
curl -fsS "https://huggingface.co/api/spaces/$HF_NAMESPACE/$HF_SPACE_REPO" >/dev/null
```

Download the published dataset into a fresh directory and repeat the scorer proof against the uploaded bytes:

```bash
export HF_DOWNLOAD_DIR="$(mktemp -d)"
$HFCLI download "$HF_NAMESPACE/$HF_DATASET_REPO" --repo-type dataset --local-dir "$HF_DOWNLOAD_DIR"
$HFPY "$HF_DOWNLOAD_DIR/score_answers.py" --verify-corpus
```

The expected proof is:

```text
EQUIVALENCE	stored=2352 answer_checked=1968 probe_skipped=384 mismatches=0
```

Finally open these pages in a browser:

- `https://huggingface.co/datasets/<namespace>/<dataset-repo>` — confirm the viewer offers `attempts`, `verdicts`, `tasks`, and `transcripts`; `attempts` must be the first/default config and must not contain a transcript column.
- `https://huggingface.co/spaces/<namespace>/<space-repo>` — confirm the explorer loads, filters work, and no build/runtime panel is present.

Record the final dataset and Space URLs in the source repository README after the namespace and slugs are final. Do not create a model repository or enable a submission/leaderboard backend.
