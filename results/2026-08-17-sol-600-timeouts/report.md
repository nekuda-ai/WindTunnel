# WindTunnel run — sol-600-timeouts

**Date:** 2026-08-17 · **Preset:** targeted · **Sites:** 300s-timeouts-only
**Repeats per task:** 1 · **Approx. cost:** $7.2276

Reproduce:

```bash
npm run bench -- --preset targeted --sites 300s-timeouts-only --arms cu-openai
```

Task set: `development tasks` · Harness commit: `6c1540e38eeacc104f928edad5108e767995fee9` · N: `1`

## Headline — task×method combinations solved (out of 22)

**16/22 task×method combinations solved (72.7%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-5.6-sol | 16/22 | 72.7% |

**One-line takeaway:** cu-openai solved 16/22 task×method combinations.

## By difficulty tier

| Tier | cu-openai |
|---|---|
| answer | 6/6 |
| act-short | 7/9 |
| act-long | 1/4 |
| transaction | 2/3 |

## By site (optional)

| Site | cu-openai |
|---|---|
| bulletproof-react | 1/1 |
| nextjs-starter-medusa | 3/3 |
| easyappointments | 2/4 |
| learnhouse | 3/3 |
| idurar-erp-crm | 4/7 |
| hi-events | 3/4 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): n/a — control sites not in this run
