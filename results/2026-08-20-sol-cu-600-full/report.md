# WindTunnel run — sol-cu-600-full

**Date:** 2026-08-20 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $25.0687

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms cu-openai
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 49)

**46/49 task×method combinations solved (93.9%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-5.6-sol | 46/49 | 93.9% |

**One-line takeaway:** cu-openai solved 46/49 task×method combinations.

## By difficulty tier

| Tier | cu-openai |
|---|---|
| answer | 19/21 |
| act-short | 15/16 |
| act-long | 8/8 |
| transaction | 4/4 |

## By site (optional)

| Site | cu-openai |
|---|---|
| tailwind-nextjs-blog | 2/2 |
| bulletproof-react | 2/2 |
| directory-9d8 | 3/3 |
| nextjs-starter-medusa | 9/9 |
| easyappointments | 6/8 |
| learnhouse | 7/7 |
| idurar-erp-crm | 7/8 |
| hi-events | 10/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
