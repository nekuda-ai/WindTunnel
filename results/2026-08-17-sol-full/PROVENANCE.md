# Provenance

- Branch: `feat/model-expansion-phase-0`
- Harness base revision: `d78fbe8f63bbfec8fe253b6677b5da326ac7b83f`
- Harness state: dirty during the run with the current GPT-5.6 price table and
  network-exception retry patch that are committed with this artifact
- Host: macOS arm64 with Docker Desktop
- Started: 2026-08-17 01:26:04 IDT
- Finished: 2026-08-17 08:25:38 IDT
- Matrix: 2 arms x 8 sites x 49 tasks x 3 repeats (294 attempts)
- Models: `cu-openai=gpt-5.6-sol`, `wm-gpt=gpt-5.6-sol`
- Reasoning effort: provider default (`medium` for GPT-5.6 SOL)
- Clean-run budget guard: `$43`
- User-approved absolute Phase 2 ceiling: `$70` (raised from `$50` while the
  clean run was in progress; the live `$43` guard was not changed)

Command, with the existing environment-file path omitted:

```bash
node --env-file=<existing-env> harness/cli.mjs \
  --preset full --sites full \
  --arms cu-openai,wm-gpt \
  --model cu-openai=gpt-5.6-sol \
  --model wm-gpt=gpt-5.6-sol \
  --n 3 --budget 43 --label sol-full
```

## Spend accounting

- Clean run, tracked by retained rows: `$25.241419`
- Two discarded partial runs: `$0.693500` + `$0.390068` = `$1.083568`
- Tracked Phase 2 total: `$26.324987`

The tracked total is a lower bound, not provider-billing truth. On an attempt
timeout, `method.run()` throws before returning its accumulated usage. The row
writer therefore records zero tokens and zero cost for that attempt even though
the provider handled requests during the preceding five minutes. This affected
26 `cu-openai` attempts. Verify the provider dashboard before authorizing a
longer-timeout rerun.

## Timeout censoring

`cu-openai` hit the fixed 300-second agent deadline on 26/147 attempts across
22 tasks. Timestamp gaps of roughly 331-354 seconds confirm these were genuine
five-minute cutoffs; the much smaller `wall_clock_s` values on those rows are
the reset-only accounting artifact described above.

- Official CU attempt score: 104/147 (70.7%)
- Diagnostic score excluding censored attempts: 104/121 (86.0%)
- Best case if every censored attempt passed: 130/147 (88.4%)
- Official CU majority-task score: 39/49 (79.6%)
- Diagnostic majority score excluding censored repeats: 42/49 (85.7%)
- Best-case majority score: 43/49 (87.8%)

The completed GPT-5.5 CU, Luna CU, and Claude CU reference arms recorded zero
attempt timeouts. Keep this run as the 300-second SLA result; label any future
600-second rerun separately as a reasoning-model capability result.

Estimated wall time for a 600-second follow-up on this Mac/Docker host:

- Re-run the 26 censored attempts once: about 2.5-5 hours (best estimate 3.5h)
- Re-run all three repeats for the 22 affected tasks: about 5-8 hours
- Accounting fix, validation, and report regeneration: about 20-30 minutes

## Operational notes

- The first discarded partial run exposed un-retried thrown network errors.
  Both OpenAI arms now retry thrown fetch failures with the existing backoff
  policy; the regression test is `tests/openai-network-retry.test.mjs`.
- The clean run exercised that fix once: one retry, 2 seconds of retry wait,
  and no resulting infrastructure failure.
- A second discarded partial run was stopped after encountering orphaned
  capsule state from the interrupted first restart. The exact capsule was
  garbage-collected and the clean run began only after no `wt-*` runtime
  directories or labeled containers remained.
