# Jev + Mercury 2.5

The WebMCP and ultrafast DOM implementations used for the September 18 leaderboard. Jev chooses actions; Mercury writes arguments, field values and the final answer. The later A/B/C experiments are not included.

## Setup

Use Node 22+, Python 3.12+ and the benchmark's Docker prerequisites.
The September runner pins its shared dependencies and task hashes. Use its
original release checkout, separate from the current model-refresh harness:

```sh
git worktree add --detach ../windtunnel-jev-v12 5ca8644
cd ../windtunnel-jev-v12
```

```sh
npm ci
npm ci --prefix experiments/jev
npx playwright install chromium
python3 -m venv experiments/jev/ultrafast/.venv
experiments/jev/ultrafast/.venv/bin/pip install -r experiments/jev/ultrafast/python-dependencies.txt
```

Set `TYPESAFE_API_KEY` and `INCEPTION_API_KEY` in your shell. No keys belong in source control.

## Run

Without `--run`, these commands check the source hashes and task definitions without launching a browser or calling a provider:

```sh
node experiments/jev/run.mjs --interface webmcp
node experiments/jev/run.mjs --interface dom
```

To run one task, add `--run` and a new output directory. These commands make paid API calls:

```sh
node experiments/jev/run.mjs --interface webmcp --site learnhouse --task lh-1 --repeats 1 --out /tmp/jev-webmcp-run --run
node experiments/jev/run.mjs --interface dom --site learnhouse --task lh-1 --repeats 1 --out /tmp/jev-dom-run --run
```

Omit `--site` and `--task` for all 49 tasks. The default is three attempts per task. `--port` defaults to 3215; run one configuration at a time. Results go only to the requested directory, never to the canonical board. Fresh output contains unredacted observations and must be sanitized before sharing.

## What is preserved

The files in `source-manifest.json` are copied from the frozen measured cohorts and verified against their original SHA-256 hashes. Import paths were relocated. An optional DeepSeek URL check now compares the parsed hostname; the Mercury configuration does not use that branch. The prompts, policy, agent logic, viewport, task hashes, step budgets, 600-second attempt limit and provider prices are preserved. Browser Use's upstream code retains its [MIT license](ultrafast/upstream/LICENSE).

`run.mjs` is a portable launcher, and `webmcp/arm.mjs` extracts the original WebMCP method. Historical date gates and the recovery supervisor are not part of this launcher. It does not add date hints or automatically retry an entire attempt. It stops for infrastructure/model/accounting flags; each rerun needs a fresh directory. Model responses are checked against `jev-1.13.0` and `mercury-2.5`. Availability and future responses can change. A stopped run exits with a nonzero status and retains its partial results.

The shared dependencies are deliberately hash-pinned. CI checks this reproduction against the pinned v1.2 checkout; the current checkout separately verifies the published runner sources and traces. Do not refresh the recorded hashes.

The original EasyAppointments oracle additionally recorded the customer's phone field. The public oracle's other observations and all task predicates are the same; none of these 49 predicates uses that extra field. This only affects saved evaluator detail, not the agent input or task score.

## Inspect the published attempts

[The release folder](../../results/2026-09-18-jev-mercury/PROVENANCE.md) contains two compressed JSON Lines files, one record per attempt. Join them to the result rows by `run_id`. They retain requests, responses, observations, actions, usage and timing; credentials, session tokens and private paths are redacted. The original checkpoint hash is retained as provenance, not as a hash of the redacted copy.

```sh
python3 -m gzip -d < results/2026-09-18-jev-mercury/webmcp-traces.jsonl.gz | head -c 2000
python3 scripts/verify-jev-release.py
```

Local checks use scripted provider responses, with no paid calls:

```sh
node experiments/jev/webmcp/fixture-check.mjs
node experiments/jev/webmcp/readiness-check.mjs
node experiments/jev/webmcp/signal-seam-check.mjs
node experiments/jev/ultrafast/fixture-check.mjs
```
