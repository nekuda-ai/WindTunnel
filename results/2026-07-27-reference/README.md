# Reference run — 2026-07-27

7 methods × 49 tasks across 8 sites × 3 attempts = **1,029 attempts**, $102.68
of model spend across the cells kept here. This is the run the top-level
[README](../../README.md) reports; its ~$107 figure is the whole flight,
including the attempts these re-runs superseded.

| Interface | Method | Model | Solved | % |
|---|---|---|---|---|
| WebMCP | wm-claude | claude-sonnet-4-6 | 48/49 | 98% |
| WebMCP | wm-gpt | gpt-5.5 | 47/49 | 96% |
| WebMCP | wm-stagehand | claude-sonnet-4-6 | 47/49 | 96% |
| Screenshots | cu-openai | gpt-5.5 | 44/49 | 90% |
| DOM + vision | dom-browseruse | claude-sonnet-4-6 | 43/49 | 88% |
| Page structure (a11y) | a11y-stagehand | claude-sonnet-4-6 | 42/49 | 86% |
| Screenshots | cu-claude | claude-sonnet-4-6 | 39/49 | 80% |

A task counts as **solved** when a majority of its 3 attempts pass. Scoring
rules and pricing: [`docs/SPEC.md`](../../docs/SPEC.md).

## What's in here

| File | What it is |
|---|---|
| [`results.csv`](results.csv) | One row per attempt (1,029). GitHub renders it as a sortable table. |
| `explorer.html` | Interactive explorer — filter by method, site, tier; read any transcript. **GitHub shows this as source code**; download it and open it in a browser. |
| `explorer-artifact.html` | Same explorer, standalone build for embedding elsewhere. |
| `run.json` | Everything, including full transcripts (10 MB). |
| [`PROVENANCE.md`](PROVENANCE.md) | How this run was merged, and every post-run correction. |

This is a merged reference — a base full run plus two targeted re-runs, with
each cell attributed to its source. Read `PROVENANCE.md` before citing a
number; it discloses the two oracle bugs that forced the re-runs.
