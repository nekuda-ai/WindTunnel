# WindTunnel run — luna-full

**Date:** 2026-08-16 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Approx. cost:** $6.3644

Reproduce:

```bash
npm run bench -- --preset full --sites full --arms cu-openai,wm-gpt
```

Task set: `development tasks` · Harness commit: `d78fbe8f63bbfec8fe253b6677b5da326ac7b83f-dirty` · N: `3`

## Headline — task×method combinations solved (out of 98)

**87/98 task×method combinations solved (88.8%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-5.6-luna | 41/49 | 83.7% |
| wm-gpt | gpt-5.6-luna | 46/49 | 93.9% |

**One-line takeaway:** cu-openai, wm-gpt solved 87/98 task×method combinations.

## By difficulty tier

| Tier | cu-openai | wm-gpt |
|---|---|---|
| answer | 18/21 | 20/21 |
| act-short | 14/16 | 16/16 |
| act-long | 5/8 | 7/8 |
| transaction | 4/4 | 3/4 |

## By site (optional)

| Site | cu-openai | wm-gpt |
|---|---|---|
| tailwind-nextjs-blog | 2/2 | 1/2 |
| bulletproof-react | 2/2 | 2/2 |
| directory-9d8 | 2/3 | 3/3 |
| nextjs-starter-medusa | 8/9 | 8/9 |
| easyappointments | 6/8 | 8/8 |
| learnhouse | 7/7 | 7/7 |
| idurar-erp-crm | 5/8 | 8/8 |
| hi-events | 9/10 | 9/10 |

## Robustness (optional)

Not implemented.

## Notes

- Skipped runs (missing keys, timeouts): none recorded
- Anomalies or surprises: none recorded
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
