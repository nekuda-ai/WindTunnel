# WindTunnel run — astra-full

**Date:** 2026-09-05 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $84.6806

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms cu-openai,wm-gpt,code-openai
```

Task set: `development tasks` · Harness commit: `42b185357813fa98b0c2ab92accb92c91a059d74-dirty` · N: `3`

## Headline — task×method combinations solved (out of 123)

**118/123 task×method combinations solved (95.9%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-6-astra | 28/32 | 87.5% |
| wm-gpt | gpt-6-astra | 48/49 | 98.0% |
| code-openai | gpt-6-astra | 42/42 | 100.0% |

**One-line takeaway:** cu-openai, wm-gpt, code-openai solved 118/123 task×method combinations.

## By difficulty tier

| Tier | cu-openai | wm-gpt | code-openai |
|---|---|---|---|
| answer | 11/13 | 21/21 | 18/18 |
| act-short | 10/12 | 16/16 | 14/14 |
| act-long | 4/4 | 8/8 | 6/6 |
| transaction | 3/3 | 3/4 | 4/4 |

## By site (optional)

| Site | cu-openai | wm-gpt | code-openai |
|---|---|---|---|
| tailwind-nextjs-blog | 2/2 | 2/2 | 2/2 |
| bulletproof-react | 2/2 | 2/2 | 2/2 |
| directory-9d8 | 3/3 | 3/3 | 3/3 |
| nextjs-starter-medusa | 9/9 | 8/9 | 9/9 |
| easyappointments | 5/8 | 8/8 | 8/8 |
| idurar-erp-crm | 7/8 | 8/8 | 8/8 |
| learnhouse | 0/0 | 7/7 | 0/0 |
| hi-events | 0/0 | 10/10 | 10/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table


## Notes (operator)

- Host: macOS (Apple Silicon), Docker Desktop, serial flight 2026-09-05 18:17 → 2026-09-06 02:00 local. Second attempt: attempt 1 (72 cu-openai rows) was killed after a learnhouse image build stalled behind a locked-keychain Docker pull and the harness hung; its rows are kept out of the board (transcripts lost) — see `results/astra-full-attempt1.live.jsonl`.
- Harness fixes shipped with this run (disclosed in CHANGELOG.md and docs/SPEC.md §6): gpt-6-astra price row; OpenAI arms send no `temperature` (one request per turn); cache writes split out of `input_tokens` and priced at $12.50/M; rows record `effort`/`truncated`; `wm-gpt` keeps usage on timeout; **`cu-openai` keypress is a chord** (Ctrl+A now works; Luna/SOL rows predate this); smoke-gate request-error check scoped to harness failures; capsule lifecycle steps have hard ceilings.
- Incidents: `cu-openai × learnhouse` skipped (stale runtime dir from attempt 1) → re-run in `2026-09-05-astra-rem-cu-openai`. `cu-openai × hi-events`: the capsule's app container exited mid-batch; 8 attempts failed at the 5-min reset ceiling for $0 and teardown hung, so the batch's rows were dropped from this run.json → whole site re-run in `2026-09-05-astra-rem-cu-openai`. `code-openai × learnhouse` skipped (image build timed out while the keychain was locked again) → `2026-09-06-astra-rem-code-openai`. Docker `credsStore` was disabled at 01:03 to unblock pulls.
- Budget: `--budget 130` never tripped ($84.68). Turn-cap hits: 11, all `cu-openai`. Attempt timeouts: 0. Infra rows: 0.
- Caching: OpenAI reported zero cache reads on `cu-openai` rows (screenshots) while `wm-gpt`/`code-openai` rows did get reads; recorded as reported.
