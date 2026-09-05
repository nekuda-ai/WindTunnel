# WindTunnel run — astra-smoke-idurar

**Date:** 2026-09-05 · **Preset:** smoke · **Sites:** idurar-erp-crm
**Repeats per task:** 1 · **Approx. cost:** $2.7895

Reproduce:

```bash
npm run bench -- --preset smoke --sites idurar-erp-crm --arms cu-openai,wm-gpt,code-openai
```

Task set: `development tasks` · Harness commit: `b4265bf49f372ca1c328ee5c332aab9eed4bb3d3-dirty` · N: `1`

## Headline — task×method combinations solved (out of 3)

**2/3 task×method combinations solved (66.7%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-6-astra | 0/1 | 0.0% |
| wm-gpt | gpt-6-astra | 1/1 | 100.0% |
| code-openai | gpt-6-astra | 1/1 | 100.0% |

**One-line takeaway:** cu-openai, wm-gpt, code-openai solved 2/3 task×method combinations.

## By difficulty tier

| Tier | cu-openai | wm-gpt | code-openai |
|---|---|---|---|
| answer | 0/0 | 0/0 | 0/0 |
| act-short | 0/0 | 0/0 | 0/0 |
| act-long | 0/1 | 1/1 | 1/1 |
| transaction | 0/0 | 0/0 | 0/0 |

## By site (optional)

| Site | cu-openai | wm-gpt | code-openai |
|---|---|---|---|
| idurar-erp-crm | 0/1 | 1/1 | 1/1 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
