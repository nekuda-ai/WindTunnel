# WindTunnel run — sonnet5-cu-full

**Date:** 2026-08-19 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $17.4463

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms cu-claude
```

Task set: `development tasks` · Harness commit: `6920088a11b8b10b8a9102c87e8ecfdee83a65c7-dirty` · N: `3`

## Headline — task×method combinations solved (out of 49)

**39/49 task×method combinations solved (79.6%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-claude | claude-sonnet-5 | 39/49 | 79.6% |

**One-line takeaway:** cu-claude solved 39/49 task×method combinations.

## By difficulty tier

| Tier | cu-claude |
|---|---|
| answer | 14/21 |
| act-short | 14/16 |
| act-long | 8/8 |
| transaction | 3/4 |

## By site (optional)

| Site | cu-claude |
|---|---|
| tailwind-nextjs-blog | 2/2 |
| bulletproof-react | 2/2 |
| directory-9d8 | 3/3 |
| nextjs-starter-medusa | 7/9 |
| easyappointments | 3/8 |
| learnhouse | 5/7 |
| idurar-erp-crm | 7/8 |
| hi-events | 10/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
