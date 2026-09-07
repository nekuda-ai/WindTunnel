# WindTunnel run — astra-smoke-idurar-cu2

**Date:** 2026-09-05 · **Preset:** smoke · **Sites:** idurar-erp-crm
**Repeats per task:** 1 · **Approx. cost:** $0.6836

Reproduce:

```bash
npm run bench -- --preset smoke --sites idurar-erp-crm --arms cu-openai
```

Task set: `development tasks` · Harness commit: `443bf1ee7687fd07f93d24dc96151c1ad5754e14-dirty` · N: `1`

## Headline — task×method combinations solved (out of 1)

**1/1 task×method combinations solved (100.0%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-6-astra | 1/1 | 100.0% |

**One-line takeaway:** cu-openai solved 1/1 task×method combinations.

## By difficulty tier

| Tier | cu-openai |
|---|---|
| answer | 0/0 |
| act-short | 0/0 |
| act-long | 1/1 |
| transaction | 0/0 |

## By site (optional)

| Site | cu-openai |
|---|---|
| idurar-erp-crm | 1/1 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
