# Provenance

- Branch: `feat/model-expansion-phase-0`
- Harness revision: `d78fbe8f63bbfec8fe253b6677b5da326ac7b83f`
- Host: macOS arm64 with Docker Desktop
- Started: 2026-08-16 20:03:01 IDT
- Finished: 2026-08-17 00:35 IDT
- Matrix: 2 arms x 8 sites x 49 tasks x 3 repeats (294 attempts)
- Models: `cu-openai=gpt-5.6-luna`, `wm-gpt=gpt-5.6-luna`
- Command budget: `$10`; corrected current-price spend was monitored against the user-approved `$20` ceiling.

## Post-run pricing correction

The supplied expansion plan listed Luna at $0.20/$1.20 per million input/output
tokens. Current OpenAI pricing is $1/$6. The flight completed using the stale
table, then `est_cost_usd`, `results.csv`, `run.json`, `report.md`, and
`explorer.html` were regenerated from the unchanged provider token counts with
the current price table. No scores, transcripts, timings, or token counts were
changed.
