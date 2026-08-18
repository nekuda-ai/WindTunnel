# WindTunnel run — opus5-full

**Date:** 2026-08-17 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $34.6716

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms cu-claude,wm-claude
```

Task set: `development tasks` · Harness commit: `f7bac03f4c391259c7e60933a34e74a90b0f4ae3-dirty` · N: `3`

## Headline — task×method combinations solved (out of 98)

**91/98 task×method combinations solved (92.9%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-claude | claude-opus-5 | 43/49 | 87.8% |
| wm-claude | claude-opus-5 | 48/49 | 98.0% |

**One-line takeaway:** cu-claude, wm-claude solved 91/98 task×method combinations.

## By difficulty tier

| Tier | cu-claude | wm-claude |
|---|---|---|
| answer | 19/21 | 21/21 |
| act-short | 15/16 | 16/16 |
| act-long | 6/8 | 8/8 |
| transaction | 3/4 | 3/4 |

## By site (optional)

| Site | cu-claude | wm-claude |
|---|---|---|
| tailwind-nextjs-blog | 2/2 | 2/2 |
| bulletproof-react | 2/2 | 2/2 |
| directory-9d8 | 3/3 | 3/3 |
| nextjs-starter-medusa | 8/9 | 8/9 |
| easyappointments | 6/8 | 8/8 |
| learnhouse | 7/7 | 7/7 |
| idurar-erp-crm | 5/8 | 8/8 |
| hi-events | 10/10 | 10/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
