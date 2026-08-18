# WindTunnel run — sol-full

**Date:** 2026-08-17 · **Preset:** full · **Sites:** full
**Repeats per task:** 3 · **Tracked cost:** $25.2414 (lower bound; see `PROVENANCE.md`)

Reproduce:

```bash
node --env-file=<existing-env> harness/cli.mjs --preset full --sites full \
  --arms cu-openai,wm-gpt \
  --model cu-openai=gpt-5.6-sol --model wm-gpt=gpt-5.6-sol \
  --n 3 --budget 43 --label sol-full
```

Task set: `development tasks` · Harness commit: `d78fbe8f63bbfec8fe253b6677b5da326ac7b83f-dirty` · N: `3`

## Headline — task×method combinations solved (out of 98)

**85/98 task×method combinations solved (86.7%).**

| Method | Model | Solved | % |
|---|---|---|---|
| cu-openai | gpt-5.6-sol | 39/49 | 79.6% |
| wm-gpt | gpt-5.6-sol | 46/49 | 93.9% |

**One-line takeaway:** cu-openai, wm-gpt solved 85/98 task×method combinations.

## By difficulty tier

| Tier | cu-openai | wm-gpt |
|---|---|---|
| answer | 19/21 | 20/21 |
| act-short | 11/16 | 16/16 |
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
| idurar-erp-crm | 3/8 | 8/8 |
| hi-events | 9/10 | 9/10 |

## Robustness (optional)

Not implemented.

## Notes

- Timeouts: 26/147 `cu-openai` attempts hit the 300-second agent deadline and
  were counted as failures; `wm-gpt` had none.
- Accounting anomaly: timeout exceptions dropped their accumulated usage and
  agent time, so the tracked cost and CU medians are understated. See
  `PROVENANCE.md` for the censored-result analysis.
- Sanity checks (the two control sites behaved as expected?): controls included — see the per-site table
